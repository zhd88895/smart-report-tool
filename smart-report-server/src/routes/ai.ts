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
import { authenticate } from '../middleware/auth';
import { ApiResponse, safeErrorMessage } from '../types';
import { callUserAI, callUserAIStream, AIMessage } from '../services/aiProviderService';
import { fileDedupService } from '../services/fileDedupService';
import { isArchiveFile, extractEntries, smartSelect } from '../services/archiveAnalysisService';
import { runToolLoop, runToolLoopStream } from '../services/aiTools/registry';
import { executeRunScript, executeWriteScript } from '../services/aiTools/confirmTools';
import { aiToolConfirmRepository } from '../db/repositories/aiToolConfirmRepository';
import { analysisTaskRepository } from '../db/repositories/analysisTaskRepository';
import { analysisTaskService } from '../services/analysisTaskService';
import { userAIConfigService } from '../services/userAIConfigService';
import { getPrompt, CATEGORY_KEYS } from '../services/aiPrompts';
import { settingsService } from '../services/settingsService';
import { getLogger } from '../utils/logger';
import { buildKnowledgeContext } from '../utils/knowledgeExcerpt';
import { readAndConvertFile } from '../utils/fileTextConvert';

const log = getLogger('AIRoutes', 'core');

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
//  知识库上下文构建已抽取至 utils/knowledgeExcerpt.ts（与任务队列服务共用）
// ═══════════════════════════════════════════════════════

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

    // AI 文件分析（multipart upload，内存存储，限制从系统设置动态读取）
    this.router.post('/analyze-file', authenticate, (req, res, next) => {
      const limitMB = settingsService.getNumber('storage.uploadLimit', 50);
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limitMB * 1024 * 1024 } });
      upload.single('file')(req, res, next);
    }, this.analyzeFile.bind(this));

    // 分析任务队列（服务端集中排队，刷新/断线可恢复）
    this.router.post('/analysis-tasks', authenticate, (req, res, next) => {
      const limitMB = settingsService.getNumber('storage.uploadLimit', 50);
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limitMB * 1024 * 1024 } });
      upload.single('file')(req, res, next);
    }, this.createAnalysisTask.bind(this));
    this.router.get('/analysis-tasks', authenticate, this.listAnalysisTasks.bind(this));
    this.router.get('/analysis-tasks/:id', authenticate, this.getAnalysisTask.bind(this));
    this.router.get('/analysis-tasks/:id/stream', authenticate, this.streamAnalysisTask.bind(this));
    this.router.post('/analysis-tasks/:id/cancel', authenticate, this.cancelAnalysisTask.bind(this));
    this.router.post('/analysis-tasks/:id/retry', authenticate, this.retryAnalysisTask.bind(this));
    this.router.delete('/analysis-tasks/:id', authenticate, this.deleteAnalysisTask.bind(this));
  }

  /** 非流式聊天：按当前登录用户的数据库配置统一调用；enableTools 时走工具循环 */
  private async chat(req: Request, res: Response): Promise<void> {
    try {
      const { messages = [], modelId, enableTools, conversationId } = req.body as { messages: AIMessage[]; modelId?: string; enableTools?: boolean; conversationId?: string };
      if (!messages.length) {
        res.status(400).json({ code: 400, data: null, message: '消息不能为空' } satisfies ApiResponse<null>);
        return;
      }
      if (enableTools) {
        const result = await runToolLoop(req.user!.userId, {
          messages: [{ role: 'system', content: buildToolSystemPrompt() }, ...messages],
          modelId, feature: 'chat', conversationId,
        });
        if (result.fallback) res.setHeader('X-AI-Fallback', 'true');
        res.status(200).json({ code: 200, data: result, message: 'success' } satisfies ApiResponse<any>);
        return;
      }
      const result = await callUserAI(req.user!.userId, {
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...messages],
        modelId, feature: 'chat', conversationId,
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
      const { messages = [], modelId, enableTools, conversationId } = req.body as { messages: AIMessage[]; modelId?: string; enableTools?: boolean; conversationId?: string };
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
              modelId, feature: 'chat', conversationId,
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
        modelId, feature: 'chat', conversationId,
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

      // 用户补充提示（提前提取，快速/Agentic 两种路径共用）
      const userHintRaw = (req.body as any)?.userHint;
      const userHint = typeof userHintRaw === 'string' && userHintRaw.trim()
        ? userHintRaw.trim().slice(0, 2000)
        : undefined;

      // 读取文件内容：压缩包走解压+智能筛选/Agentic，普通文件走文本/CLI 转换
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

        // Agentic 分流：正则筛选无结果但有文本 / 预算装不下 / 文件数过多
        const useAgentic = (summary.selected === 0 && summary.textFiles > 0)
          || summary.skippedBudget > 0
          || entries.length > 400;

        if (useAgentic) {
          // ── Agentic 路径：AI 自主选择文件读取 ──
          log.info(`支持包 Agentic 分析: ${entries.length} 个文件, selected=${summary.selected}, skippedBudget=${summary.skippedBudget}, textFiles=${summary.textFiles}`);

          // 构建知识库上下文（用文件路径做关键词提取）
          const agentKnowledge = await buildKnowledgeContext(
            knowledgeFileIds, entries.map((e: any) => e.path).join('\n'), fileName
          );

          // SSE 头
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();

          const sendProgress = (msg: string) => {
            res.write(`data: ${JSON.stringify({ type: 'pack_progress', message: msg })}\n\n`);
          };

          sendProgress(`压缩包包含 ${entries.length} 个文件，启用智能分析模式...`);

          try {
            const { analyzeWithAgent } = await import('../services/supportPackAgentService');
            const result = await analyzeWithAgent(req.user!.userId, entries, {
              category, customPrompt, supplements,
              knowledgeContext: agentKnowledge, userHint, modelId,
              onProgress: sendProgress,
            });

            if (result.fallback) {
              res.write(`data: ${JSON.stringify({ type: 'fallback_notice' })}\n\n`);
            }

            sendProgress('分析完成，正在生成报告...');

            // 合成流式输出：按 ~200 字符切块，与正常流式格式一致
            const CHUNK = 200;
            for (let i = 0; i < result.report.length; i += CHUNK) {
              const chunk = result.report.slice(i, i + CHUNK);
              const sseData = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
              res.write(`data: ${sseData}\n\n`);
            }

            res.write('data: [DONE]\n\n');
            res.end();
          } catch (agentError: any) {
            log.error(`Agentic 分析失败: ${safeErrorMessage(agentError)}`);
            res.write(`event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(agentError) })}\n\n`);
            res.end();
          }
          return;
        }

        // 快速路径：智能筛选成功
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
      const knowledgeContext = await buildKnowledgeContext(knowledgeFileIds, content, fileName);

      let prompt = getPrompt(category, content + knowledgeContext, customPrompt, supplements);

      // 用户补充提示：追加到提示词末尾（userHint 已在上方统一提取）
      if (userHint) {
        prompt += `\n\n## 用户补充提示\n用户提供了以下背景信息，请在分析时重点关注：\n${userHint}`;
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

  // ═══════════════════════════════════════════════════════
  //  分析任务队列（服务端集中排队，刷新/断线可恢复）
  // ═══════════════════════════════════════════════════════

  /** 创建分析任务（multipart）：文件入去重存储 → 落库 → 排队调度 */
  private async createAnalysisTask(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      const dedupHash = (((req.body as any)?.dedupHash as string) || '').toLowerCase();
      const category = ((req.body as any)?.category as string) || 'other';
      const customPrompt = ((req.body as any)?.customPrompt as string) || '';
      const modelId = ((req.body as any)?.modelId as string) || null;
      const modelName = (((req.body as any)?.modelName as string) || '').slice(0, 200);
      const author = (((req.body as any)?.author as string) || '').slice(0, 100);
      const supplementsStr = (req.body as any)?.supplements as string;
      const supplements = supplementsStr ? JSON.parse(supplementsStr) : [];
      const knowledgeFileIdsStr = (req.body as any)?.knowledgeFileIds as string;
      const knowledgeFileIds: string[] = knowledgeFileIdsStr ? JSON.parse(knowledgeFileIdsStr) : [];
      const userHintRaw = (req.body as any)?.userHint;
      const userHint = typeof userHintRaw === 'string' && userHintRaw.trim()
        ? userHintRaw.trim().slice(0, 2000)
        : '';

      if (!CATEGORY_KEYS.includes(category)) {
        res.status(400).json({ code: 400, data: null, message: '无效的日志类别' } satisfies ApiResponse<null>);
        return;
      }

      // 文件实体入去重存储：秒传引用或新上传 buffer
      let fileHash: string;
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
        fileHash = dedupHash;
        fileName = entry.fileName;
      } else {
        if (!file) {
          res.status(400).json({ code: 400, data: null, message: '请上传巡检日志文件' } satisfies ApiResponse<null>);
          return;
        }
        const stored = await fileDedupService.registerBuffer(file.buffer, file.originalname, req.user!.userId);
        fileHash = stored.hash;
        fileName = file.originalname;
      }

      const task = await analysisTaskRepository.create({
        userId: req.user!.userId,
        fileName, fileHash, category, customPrompt, supplements,
        knowledgeFileIds, modelId, modelName, author, userHint,
      });
      await analysisTaskService.enqueue(task.id);

      // 告知排队位次（全局队列中的排队任务数）
      const queued = (await analysisTaskRepository.findOldestQueued());
      const isRunning = analysisTaskService.isRunning(task.id);
      res.status(200).json({
        code: 200,
        data: { task, queuedAhead: !isRunning && queued && queued.id !== task.id ? 1 : 0 },
        message: 'success',
      } satisfies ApiResponse<any>);
    } catch (error: any) {
      log.error(`创建分析任务失败: ${safeErrorMessage(error)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** 当前用户的任务列表（新的在前） */
  private async listAnalysisTasks(req: Request, res: Response): Promise<void> {
    try {
      const tasks = await analysisTaskRepository.listByUser(req.user!.userId);
      res.status(200).json({ code: 200, data: { tasks }, message: 'success' } satisfies ApiResponse<any>);
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** 任务详情（含终态结果全文） */
  private async getAnalysisTask(req: Request, res: Response): Promise<void> {
    try {
      const task = await analysisTaskRepository.findByIdAndUser(req.params.id as string, req.user!.userId);
      if (!task) {
        res.status(404).json({ code: 404, data: null, message: '任务不存在' } satisfies ApiResponse<null>);
        return;
      }
      res.status(200).json({ code: 200, data: { task }, message: 'success' } satisfies ApiResponse<any>);
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /**
   * 任务事件流（SSE，断线重连友好）：
   * - queued：保持连接，开始执行后推送进度与增量
   * - running：先补发已累积的输出，再接续实时增量
   * - done/error/cancelled：直接推送终态结果并结束
   */
  private async streamAnalysisTask(req: Request, res: Response): Promise<void> {
    const taskId = req.params.id as string;
    const userId = req.user!.userId;
    try {
      const task = await analysisTaskRepository.findByIdAndUser(taskId, userId);
      if (!task) {
        res.status(404).json({ code: 404, data: null, message: '任务不存在' } satisfies ApiResponse<null>);
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const writeEvent = (payload: unknown): void => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // 终态任务：直接回放结果并结束
      if (task.status === 'done') {
        if (task.resultText) writeEvent({ choices: [{ delta: { content: task.resultText } }] });
        writeEvent({ type: 'task_done', reportId: task.reportId });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (task.status === 'error' || task.status === 'cancelled') {
        writeEvent({ type: 'task_error', message: task.error || '任务已取消' });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // 排队/运行中：订阅实时事件
      if (task.status === 'queued') {
        writeEvent({ type: 'pack_progress', message: '排队等待中，前面的任务完成后自动开始...' });
      }
      if (task.status === 'running') {
        // 已处于执行中：先告知订阅者切换状态，再补发累积输出
        writeEvent({ type: 'task_started' });
      }
      const { runtime, unsubscribe } = analysisTaskService.subscribe(taskId, writeEvent);
      // 补发已累积的输出与当前进度（运行中重连）
      if (runtime && runtime.text) writeEvent({ choices: [{ delta: { content: runtime.text } }] });
      if (runtime && runtime.progress) writeEvent({ type: 'pack_progress', message: runtime.progress });
      if (runtime?.fallback) writeEvent({ type: 'fallback_notice' });

      req.on('close', () => unsubscribe());
    } catch (error: any) {
      log.error(`任务事件流失败: ${safeErrorMessage(error)}`);
      if (!res.headersSent) {
        res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error) })}\n\n`);
        res.end();
      }
    }
  }

  /** 重试任务：重置原任务记录重新排队（可选换模型），文件引用去重存储，不产生新任务标签 */
  private async retryAnalysisTask(req: Request, res: Response): Promise<void> {
    try {
      const source = await analysisTaskRepository.findByIdAndUser(req.params.id as string, req.user!.userId);
      if (!source) {
        res.status(404).json({ code: 404, data: null, message: '任务不存在' } satisfies ApiResponse<null>);
        return;
      }
      if (source.status !== 'done' && source.status !== 'error' && source.status !== 'cancelled') {
        res.status(409).json({ code: 409, data: null, message: '任务尚未结束，不能重试' } satisfies ApiResponse<null>);
        return;
      }
      // 文件实体必须还在去重存储中
      const entry = await fileDedupService.lookup(source.fileHash);
      if (!entry) {
        res.status(410).json({ code: 410, data: null, message: '原文件已过期被清理，无法重试，请重新上传' } satisfies ApiResponse<null>);
        return;
      }
      await fileDedupService.touch(source.fileHash);

      const { modelId, modelName } = req.body as { modelId?: string; modelName?: string };
      // 重置原任务（指定了新模型就换，未指定沿用原模型）
      const task = await analysisTaskRepository.resetForRetry(
        source.id,
        req.user!.userId,
        modelId !== undefined ? { modelId, modelName } : undefined
      );
      if (!task) {
        res.status(409).json({ code: 409, data: null, message: '任务尚未结束，不能重试' } satisfies ApiResponse<null>);
        return;
      }
      // 清掉旧运行时（旧结果/残留订阅），再重新排队
      analysisTaskService.resetRuntime(task.id);
      await analysisTaskService.enqueue(task.id);
      res.status(200).json({ code: 200, data: { task }, message: 'success' } satisfies ApiResponse<any>);
    } catch (error: any) {
      log.error(`重试分析任务失败: ${safeErrorMessage(error)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** 取消排队中的任务（运行中的不可取消） */
  private async cancelAnalysisTask(req: Request, res: Response): Promise<void> {
    try {
      const ok = await analysisTaskRepository.cancel(req.params.id as string, req.user!.userId);
      if (!ok) {
        res.status(409).json({ code: 409, data: null, message: '任务不存在或已在执行，无法取消' } satisfies ApiResponse<null>);
        return;
      }
      res.status(200).json({ code: 200, data: null, message: '任务已取消' } satisfies ApiResponse<null>);
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }

  /** 删除终态任务记录 */
  private async deleteAnalysisTask(req: Request, res: Response): Promise<void> {
    try {
      const ok = await analysisTaskRepository.removeFinished(req.params.id as string, req.user!.userId);
      if (!ok) {
        res.status(409).json({ code: 409, data: null, message: '任务不存在或尚未结束，不能删除' } satisfies ApiResponse<null>);
        return;
      }
      res.status(200).json({ code: 200, data: null, message: '任务记录已删除' } satisfies ApiResponse<null>);
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(error) } satisfies ApiResponse<null>);
    }
  }
}
