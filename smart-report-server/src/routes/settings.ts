/**
 * 系统设置路由
 *
 * @module routes/settings
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { ApiResponse, safeErrorMessage } from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('SettingsRoutes', 'core');

export class SettingsRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router { return this.router; }

  private setupRoutes(): void {
    this.router.get('/', authenticate, this.getAll.bind(this));
    this.router.post('/', authenticate, this.update.bind(this));
    this.router.get('/categories', authenticate, this.getCategories.bind(this));
    this.router.get('/history', authenticate, this.getRecentHistory.bind(this));
    this.router.get('/history/:key', authenticate, this.getKeyHistory.bind(this));
  }

  /** 获取所有设置（角色过滤） */
  private async getAll(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role || 'member';
      const settings = await settingsService.getSettings(role);
      res.json({ code: 200, data: { settings, categories: [...new Set(settings.map(s => s.category))] }, message: 'success' } satisfies ApiResponse<any>);
    } catch (err: any) {
      log.error(`获取设置失败: ${safeErrorMessage(err)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }

  /** 批量更新设置（仅 admin） */
  private async update(req: Request, res: Response): Promise<void> {
    try {
      if (req.user?.role !== 'admin') {
        res.status(403).json({ code: 403, data: null, message: '仅管理员可修改系统设置' } satisfies ApiResponse<null>);
        return;
      }

      const { updates } = req.body as { updates: Array<{ key: string; value: string }> };
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        res.status(400).json({ code: 400, data: null, message: '缺少 updates 参数' } satisfies ApiResponse<null>);
        return;
      }

      // 扩展名类设置：自动补全开头的点（用户可省略不输）
      const EXTENSION_KEYS = new Set(['storage.archiveExtensions', 'storage.textExtensions']);
      for (const u of updates) {
        if (EXTENSION_KEYS.has(u.key) && typeof u.value === 'string') {
          u.value = u.value.split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map((s) => (s.startsWith('.') ? s : `.${s}`))
            .join(',');
        }
      }

      await settingsService.updateSettings(
        updates,
        req.user.userId,
        req.user.username,
      );

      res.json({ code: 200, data: { success: true }, message: '设置已更新' } satisfies ApiResponse<any>);
    } catch (err: any) {
      log.error(`更新设置失败: ${safeErrorMessage(err)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }

  /** 获取分类列表 */
  private async getCategories(_req: Request, res: Response): Promise<void> {
    try {
      const categories = await settingsService.getCategories();
      res.json({ code: 200, data: { categories }, message: 'success' } satisfies ApiResponse<any>);
    } catch (err: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }

  /** 获取全局修改记录 */
  private async getRecentHistory(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 30;
      const history = await settingsService.getRecentHistory(limit);
      res.json({ code: 200, data: { history }, message: 'success' } satisfies ApiResponse<any>);
    } catch (err: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }

  /** 获取单个键的修改历史 */
  private async getKeyHistory(req: Request, res: Response): Promise<void> {
    try {
      const key = req.params.key as string;
      const limit = parseInt(String(req.query.limit) || '30');
      const history = await settingsService.getHistory(key, limit);
      res.json({ code: 200, data: { history }, message: 'success' } satisfies ApiResponse<any>);
    } catch (err: any) {
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }
}

export const settingsRoutes = new SettingsRoutes();
