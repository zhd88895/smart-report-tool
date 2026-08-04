/**
 * AI 聊天路由模块
 * 
 * 提供前端 AI 助手调用的 API 端点，代理转发到多厂商 API。
 * 支持流式（SSE）和非流式两种响应模式，以及 AI 文件分析与配置状态查询。
 * 
 * @module routes/ai
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { readFile } from 'fs/promises';
import { writeFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { ApiResponse, safeErrorMessage } from '../types';
import { callUserAI, callUserAIStream, AIMessage } from '../services/aiProviderService';
import { fileDedupService } from '../services/fileDedupService';
import { isArchiveFile, extractEntries, smartSelect } from '../services/archiveAnalysisService';
import { runToolLoop, runToolLoopStream } from '../services/aiTools/registry';
import { executeRunScript, executeWriteScript } from '../services/aiTools/confirmTools';
import { aiToolConfirmRepository } from '../db/repositories/aiToolConfirmRepository';
import { userAIConfigService } from '../services/userAIConfigService';
import { getPrompt, CATEGORY_KEYS } from '../services/aiPrompts';
import { getLogger } from '../utils/logger';

const log = getLogger('AIRoutes', 'core');

/** Promise 化的 execFile */
const execFileAsync = promisify(execFile);

function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  return `你是智能报告生成工具的 AI 助手。当前日期：${dateStr}。你的能力包括：帮助用户查询和分析巡检报告数据、解释脚本功能和报告生成流程、回答运维相关的技术问题。回答时请使用中文，保持简洁专业。`;
}

/** enableTools 时在系统提示后追加工具使用指引 */
function buildToolSystemPrompt(): string {
  return `${buildSystemPrompt()}

你可以使用以下工具获取真实数据后再回答：
- list_scripts / read_script / analyze_script：查询、读取、分析用户的脚本
- list_reports：查询用户近期报告
- write_script：新建或修改脚本（含 main.py 源码）
- run_script：对日志文件执行脚本生成报告
当用户的问题涉及"我的脚本/报告"时，先调用工具获取真实列表再回答，不要编造。
write_script / run_script 调用后不会立即生效——系统会向用户展示确认卡片，
用户确认后才真正执行。调用这两个工具时确保参数完整（write_script 必须有
name 与完整 mainPy 源码；run_script 必须有 scriptId），并在调用前用一句话
向用户说明你将要执行的操作。`;
}

// ═══════════════════════════════════════════════════════
//  知识库上下文：按日志关键词相关性节选
// ═══════════════════════════════════════════════════════

/** 每个知识库文件注入提示词的最大字符数（大手册只节选相关章节） */
const KB_PER_FILE_BUDGET = 15000;
/** 关键词命中处向后扩展的上下文行数 */
const KB_WINDOW_LINES = 25;

/** 过于泛化的词不参与匹配（避免整篇手册都算"相关"） */
const KB_STOP_WORDS = new Set([
  'error', 'fail', 'failed', 'failing', 'failure', 'fault', 'warning', 'critical',
  'fatal', 'alert', 'level', 'event', 'this', 'that', 'with', 'from', 'the',
  'reporting', 'specified', 'detected', 'status', 'system', 'log',
]);

/**
 * 从日志内容 + 文件名提取匹配关键词：
 * - 文件名拆解（HP RX7640.log → hp、rx7640）
 * - 告警码（CPU_FAN_FAIL 等全大写词）及其拆分词（cpu、fan）
 * - 故障关键行里的实义词
 */
function extractLogKeywords(logContent: string, fileName: string): string[] {
  const kws = new Set<string>();
  for (const w of fileName.split(/[^A-Za-z0-9]+/)) {
    if (w.length >= 3) kws.add(w.toLowerCase());
  }
  for (const m of logContent.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)) {
    kws.add(m[0].toLowerCase());
    for (const part of m[0].toLowerCase().split('_')) {
      if (part.length >= 3) kws.add(part);
    }
  }
  for (const line of logContent.split('\n')) {
    if (/error|fail|fault|critical|fatal|warning/i.test(line)) {
      for (const w of line.split(/[^A-Za-z0-9]+/)) {
        if (w.length >= 4) kws.add(w.toLowerCase());
      }
    }
  }
  return [...kws].filter((k) => !KB_STOP_WORDS.has(k)).slice(0, 60);
}

/**
 * 按关键词相关性从知识库文件内容中节选章节：
 * 命中行按命中数排序取 Top，向前 3 行 / 向后 KB_WINDOW_LINES 行扩窗，
 * 相邻窗口合并，总量不超过预算；无命中时回退为头部截取。
 */
function selectRelevantExcerpt(
  content: string,
  keywords: string[],
  budget: number
): { text: string; relevanceSelected: boolean } {
  if (content.length <= budget) return { text: content, relevanceSelected: false };
  const lines = content.split('\n');
  const hits: Array<[number, number]> = [];
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    let score = 0;
    for (const kw of keywords) if (low.includes(kw)) score++;
    if (score > 0) hits.push([i, score]);
  });
  if (hits.length === 0) {
    return { text: content.slice(0, budget), relevanceSelected: false };
  }
  const topLines = hits
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map((e) => e[0])
    .sort((a, b) => a - b);
  // 合并相邻/重叠窗口
  const windows: Array<[number, number]> = [];
  for (const i of topLines) {
    const start = Math.max(0, i - 3);
    const end = Math.min(lines.length, i + KB_WINDOW_LINES);
    const last = windows[windows.length - 1];
    if (last && start <= last[1] + 5) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  let text = '';
  for (const [s, e] of windows) {
    const chunk = lines.slice(s, e).join('\n');
    if (text.length + chunk.length > budget) break;
    text += (text ? '\n\n……（另一相关章节节选）……\n\n' : '') + chunk;
  }
  return { text, relevanceSelected: true };
}


export class AIRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router { return this.router; }

  private setupRoutes(): void {
    this.router.post('/chat', authenticate, this.chat.bind(this));
    this.router.post('/chat/stream', authenticate, this.chatStream.bind(this));
    this.router.get('/status', authenticate, this.status.bind(this));
    // 需确认工具：确认执行 / 取消（归属校验在 handler 内做）
    this.router.post('/tools/confirm', authenticate, this.confirmTool.bind(this));
    this.router.post('/tools/cancel', authenticate, this.cancelTool.bind(this));

    // AI 文件分析（multipart upload，需要 multer）
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
    this.router.post('/analyze-file', authenticate, upload.single('file'), this.analyzeFile.bind(this));
  }

  /** 非流式聊天：按当前登录用户的数据库配置统一调用；enableTools 时走工具循环 */
  private async chat(req: Request, res: Response): Promise<void> {
    try {
      const { messages = [], modelId, enableTools } = req.body as { messages: AIMessage[]; modelId?: string; enableTools?: boolean };
      if (!messages.length) {
        res.status(400).json({ code: 400, data: null, message: '消息不能为空' } satisfies ApiResponse<null>);
        return;
      }
      if (enableTools) {
        const result = await runToolLoop(req.user!.userId, {
          messages: [{ role: 'system', content: buildToolSystemPrompt() }, ...messages],
          modelId, feature: 'chat',
        });
        if (result.fallback) res.setHeader('X-AI-Fallback', 'true');
        res.status(200).json({ code: 200, data: result, message: 'success' } satisfies ApiResponse<any>);
        return;
      }
      const result = await callUserAI(req.user!.userId, {
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...messages],
        modelId, feature: 'chat',
      });
      // 走了 .env 兜底时给响应头打标记，便于前端提示用户
      if (result.fallback) res.setHeader('X-AI-Fallback', 'true');
      res.status(200).json({ code: 200, data: result, message: 'success' } satisfies ApiResponse<any>);
    } catch (error: any) {
      log.error(`非流式聊天失败: ${safeErrorMessage(error)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** 流式聊天（SSE 转发）：先统一调用拿到上游流，再按原逻辑逐行转发；
   *  enableTools 时走流式工具循环 runToolLoopStream：模型文本增量以
   *  OpenAI choices[0].delta.content 格式实时转发，工具执行轨迹以
   *  {type:'tool_call'} 事件推送，结束以 {type:'final'} 事件携带
   *  message/usage/toolsUsed/pendingConfirm 等完整结果 */
  private async chatStream(req: Request, res: Response): Promise<void> {
    try {
      const { messages = [], modelId, enableTools } = req.body as { messages: AIMessage[]; modelId?: string; enableTools?: boolean };
      if (!messages.length) {
        res.status(400).json({ code: 400, data: null, message: '消息不能为空' } satisfies ApiResponse<null>);
        return;
      }
      // 工具模式：流式工具循环（真实流式输出，不再是 JSON 降级）。
      // SSE 头在 onReady（首次上游连接成功）时才设置并 flush——
      // 此前「未配置模型」等错误仍以 JSON 500 返回，前端按非流式错误处理。
      if (enableTools) {
        let sseStarted = false;
        const startSse = (fallback: boolean): void => {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          if (fallback) res.setHeader('X-AI-Fallback', 'true');
          res.flushHeaders();
          sseStarted = true;
        };
        const writeEvent = (payload: unknown): void => {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };
        try {
          const result = await runToolLoopStream(
            req.user!.userId,
            {
              messages: [{ role: 'system', content: buildToolSystemPrompt() }, ...messages],
              modelId, feature: 'chat',
            },
            {
              onReady: ({ fallback }) => startSse(fallback),
              onTextDelta: (delta) => writeEvent({ choices: [{ delta: { content: delta } }] }),
              onToolCall: (record) => writeEvent({ type: 'tool_call', data: record }),
            }
          );
          // 防御：循环竟未触发 onReady（理论上不会）时兜底 flush
          if (!sseStarted) startSse(result.fallback);
          writeEvent({
            type: 'final',
            data: {
              message: result.message,
              usage: result.usage,
              toolsUsed: result.toolsUsed,
              toolRounds: result.toolRounds,
              pendingConfirm: result.pendingConfirm,
              model: result.model,
              provider: result.provider,
            },
          });
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (error: any) {
          log.error(`工具模式流式聊天失败: ${safeErrorMessage(error)}`);
          if (!sseStarted && !res.headersSent) {
            res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
          } else {
            writeEvent({ type: 'error', data: { message: safeErrorMessage(error) } });
            res.end();
          }
        }
        return;
      }
      // 先调用统一入口（未配置模型等错误在 flush 前以 JSON 返回）
      const { stream, fallback } = await callUserAIStream(req.user!.userId, {
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...messages],
        modelId, feature: 'chat',
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      // 走了 .env 兜底时给响应头打标记
      if (fallback) res.setHeader('X-AI-Fallback', 'true');
      res.flushHeaders();

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
            const trimmed = line.trim();
            if (!trimmed) continue;
            res.write(`${trimmed}\n\n`);
          }
        }
        if (buffer.trim()) res.write(`${buffer.trim()}\n\n`);
      } finally { reader.releaseLock(); }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      // 两个分支（flush 前 JSON / flush 后 SSE error 事件）都记录错误日志
      log.error(`流式聊天失败: ${safeErrorMessage(error)}`);
      if (!res.headersSent) {
        res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error) })}\n\n`);
        res.end();
      }
    }
  }

  /**
   * 确认执行待确认工具（POST /api/ai/tools/confirm {pendingId}）
   *
   * 流程：归属校验（WHERE id=? AND user_id=?，不匹配 404）→ 状态必须是 pending
   * （条件迁移 pending→confirmed，防并发重复确认）→ 按工具类型执行
   * （write_script 复用 scriptService；run_script 复用报告生成链路）
   * → 更新 pending 状态与 result → 返回 {summary}
   */
  private async confirmTool(req: Request, res: Response): Promise<void> {
    try {
      const { pendingId } = req.body as { pendingId?: string };
      if (!pendingId || typeof pendingId !== 'string') {
        res.status(400).json({ code: 400, data: null, message: '缺少 pendingId' } satisfies ApiResponse<null>);
        return;
      }
      const userId = req.user!.userId;

      // 归属校验：不匹配一律 404（不暴露记录是否存在）
      const record = await aiToolConfirmRepository.findByIdAndUser(pendingId, userId);
      if (!record) {
        res.status(404).json({ code: 404, data: null, message: '待确认任务不存在' } satisfies ApiResponse<null>);
        return;
      }

      // 条件迁移 pending → confirmed：并发/重复确认只有第一个成功
      const claimed = await aiToolConfirmRepository.transitionStatus(pendingId, userId, 'pending', 'confirmed');
      if (!claimed) {
        res.status(409).json({
          code: 409,
          data: { status: record.status },
          message: `该任务已${record.status === 'cancelled' ? '取消' : '处理'}，不可重复确认`,
        } satisfies ApiResponse<any>);
        return;
      }

      // 执行真正的业务动作
      try {
        let execResult: { summary: string; data?: unknown };
        if (record.tool === 'write_script') {
          execResult = await executeWriteScript(userId, record.args);
        } else if (record.tool === 'run_script') {
          execResult = await executeRunScript(userId, record.args);
        } else {
          throw new Error(`不支持确认执行的工具类型: ${record.tool}`);
        }

        await aiToolConfirmRepository.updateResult(
          pendingId,
          userId,
          'executed',
          JSON.stringify({ ok: true, summary: execResult.summary })
        );
        log.info(`✓ 工具确认执行完成: ${record.tool} pendingId=${pendingId} userId=${userId}`);
        res.status(200).json({
          code: 200,
          data: { summary: execResult.summary, detail: execResult.data ?? null },
          message: 'success',
        } satisfies ApiResponse<any>);
      } catch (execError: any) {
        // 执行失败：标记 executed + 错误结果（审计完整），返回 400
        const errMsg = safeErrorMessage(execError);
        await aiToolConfirmRepository.updateResult(
          pendingId,
          userId,
          'executed',
          JSON.stringify({ ok: false, error: errMsg })
        );
        log.warn(`工具确认执行失败: ${record.tool} pendingId=${pendingId} ${errMsg}`);
        res.status(400).json({ code: 400, data: null, message: `执行失败: ${errMsg}` } satisfies ApiResponse<null>);
      }
    } catch (error: any) {
      log.error(`确认工具执行失败: ${safeErrorMessage(error)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** 取消待确认工具（POST /api/ai/tools/cancel {pendingId}）：归属校验 + pending→cancelled */
  private async cancelTool(req: Request, res: Response): Promise<void> {
    try {
      const { pendingId } = req.body as { pendingId?: string };
      if (!pendingId || typeof pendingId !== 'string') {
        res.status(400).json({ code: 400, data: null, message: '缺少 pendingId' } satisfies ApiResponse<null>);
        return;
      }
      const userId = req.user!.userId;

      // 归属校验 + 条件迁移（仅 pending 可取消）
      const cancelled = await aiToolConfirmRepository.transitionStatus(pendingId, userId, 'pending', 'cancelled');
      if (!cancelled) {
        const record = await aiToolConfirmRepository.findByIdAndUser(pendingId, userId);
        if (!record) {
          res.status(404).json({ code: 404, data: null, message: '待确认任务不存在' } satisfies ApiResponse<null>);
          return;
        }
        res.status(409).json({
          code: 409,
          data: { status: record.status },
          message: '该任务已处理，不可取消',
        } satisfies ApiResponse<any>);
        return;
      }
      log.info(`✓ 工具待确认任务已取消: pendingId=${pendingId} userId=${userId}`);
      res.status(200).json({ code: 200, data: { summary: '已取消该操作' }, message: 'success' } satisfies ApiResponse<any>);
    } catch (error: any) {
      log.error(`取消工具任务失败: ${safeErrorMessage(error)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }


  private async status(req: Request, res: Response): Promise<void> {
    // Express 4 不捕获 async 异常，与同文件 chat handler 一样用 try/catch 兜底
    try {
      const resolved = await userAIConfigService.getResolved(req.user!.userId);
      res.status(200).json({
        code: 200,
        data: {
          // 有默认模型或 .env 兜底可用即视为已配置
          configured: !!resolved.defaultModel || resolved.fallbackAvailable,
          // 无默认模型但兜底可用时标记 fallback
          fallback: !resolved.defaultModel && resolved.fallbackAvailable,
        },
        message: 'success',
      } satisfies ApiResponse<{ configured: boolean; fallback: boolean }>);
    } catch (error: any) {
      log.error(`获取 AI 配置状态失败: ${safeErrorMessage(error)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** AI 文件分析 — 接受文件上传并用 AI 流式分析 */
  private async analyzeFile(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      const dedupHash = (((req.body as any)?.dedupHash as string) || '').toLowerCase();
      const category = ((req.body as any)?.category as string) || 'other';
      const customPrompt = ((req.body as any)?.customPrompt as string) || '';
      // 指定模型记录 ID（可选，缺省用用户默认模型）
      const modelId = ((req.body as any)?.modelId as string) || undefined;
      const supplementsStr = (req.body as any)?.supplements as string;
      const supplements = supplementsStr ? JSON.parse(supplementsStr) : [];
      const knowledgeFileIdsStr = (req.body as any)?.knowledgeFileIds as string;
      const knowledgeFileIds: string[] = knowledgeFileIdsStr ? JSON.parse(knowledgeFileIdsStr) : [];

      // 文件内容来源：秒传引用（去重存储）或新上传 buffer
      let fileBuffer: Buffer;
      let fileName: string;
      if (dedupHash) {
        if (!/^[a-f0-9]{64}$/.test(dedupHash)) {
          res.status(400).json({ code: 400, data: null, message: '无效的秒传引用' } satisfies ApiResponse<null>);
          return;
        }
        const entry = await fileDedupService.lookup(dedupHash);
        if (!entry) {
          res.status(400).json({ code: 400, data: null, message: '文件已过期，请重新上传' } satisfies ApiResponse<null>);
          return;
        }
        await fileDedupService.touch(dedupHash);
        fileBuffer = await readFile(entry.path);
        fileName = entry.fileName;
      } else {
        if (!file) {
          res.status(400).json({ code: 400, data: null, message: '请上传巡检日志文件' } satisfies ApiResponse<null>);
          return;
        }
        fileBuffer = file.buffer;
        fileName = file.originalname;
        // 收编进内容寻址存储（失败不阻塞分析）
        fileDedupService.registerBuffer(file.buffer, file.originalname, req.user!.userId)
          .catch((e) => log.warn(`分析文件收编失败: ${e?.message || e}`));
      }
      if (!CATEGORY_KEYS.includes(category)) {
        res.status(400).json({ code: 400, data: null, message: '无效的日志类别' } satisfies ApiResponse<null>);
        return;
      }

      // 读取文件内容：压缩包走解压+智能筛选，普通文件走文本/CLI 转换
      let content: string;
      if (isArchiveFile(fileName, fileBuffer)) {
        let entries;
        try {
          entries = await extractEntries(fileBuffer, fileName);
        } catch (e: any) {
          res.status(400).json({ code: 400, data: null, message: `压缩包解压失败: ${e?.message || e}` } satisfies ApiResponse<null>);
          return;
        }
        const { context, summary } = smartSelect(entries);
        if (summary.selected === 0) {
          res.status(400).json({ code: 400, data: null, message: '压缩包内未找到可分析的文本日志' } satisfies ApiResponse<null>);
          return;
        }
        content = context;
      } else {
        content = await readAndConvertFile(fileBuffer, fileName);
      }

      // 构建知识库上下文：大文件按日志关键词节选相关章节（而非只截头部），
      // 让 AI 能基于手册中的对应章节给出完整的故障处理方法
      let knowledgeContext = '';
      if (knowledgeFileIds.length > 0) {
        const { knowledgeBaseRepository } = await import('../db/repositories/knowledgeBaseRepository');
        const kbFiles = await knowledgeBaseRepository.findFilesByIds(knowledgeFileIds);
        if (kbFiles.length > 0) {
          const keywords = extractLogKeywords(content, fileName);
          knowledgeContext = '\n\n## 知识库参考信息\n\n以下为用户从知识库中选取的参考文件（大型文档已按日志中的故障关键词自动节选相关章节）。分析时请主动将日志中的故障现象与参考文件中的对应章节关联，若找到对应的处理/更换/排查流程，请引用该章节给出完整、可操作的解决方法：\n\n';
          for (const kf of kbFiles) {
            const full = kf.content || '';
            const { text, relevanceSelected } = selectRelevantExcerpt(full, keywords, KB_PER_FILE_BUDGET);
            const note = relevanceSelected
              ? '（已按日志关键词节选相关章节）'
              : full.length > KB_PER_FILE_BUDGET
                ? '（内容较长，已截取开头部分）'
                : '';
            knowledgeContext += `### ${kf.title} (${kf.file_name})${note}\n\n\`\`\`plaintext\n${text}\n\`\`\`\n\n---\n\n`;
          }
        }
      }

      let prompt = getPrompt(category, content + knowledgeContext, customPrompt, supplements);

      // 用户补充提示：作为背景信息追加到提示词末尾（限 2000 字符，静默截断）
      const userHintRaw = (req.body as any)?.userHint;
      if (typeof userHintRaw === 'string' && userHintRaw.trim()) {
        const hint = userHintRaw.trim().slice(0, 2000);
        prompt += `\n\n## 用户补充提示\n用户提供了以下背景信息，请在分析时重点关注：\n${hint}`;
      }

      // 先调用统一入口（未配置模型等错误在 flush 前以 JSON 返回）
      const { stream, fallback } = await callUserAIStream(req.user!.userId, {
        messages: [{ role: 'user', content: prompt }],
        modelId, feature: 'analyze_file', maxOutputTokens: 8192,
      });

      // 流式返回
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      // 走了 .env 兜底时给响应头打标记
      if (fallback) res.setHeader('X-AI-Fallback', 'true');
      res.flushHeaders();

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
            const trimmed = line.trim();
            if (!trimmed) continue;
            res.write(`${trimmed}\n\n`);
          }
        }
        if (buffer.trim()) res.write(`${buffer.trim()}\n\n`);
      } finally { reader.releaseLock(); }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      log.error(`文件分析失败: ${safeErrorMessage(error)}`);
      if (!res.headersSent) {
        res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error) })}\n\n`);
        res.end();
      }
    }
  }
}

/** 读取文件内容，尝试多种编码 */
async function readFileContent(buffer: Buffer): Promise<string> {
  // 1. UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.toString('utf-8').replace(/^\uFEFF/, '');
  }
  // 2. UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.toString('utf16le');
  }
  // 3. Try UTF-8 first
  try {
    const utf8 = buffer.toString('utf-8');
    // Quick check: if it has common Chinese chars or looks valid UTF-8
    if (!utf8.includes('\ufffd') || utf8.length < 100) return utf8;
  } catch { /* fallback */ }
  // 4. Fallback to GBK (Chinese Windows log files)
  try {
    const iconv = await import('iconv-lite').catch(() => null);
    if (iconv) return iconv.decode(buffer, 'gbk');
  } catch { /* fallback */ }
  // 5. Last resort: UTF-8 with replacement
  return buffer.toString('utf-8');
}

/** 需要 CLI 转换的非纯文本文件扩展名 */
const CONVERTIBLE_EXTS = new Set(['.xlsx', '.xls', '.zip', '.tar', '.gz', '.tgz']);

/** 确定文件是否需要 CLI 转换 */
function needsConversion(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (CONVERTIBLE_EXTS.has(ext)) return true;
  // .tar.gz / .tgz 等复合扩展名
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz')) return true;
  return false;
}

/** 读取文件内容：纯文本用编码检测，非纯文本通过 CLI 工具转换 */
async function readAndConvertFile(buffer: Buffer, filename: string): Promise<string> {
  if (needsConversion(filename)) {
    return convertWithCLI(buffer, filename);
  }
  return readFileContent(buffer);
}

/**
 * 通过 Python CLI 脚本将非纯文本文件转换为文本
 *
 * 修复要点：
 * 1. 使用 promisify(execFile) 真正等待 Python 进程结束
 * 2. 读取输出文件前检查文件是否存在
 * 3. 捕获 stderr 用于调试
 * 4. 校验文件大小和扩展名
 * 5. 无论成功失败都清理临时文件
 */
async function convertWithCLI(buffer: Buffer, filename: string): Promise<string> {
  const lowerName = filename.toLowerCase();
  const ext = path.extname(filename).toLowerCase();

  // 1. 输入校验
  if (!buffer || buffer.length === 0) {
    return '[文件转换失败] 文件内容为空。';
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return '[文件转换失败] 文件大小超过 10MB 限制。';
  }
  if (!needsConversion(filename)) {
    return `[文件转换失败] 不支持的文件格式: ${ext || '未知'}。`;
  }

  // 2. 准备临时目录（使用项目 data/temp 避免系统临时目录权限问题）
  const tmpDir = path.resolve(process.cwd(), 'data', 'temp', 'file-convert');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  // 使用安全的临时文件名（避免原始文件名中的特殊字符）
  const jobId = randomUUID();
  const safeInputName = `${jobId}_input${ext}`;
  const safeOutputName = `${jobId}_output.txt`;
  const tmpInput = path.join(tmpDir, safeInputName);
  const tmpOutput = path.join(tmpDir, safeOutputName);

  log.info(`CLI 转换开始: ${filename}, 大小: ${(buffer.length / 1024).toFixed(1)} KB, 任务ID: ${jobId}`);

  try {
    // 3. 写入临时输入文件
    await writeFile(tmpInput, buffer);
    log.debug(`临时输入文件已写入: ${tmpInput}`);

    // 4. 找到嵌入式 Python
    const pythonPath = findEmbeddedPython();
    if (!pythonPath) {
      return `[文件转换失败] 未找到可用的 Python 环境，无法解析 ${ext} 文件。

原始文件类型: ${ext}
文件大小: ${(buffer.length / 1024).toFixed(1)} KB

请尝试将文件导出为 .txt / .csv / .log 等纯文本格式后再上传。`;
    }

    // 5. 找到转换脚本
    const scriptPath = findConverterScript();
    if (!scriptPath) {
      return `[文件转换失败] 未找到文件转换脚本。请检查 scripts/file_converter.py 是否存在。`;
    }

    // 6. 执行转换（真正等待子进程结束）
    const { stdout, stderr } = await execFileAsync(pythonPath, [scriptPath, tmpInput, tmpOutput], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    if (stderr) {
      log.warn(`CLI 转换 stderr: ${filename}: ${stderr.slice(0, 500)}`);
    }

    // 7. 检查输出文件是否存在
    if (!existsSync(tmpOutput)) {
      log.error(`CLI 转换后输出文件不存在: ${tmpOutput}`);
      return `[文件转换失败] Python 转换后未生成输出文件。

文件类型: ${ext}
可能原因: 转换脚本异常或输出路径不可写

建议：请将文件导出为 .txt / .csv / .log 等纯文本格式后再上传。`;
    }

    // 8. 读取输出
    const output = await readFile(tmpOutput, 'utf-8');

    if (!output || output.trim().length === 0) {
      return `[文件转换完成] 文件已转换，但内容为空。

文件类型: ${ext}
可能原因: Excel 工作表为空，或压缩包中无文本文件。`;
    }

    const preview = output.slice(0, 300).replace(/\s+/g, ' ');
    log.info(`CLI 转换完成: ${filename} (${(buffer.length / 1024).toFixed(1)} KB → ${(output.length / 1024).toFixed(1)} KB 文本) 任务ID: ${jobId}\n预览: ${preview}...`);

    return output;
  } catch (err: any) {
    log.warn(`CLI 转换失败: ${filename}: ${err.message || err}`);
    if (err.stderr) {
      log.warn(`CLI 转换失败 stderr: ${err.stderr.slice(0, 500)}`);
    }

    // 区分错误类型，给出更友好的提示
    let reason = err.message || '未知错误';
    if (err.killed && err.signal === 'SIGTERM') {
      reason = '转换超时（超过 30 秒）';
    } else if (err.code === 'ENOENT') {
      reason = '转换输出文件未生成（Python 进程可能异常退出）';
    }

    return `[文件转换失败] 无法解析 "${filename}"。

文件类型: ${ext}
原因: ${reason}

建议：请将文件导出为 .txt / .csv / .log 等纯文本格式后再上传。`;
  } finally {
    // 9. 清理临时文件（静默忽略错误）
    try { await unlink(tmpInput); } catch { /* ignore */ }
    try { await unlink(tmpOutput); } catch { /* ignore */ }
  }
}

/** 查找嵌入式 Python 解释器路径 */
function findEmbeddedPython(): string | null {
  // 项目内置 embedded Python
  const candidates = [
    path.resolve(process.cwd(), 'data', 'python-embedded', 'python.exe'),
    path.resolve(process.cwd(), 'data', 'python-embedded', 'python'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // 降级：尝试系统 Python
  try {
    const result = execSync('python3 --version 2>nul || python --version 2>nul || py -3 --version 2>nul', { timeout: 3000 });
    if (result) return 'python';
  } catch {}
  return null;
}

/** 查找文件转换脚本路径 */
function findConverterScript(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'scripts', 'file_converter.py'),
    path.resolve(__dirname, '..', '..', 'scripts', 'file_converter.py'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
