/**
 * 用户级 AI 配置路由模块
 *
 * 提供 /api/ai-config/* 共 15 个端点：
 * - 厂商 CRUD、启用/停用、远端模型拉取与差量导入
 * - 模型 CRUD、启用/停用、设为默认
 * - 连接测试、模型选择器数据源（resolved）、用量统计
 *
 * 全部端点需要认证，userId 只从 req.user!.userId 取（不接受前端传 userId）。
 * 资源不存在（含越权访问他人资源）统一返回 404「资源不存在」。
 * 任何 GET 响应不包含 api_key 原文（服务层出库即打码为 apiKeyMasked）。
 *
 * @module routes/aiConfig
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { ApiResponse, safeErrorMessage } from '../types';
import { userAIConfigService } from '../services/userAIConfigService';
import { userAIConfigRepository } from '../db/repositories/userAIConfigRepository';
import { startLimitProbe, getLimitProbeJob } from '../services/modelLimitProbeService';

/** 统一 404 响应：资源不存在（含越权访问他人资源） */
function sendNotFound(res: Response): void {
  const response: ApiResponse<null> = {
    code: 404,
    data: null,
    message: '资源不存在',
    error: '资源不存在',
  };
  res.status(404).json(response);
}

/** 统一错误响应 */
function sendError(res: Response, status: number, message: string, error: unknown): void {
  const response: ApiResponse<null> = {
    code: status,
    data: null,
    message,
    error: safeErrorMessage(error),
  };
  res.status(status).json(response);
}

/**
 * 用户级 AI 配置路由类
 */
export class AIConfigRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由（全部需要认证）
   */
  private setupRoutes(): void {
    // ── 厂商 ──
    // 我的厂商列表（含模型数，api_key 打码）
    this.router.get('/providers', authenticate, this.listProviders.bind(this));
    // 新增厂商
    this.router.post('/providers', authenticate, this.createProvider.bind(this));
    // 修改厂商（apiKey 留空表示不改动）
    this.router.put('/providers/:id', authenticate, this.updateProvider.bind(this));
    // 删除厂商（级联删模型）
    this.router.delete('/providers/:id', authenticate, this.deleteProvider.bind(this));
    // 启用/停用厂商
    this.router.put('/providers/:id/toggle', authenticate, this.toggleProvider.bind(this));
    // 某厂商下我的模型列表
    this.router.get('/providers/:id/models', authenticate, this.listModels.bind(this));
    // 手动添加模型
    this.router.post('/providers/:id/models', authenticate, this.createModel.bind(this));
    // 拉取远端模型列表，返回未添加的差量，支持批量导入
    this.router.post('/providers/:id/fetch-models', authenticate, this.fetchModels.bind(this));

    // ── 模型 ──
    // 修改模型参数
    this.router.put('/models/:id', authenticate, this.updateModel.bind(this));
    // 删除模型
    this.router.delete('/models/:id', authenticate, this.deleteModel.bind(this));
    // 启用/停用模型
    this.router.put('/models/:id/toggle', authenticate, this.toggleModel.bind(this));
    // 设为默认模型
    this.router.put('/models/:id/set-default', authenticate, this.setDefaultModel.bind(this));
    // 测试模型可用性（发送最小对话请求，返回耗时与回复摘要）
    this.router.post('/models/:id/test', authenticate, this.testModel.bind(this));
    // 启动模型上限探测（异步任务，真实消耗 API 额度）
    this.router.post('/models/:id/probe-limits', authenticate, this.startProbeLimits.bind(this));
    // 查询上限探测任务进度
    this.router.get('/probe-jobs/:jobId', authenticate, this.getProbeJob.bind(this));

    // ── 辅助 ──
    // 测试连接（providerId 或内联厂商配置，不持久化）
    this.router.post('/test-connection', authenticate, this.testConnection.bind(this));
    // 我的默认模型 + 全部启用模型精简列表（模型选择器数据源）
    this.router.get('/resolved', authenticate, this.getResolved.bind(this));
    // 我的用量统计（按模型/功能聚合，近 30 天）
    this.router.get('/usage', authenticate, this.getUsage.bind(this));
    // 我的调用记录列表（分页，可按功能筛选，不含请求体大字段）
    this.router.get('/call-logs', authenticate, this.listCallLogs.bind(this));
    // 单条调用记录详情（含请求体快照）
    this.router.get('/call-logs/:id', authenticate, this.getCallLogDetail.bind(this));
  }

  // ═══════════════════════════════════════════════════════
  //  厂商端点
  // ═══════════════════════════════════════════════════════

  /** GET /providers — 我的厂商列表 */
  private async listProviders(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const providers = await userAIConfigService.listProviders(userId);
      const response: ApiResponse<{ providers: typeof providers }> = {
        code: 200,
        data: { providers },
        message: '获取厂商列表成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 500, '获取厂商列表失败', error);
    }
  }

  /** POST /providers — 新增厂商 */
  private async createProvider(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { vendorKey, name, baseUrl, apiKey } = req.body ?? {};
      const provider = await userAIConfigService.createProvider(userId, { vendorKey, name, baseUrl, apiKey });
      const response: ApiResponse<{ provider: typeof provider }> = {
        code: 201,
        data: { provider },
        message: '厂商创建成功',
      };
      res.status(201).json(response);
    } catch (error) {
      sendError(res, 400, '厂商创建失败', error);
    }
  }

  /** PUT /providers/:id — 修改厂商 */
  private async updateProvider(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const { name, baseUrl, apiKey, sortOrder } = req.body ?? {};
      const provider = await userAIConfigService.updateProvider(userId, id, { name, baseUrl, apiKey, sortOrder });
      if (!provider) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ provider: typeof provider }> = {
        code: 200,
        data: { provider },
        message: '厂商更新成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '厂商更新失败', error);
    }
  }

  /** DELETE /providers/:id — 删除厂商 */
  private async deleteProvider(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const ok = await userAIConfigService.deleteProvider(userId, id);
      if (!ok) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '厂商删除成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '厂商删除失败', error);
    }
  }

  /** PUT /providers/:id/toggle — 启用/停用厂商 */
  private async toggleProvider(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
      const provider = await userAIConfigService.toggleProvider(userId, id, enabled);
      if (!provider) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ provider: typeof provider }> = {
        code: 200,
        data: { provider },
        message: provider.enabled ? '厂商已启用' : '厂商已停用',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '厂商状态切换失败', error);
    }
  }

  /** GET /providers/:id/models — 某厂商下我的模型列表 */
  private async listModels(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const providerId = req.params.id as string;
      const models = await userAIConfigService.listModels(userId, providerId);
      if (!models) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ models: typeof models }> = {
        code: 200,
        data: { models },
        message: '获取模型列表成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 500, '获取模型列表失败', error);
    }
  }

  /** POST /providers/:id/models — 手动添加模型 */
  private async createModel(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const providerId = req.params.id as string;
      const { modelId, displayName } = req.body ?? {};
      const model = await userAIConfigService.createModel(userId, providerId, { modelId, displayName });
      if (!model) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ model: typeof model }> = {
        code: 201,
        data: { model },
        message: '模型添加成功',
      };
      res.status(201).json(response);
    } catch (error) {
      sendError(res, 400, '模型添加失败', error);
    }
  }

  /** POST /providers/:id/fetch-models — 拉取远端模型差量，import:true 时批量导入 */
  private async fetchModels(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const providerId = req.params.id as string;
      const doImport = req.body?.import === true;
      const result = await userAIConfigService.fetchModels(userId, providerId, doImport);
      if (!result) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<typeof result> = {
        code: 200,
        data: result,
        message: doImport ? '模型导入成功' : '获取远端模型列表成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '拉取远端模型失败', error);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  模型端点
  // ═══════════════════════════════════════════════════════

  /** PUT /models/:id — 修改模型参数 */
  private async updateModel(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const { displayName, temperature, maxInputTokens, maxOutputTokens } = req.body ?? {};
      const model = await userAIConfigService.updateModel(userId, id, {
        displayName,
        temperature,
        maxInputTokens,
        maxOutputTokens,
      });
      if (!model) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ model: typeof model }> = {
        code: 200,
        data: { model },
        message: '模型更新成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '模型更新失败', error);
    }
  }

  /** DELETE /models/:id — 删除模型 */
  private async deleteModel(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const ok = await userAIConfigService.deleteModel(userId, id);
      if (!ok) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '模型删除成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '模型删除失败', error);
    }
  }

  /** PUT /models/:id/toggle — 启用/停用模型 */
  private async toggleModel(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
      const model = await userAIConfigService.toggleModel(userId, id, enabled);
      if (!model) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ model: typeof model }> = {
        code: 200,
        data: { model },
        message: model.enabled ? '模型已启用' : '模型已停用',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '模型状态切换失败', error);
    }
  }

  /** PUT /models/:id/set-default — 设为默认模型 */
  private async setDefaultModel(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const ok = await userAIConfigService.setDefaultModel(userId, id);
      if (!ok) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '默认模型设置成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '默认模型设置失败', error);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  辅助端点
  // ═══════════════════════════════════════════════════════

  /** POST /test-connection — 测试连接（不持久化） */
  private async testConnection(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { providerId, vendorKey, baseUrl, apiKey, modelId } = req.body ?? {};
      const result = await userAIConfigService.testConnection(userId, { providerId, vendorKey, baseUrl, apiKey, modelId });
      if (!result) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<typeof result> = {
        code: 200,
        data: result,
        message: result.ok ? '连接测试成功' : '连接测试失败',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '连接测试失败', error);
    }
  }

  /** POST /models/:id/test — 测试模型可用性（真实对话请求） */
  private async testModel(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const result = await userAIConfigService.testModel(userId, req.params.id as string);
      if (!result) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<typeof result> = {
        code: 200,
        data: result,
        message: result.ok ? '模型测试成功' : '模型测试失败',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '模型测试失败', error);
    }
  }

  /** POST /models/:id/probe-limits — 启动上限探测任务（真实调用厂商 API，消耗额度） */
  private async startProbeLimits(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const model = await userAIConfigRepository.getModel(userId, req.params.id as string);
      if (!model) {
        sendNotFound(res);
        return;
      }
      const job = startLimitProbe(userId, model.id, model.display_name || model.model_id);
      const response: ApiResponse<{ job: typeof job }> = {
        code: 202,
        data: { job },
        message: '上限探测已启动',
      };
      res.status(202).json(response);
    } catch (error) {
      sendError(res, 400, '启动上限探测失败', error);
    }
  }

  /** GET /probe-jobs/:jobId — 查询上限探测任务进度与结果 */
  private async getProbeJob(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const job = getLimitProbeJob(userId, req.params.jobId as string);
      if (!job) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<{ job: typeof job }> = {
        code: 200,
        data: { job },
        message: '获取探测任务成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 400, '获取探测任务失败', error);
    }
  }

  /** GET /resolved — 模型选择器数据源 */
  private async getResolved(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const resolved = await userAIConfigService.getResolved(userId);
      const response: ApiResponse<typeof resolved> = {
        code: 200,
        data: resolved,
        message: '获取可用模型成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 500, '获取可用模型失败', error);
    }
  }

  /** GET /usage — 我的用量统计（近 30 天） */
  private async getUsage(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const usage = await userAIConfigService.getUsage(userId);
      const response: ApiResponse<typeof usage> = {
        code: 200,
        data: usage,
        message: '获取用量统计成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 500, '获取用量统计失败', error);
    }
  }

  /** GET /call-logs — 我的调用记录列表（分页 + 功能筛选，不含请求体大字段） */
  private async listCallLogs(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const feature = typeof req.query.feature === 'string' && req.query.feature ? req.query.feature : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;
      const result = await userAIConfigRepository.listCallLogs(userId, { feature, limit, offset });
      const response: ApiResponse<typeof result> = {
        code: 200,
        data: result,
        message: '获取调用记录成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 500, '获取调用记录失败', error);
    }
  }

  /** GET /call-logs/:id — 单条调用记录详情（含请求体快照，仅本人可见） */
  private async getCallLogDetail(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const log = await userAIConfigRepository.getCallLog(userId, String(req.params.id));
      if (!log) {
        sendNotFound(res);
        return;
      }
      const response: ApiResponse<typeof log> = {
        code: 200,
        data: log,
        message: '获取调用记录详情成功',
      };
      res.status(200).json(response);
    } catch (error) {
      sendError(res, 500, '获取调用记录详情失败', error);
    }
  }

  /**
   * 获取路由器
   *
   * @returns Express路由器
   */
  getRouter(): Router {
    return this.router;
  }
}

/**
 * 用户级 AI 配置路由单例实例
 */
export const aiConfigRoutes = new AIConfigRoutes();
