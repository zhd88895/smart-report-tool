/**
 * AI 分析任务队列服务
 *
 * 服务端集中排队的分析任务执行器：
 * - 任务记录持久化在 analysis_tasks 表，文件实体存去重存储（file_hash 引用）
 * - 全局串行调度：同一时刻只执行一个任务，其余按创建时间排队
 * - 运行中的流式输出累积在内存运行时，SSE 订阅者断线重连后先补发
 *   已累积内容再接续实时增量——前端刷新页面也能恢复任务状态
 * - 完成后自动保存 AI 报告（与前端手动保存的内容/文件名规则一致）
 * - 服务重启恢复：中断的 running 标记为 error，queued 任务自动恢复执行
 *
 * @module services/analysisTaskService
 */

import { readFile } from 'fs/promises';
import { analysisTaskRepository, AnalysisTaskRecord } from '../db/repositories/analysisTaskRepository';
import { fileDedupService } from './fileDedupService';
import { isArchiveFile, extractEntries, smartSelect } from './archiveAnalysisService';
import { getPrompt } from './aiPrompts';
import { callUserAIStream } from './aiProviderService';
import { reportService } from './reportService';
import { buildKnowledgeContext } from '../utils/knowledgeExcerpt';
import { readAndConvertFile } from '../utils/fileTextConvert';
import { safeErrorMessage } from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('AnalysisTaskService', 'core');

/** SSE 订阅者收到的事件（与 /ai/analyze-file 的流格式兼容 + 任务终态事件） */
export type TaskEvent =
  | { type: 'pack_progress'; message: string }
  | { type: 'fallback_notice' }
  | { type: 'task_started' }
  | { choices: Array<{ delta: { content: string } }> }
  | { type: 'task_done'; reportId: string | null }
  | { type: 'task_error'; message: string };

/** 任务运行时（内存态）：累积输出 + 实时订阅者 */
interface TaskRuntime {
  text: string;
  progress: string;
  fallback: boolean;
  listeners: Set<(evt: TaskEvent) => void>;
}

const CATEGORY_LABELS: Record<string, string> = {
  host: '主机', storage: '存储', network: '交换机',
  virtualization: '虚拟化', database: '数据库', other: '其他',
  support: '整机支持包',
};

/** 构建 AI 报告 Markdown 内容（与前端正结束导出的格式一致） */
function buildReportContent(result: string, categoryKey: string, fileName: string, model: string): string {
  const categoryLabel = CATEGORY_LABELS[categoryKey] || categoryKey;
  return `# AI 巡检分析报告

类别: ${categoryLabel}
文件: ${fileName}
模型: ${model}
生成时间: ${new Date().toLocaleString()}

---

${result}`;
}

class AnalysisTaskService {
  /** 运行中的任务 ID（全局串行，只有一个） */
  private runningTaskId: string | null = null;
  /** 任务运行时表：任务完成后保留，供迟到的 SSE 重连补发；定时清理 */
  private runtime = new Map<string, TaskRuntime>();

  /**
   * 服务启动恢复：running → error（中断），queued 保留并恢复调度
   */
  async init(): Promise<void> {
    const interrupted = await analysisTaskRepository.recoverInterrupted();
    if (interrupted > 0) log.warn(`服务重启：${interrupted} 个分析任务被标记为中断`);
    void this.pump();
  }

  /** 入队（记录已由路由层创建）；自动触发调度 */
  async enqueue(taskId: string): Promise<void> {
    void this.pump();
    log.info(`分析任务入队: ${taskId}`);
  }

  /**
   * 队列调度：没有运行中的任务时，取全局最早排队的任务执行
   */
  private async pump(): Promise<void> {
    if (this.runningTaskId) return;
    const next = await analysisTaskRepository.findOldestQueued();
    if (!next) return;
    // 条件迁移防并发重复调度
    const claimed = await analysisTaskRepository.claimForRun(next.id);
    if (!claimed) return;
    void this.runTask(next);
  }

  /** 订阅任务实时事件（返回当前运行时快照，供 SSE 补发） */
  subscribe(taskId: string, listener: (evt: TaskEvent) => void): { runtime: TaskRuntime | null; unsubscribe: () => void } {
    let rt = this.runtime.get(taskId);
    if (!rt) {
      rt = { text: '', progress: '', fallback: false, listeners: new Set() };
      this.runtime.set(taskId, rt);
    }
    rt.listeners.add(listener);
    return {
      runtime: rt,
      unsubscribe: () => { rt.listeners.delete(listener); },
    };
  }

  /** 当前是否有任务在运行（路由层判断新任务是否直接开始） */
  isRunning(taskId: string): boolean {
    return this.runningTaskId === taskId;
  }

  /** 重试准备：清掉任务的内存运行时（含旧结果与残留订阅），避免重连时补发旧内容 */
  resetRuntime(taskId: string): void {
    this.runtime.delete(taskId);
  }

  /** 执行单个任务：读文件 → 三条分析路径 → 累积输出 → 自动保存报告 → 调度下一个 */
  private async runTask(task: AnalysisTaskRecord): Promise<void> {
    this.runningTaskId = task.id;
    // 复用排队阶段已建立的订阅者（subscribe 占位创建的运行时），重置输出累积
    const prev = this.runtime.get(task.id);
    const rt: TaskRuntime = { text: '', progress: '', fallback: false, listeners: prev?.listeners ?? new Set() };
    this.runtime.set(task.id, rt);

    const emit = (evt: TaskEvent): void => {
      for (const fn of rt.listeners) {
        try { fn(evt); } catch { /* 单个订阅者异常不影响执行 */ }
      }
    };
    const onProgress = (message: string): void => {
      rt.progress = message;
      emit({ type: 'pack_progress', message });
    };
    const onDelta = (chunk: string): void => {
      rt.text += chunk;
      emit({ choices: [{ delta: { content: chunk } }] });
    };

    try {
      log.info(`分析任务开始: ${task.id} (${task.fileName})`);
      // 显式通知订阅者任务已开始（前端据此把卡片从「排队」切换为「分析中」）
      emit({ type: 'task_started' });

      // 从去重存储读取文件实体
      const entry = await fileDedupService.lookup(task.fileHash);
      if (!entry) throw new Error('文件已过期，请重新上传');
      await fileDedupService.touch(task.fileHash);
      const fileBuffer = await readFile(entry.path);
      const fileName = task.fileName;

      let content: string;
      if (isArchiveFile(fileName, fileBuffer)) {
        const entries = await extractEntries(fileBuffer, fileName);
        const { context, summary } = smartSelect(entries);

        // Agentic 分流：正则筛选无结果但有文本 / 预算装不下 / 文件数过多
        const useAgentic = (summary.selected === 0 && summary.textFiles > 0)
          || summary.skippedBudget > 0
          || entries.length > 400;

        if (useAgentic) {
          log.info(`任务 ${task.id} 走 Agentic 分析: ${entries.length} 个文件`);
          const knowledgeContext = await buildKnowledgeContext(
            task.knowledgeFileIds, entries.map((e: any) => e.path).join('\n'), fileName
          );
          onProgress(`压缩包包含 ${entries.length} 个文件，启用智能分析模式...`);

          const { analyzeWithAgent } = await import('./supportPackAgentService');
          const result = await analyzeWithAgent(task.userId, entries, {
            category: task.category,
            customPrompt: task.customPrompt,
            supplements: task.supplements,
            knowledgeContext,
            userHint: task.userHint || undefined,
            modelId: task.modelId ?? undefined,
            onProgress,
          });
          if (result.fallback) {
            rt.fallback = true;
            emit({ type: 'fallback_notice' });
          }
          onProgress('分析完成，正在生成报告...');
          // 合成流式输出：按 ~200 字符切块，与正常流式格式一致
          const CHUNK = 200;
          for (let i = 0; i < result.report.length; i += CHUNK) {
            onDelta(result.report.slice(i, i + CHUNK));
          }
          await this.finishTask(task, rt, emit);
          return;
        }

        if (summary.selected === 0) throw new Error('压缩包内未找到可分析的文本日志');
        content = context;
      } else {
        onProgress('正在读取文件内容...');
        content = await readAndConvertFile(fileBuffer, fileName);
      }

      // 知识库上下文 + 提示词组装（与 /ai/analyze-file 同步路径一致）
      const knowledgeContext = await buildKnowledgeContext(task.knowledgeFileIds, content, fileName);
      let prompt = getPrompt(task.category, content + knowledgeContext, task.customPrompt, task.supplements as any);
      if (task.userHint) {
        prompt += `\n\n## 用户补充提示\n用户提供了以下背景信息，请在分析时重点关注：\n${task.userHint}`;
      }

      onProgress('AI 分析中...');
      const { stream, fallback } = await callUserAIStream(task.userId, {
        messages: [{ role: 'user', content: prompt }],
        modelId: task.modelId ?? undefined,
        feature: 'analyze_file',
        maxOutputTokens: 8192,
      });
      if (fallback) {
        rt.fallback = true;
        emit({ type: 'fallback_notice' });
      }

      // 逐行消费上游 SSE，提取文本增量
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t || !t.startsWith('data: ')) continue;
            const dp = t.slice(6);
            if (dp === '[DONE]') continue;
            try {
              const delta = JSON.parse(dp)?.choices?.[0]?.delta?.content;
              if (delta) onDelta(delta);
            } catch { /* 忽略无法解析的行 */ }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!rt.text.trim()) throw new Error('AI 未返回有效内容');
      await this.finishTask(task, rt, emit);
    } catch (error: any) {
      const msg = safeErrorMessage(error);
      log.error(`分析任务失败: ${task.id}: ${msg}`);
      await analysisTaskRepository.markError(task.id, msg);
      emit({ type: 'task_error', message: msg });
    } finally {
      this.runningTaskId = null;
      // 运行时保留 30 分钟供迟到的重连补发，之后清掉（终态结果已落库）
      setTimeout(() => this.runtime.delete(task.id), 30 * 60 * 1000);
      void this.pump();
    }
  }

  /** 任务成功收尾：落库 + 自动保存报告 + 通知订阅者 */
  private async finishTask(
    task: AnalysisTaskRecord,
    rt: TaskRuntime,
    emit: (evt: TaskEvent) => void
  ): Promise<void> {
    let reportId: string | null = null;
    try {
      const reportContent = buildReportContent(rt.text, task.category, task.fileName, task.modelName);
      const report = await reportService.saveAIAnalysisReport({
        content: reportContent,
        originalFileName: task.fileName,
        category: task.category,
        author: task.author || task.userId,
        generatedBy: task.userId,
      });
      reportId = report.id;
    } catch (e: any) {
      // 报告保存失败不影响任务本身的结果
      log.warn(`任务 ${task.id} 报告自动保存失败: ${e?.message || e}`);
    }
    await analysisTaskRepository.markDone(task.id, rt.text, reportId);
    emit({ type: 'task_done', reportId });
    log.info(`分析任务完成: ${task.id}${reportId ? `，报告 ${reportId}` : ''}`);
  }
}

export const analysisTaskService = new AnalysisTaskService();
