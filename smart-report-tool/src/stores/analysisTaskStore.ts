/**
 * AI 智能分析任务队列 Store
 *
 * 分析任务在模块级执行器中运行（不挂在 React 组件上），因此：
 * - 切换到其他页面再回来，正在进行的分析状态完整保留（流式输出不中断）
 * - 「后台运行」实质是任务继续跑、用户可立即准备下一个分析
 * - 多个任务自动排队，同一时刻只执行一个，避免并发请求过多
 *
 * 注意：任务（含 File 对象）只存内存，刷新页面后未完成的任务会丢失。
 *
 * @module stores/analysisTaskStore
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import { getApiUrl, checkFileHashes } from '@/services/api';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import type { AssetSupplement } from '@/components/AssetSupplementForm';

/** 提交分析所需的完整参数（入队时从表单快照） */
export interface AnalysisTaskPayload {
  file: File;
  category: string;
  customPrompt: string;
  supplements: AssetSupplement[];
  knowledgeFileIds: string[];
  /** 会话级选择的模型记录 ID，null 表示用服务端默认 */
  modelId: string | null;
  userHint: string;
  /** 报告作者显示名 */
  author: string;
  /** 生效模型显示名（用于报告内容） */
  modelName: string;
}

export interface AnalysisTask {
  id: string;
  fileName: string;
  category: string;
  status: 'queued' | 'running' | 'done' | 'error';
  streamingText: string;
  packProgress: string;
  result: string | null;
  error: string | null;
  createdAt: number;
  payload: AnalysisTaskPayload;
}

/** 类别显示名（含支持包模式专用的 support 类别） */
const CATEGORY_LABELS: Record<string, string> = {
  host: '主机', storage: '存储', network: '交换机',
  virtualization: '虚拟化', database: '数据库', other: '其他',
  support: '整机支持包',
};

/** 构建 AI 报告 Markdown 内容（导出与报告管理一致） */
export function buildReportContent(result: string, categoryKey: string, fileName: string, model: string): string {
  const categoryLabel = CATEGORY_LABELS[categoryKey] || categoryKey;
  return `# AI 巡检分析报告

类别: ${categoryLabel}
文件: ${fileName}
模型: ${model}
生成时间: ${new Date().toLocaleString()}

---

${result}`;
}

/** 构建 AI 报告文件名（导出与报告管理一致） */
export function buildReportFileName(originalFileName: string): string {
  const now = new Date();
  const dateStr = `${String(now.getFullYear()).slice(2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  return `AI分析报告（${originalFileName}）_${dateStr} ${timeStr}.md`;
}

interface AnalysisTaskState {
  tasks: AnalysisTask[];
  /** 当前在页面上展示的任务（切页后回来自动恢复为该任务） */
  activeTaskId: string | null;
  /** 入队一个新分析任务；返回任务 ID。自动触发队列调度 */
  enqueue: (payload: AnalysisTaskPayload) => string;
  setActiveTask: (id: string | null) => void;
  /** 从列表移除任务（运行中的任务不允许移除） */
  removeTask: (id: string) => void;
}

export const useAnalysisTaskStore = create<AnalysisTaskState>((set, get) => {
  const update = (id: string, patch: Partial<AnalysisTask>) => {
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  };

  /** 队列调度：没有正在运行的任务时，取出最早排队的任务执行 */
  const pump = () => {
    const { tasks } = get();
    if (tasks.some((t) => t.status === 'running')) return;
    const next = tasks.find((t) => t.status === 'queued');
    if (next) void runTask(next.id);
  };

  /** 执行单个任务：秒传判定 → SSE 流式分析 → 自动保存报告 → 调度下一个 */
  const runTask = async (id: string) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const { payload } = task;
    update(id, { status: 'running', streamingText: '', error: null, result: null, packProgress: '' });

    try {
      // 秒传判定：完整计算文件 SHA-256，命中去重存储则不再上传
      let dedupHash = '';
      try {
        const buf = await payload.file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const existing = await checkFileHashes([hash]);
        if (existing[hash]) dedupHash = hash;
      } catch { /* 计算失败则走正常上传 */ }

      const formData = new FormData();
      if (dedupHash) formData.append('dedupHash', dedupHash);
      else formData.append('file', payload.file);
      formData.append('category', payload.category);
      formData.append('customPrompt', payload.customPrompt);
      formData.append('supplements', JSON.stringify(payload.supplements));
      formData.append('knowledgeFileIds', JSON.stringify(payload.knowledgeFileIds));
      formData.append('modelId', payload.modelId ?? '');
      if (payload.userHint.trim()) formData.append('userHint', payload.userHint.trim());

      const res = await fetch(getApiUrl('/ai/analyze-file'), { method: 'POST', credentials: 'include', body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || '分析请求失败');
      }
      if (dedupHash) toast.info(`「${task.fileName}」文件已存在，使用秒传模式`);
      // 后端走 .env 系统默认兜底时打 X-AI-Fallback 响应头，点亮共享提示条
      if (res.headers.get('X-AI-Fallback') === 'true') useAIConfigStore.getState().setFallbackNotice(true);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('不支持流式响应');
      const decoder = new TextDecoder();
      let fullText = '';
      // 跨 read 循环的行缓冲：TCP 分片可能把一条 data: 行切断，
      // 只处理以 \n 结尾的完整行，不完整部分留给下一轮拼接
      let buffer = '';
      /** 解析一行 SSE 数据（忽略空行 / [DONE] / 非 data 行）；支持 pack_progress 进度消息和 fallback_notice */
      const handleLine = (line: string) => {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) return;
        const dp = t.slice(6);
        if (dp === '[DONE]') return;
        try {
          const parsed = JSON.parse(dp);
          if (parsed.type === 'pack_progress' && parsed.message) {
            update(id, { packProgress: parsed.message });
            return;
          }
          if (parsed.type === 'fallback_notice') {
            useAIConfigStore.getState().setFallbackNotice(true);
            return;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            update(id, { streamingText: fullText });
          }
        } catch { /* 忽略无法解析的行 */ }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 末尾不完整的一行（可能为空串）留到下一轮
          buffer = lines.pop() || '';
          for (const line of lines) handleLine(line);
        }
        // 流结束后若 buffer 还残留完整行，再处理一次
        if (buffer.trim()) handleLine(buffer);
      } finally {
        reader.releaseLock();
      }

      update(id, { result: fullText, streamingText: '', packProgress: '', status: 'done' });

      // 分析完成后自动保存到后端（保存与前端导出完全一致的内容和文件名）
      try {
        const reportContent = buildReportContent(fullText, payload.category, task.fileName, payload.modelName);
        const saveRes = await fetch(getApiUrl('/reports/ai-save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            content: reportContent,
            originalFileName: task.fileName,
            category: payload.category,
            author: payload.author,
          }),
        });
        if (saveRes.ok) {
          toast.success(`「${task.fileName}」分析完成，报告已自动保存`);
        } else {
          const errData = await saveRes.json().catch(() => ({}));
          toast.error(errData.message || '报告保存失败');
        }
      } catch { /* 保存失败不影响分析结果展示 */ }
    } catch (err: any) {
      const msg = err.message || '分析失败';
      update(id, { status: 'error', error: msg, packProgress: '' });
      toast.error(`「${task.fileName}」${msg}`);
    } finally {
      // 无论成败，调度队列中的下一个任务
      pump();
    }
  };

  return {
    tasks: [],
    activeTaskId: null,

    enqueue: (payload) => {
      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const task: AnalysisTask = {
        id,
        fileName: payload.file.name,
        category: payload.category,
        status: 'queued',
        streamingText: '',
        packProgress: '',
        result: null,
        error: null,
        createdAt: Date.now(),
        payload,
      };
      set((s) => ({ tasks: [...s.tasks, task], activeTaskId: id }));
      const running = get().tasks.some((t) => t.status === 'running');
      if (running) {
        const pos = get().tasks.filter((t) => t.status === 'queued').length;
        toast.info(`已有分析任务进行中，「${task.fileName}」已加入队列（第 ${pos} 位）`);
      }
      pump();
      return id;
    },

    setActiveTask: (id) => set({ activeTaskId: id }),

    removeTask: (id) => {
      const t = get().tasks.find((x) => x.id === id);
      if (!t || t.status === 'running') return;
      set((s) => ({
        tasks: s.tasks.filter((x) => x.id !== id),
        activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
      }));
      // 移除排队任务不影响调度；兜底再泵一次
      pump();
    },
  };
});
