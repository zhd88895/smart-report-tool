/**
 * 系统日志路由（仅管理员）
 *
 * - GET /api/audit-logs?category=security|settings|auth  分页查询审计日志
 * - GET /api/audit-logs/runtime?lines=300                读取后端运行日志（日志文件尾部）
 *
 * @module routes/auditLogs
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { getConfig } from '../config';
import { auditLogService, AuditCategory } from '../services/auditLogService';
import { ApiResponse, safeErrorMessage } from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('AuditLogRoutes', 'other');

const VALID_CATEGORIES: AuditCategory[] = ['security', 'settings', 'auth'];

interface RuntimeLogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
}

export class AuditLogRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router { return this.router; }

  private setupRoutes(): void {
    this.router.get('/', authenticate, this.queryLogs.bind(this));
    this.router.get('/runtime', authenticate, this.getRuntimeLogs.bind(this));
  }

  /** 仅管理员可查看系统日志 */
  private requireAdmin(req: Request, res: Response): boolean {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ code: 403, data: null, message: '仅管理员可查看系统日志' } satisfies ApiResponse<null>);
      return false;
    }
    return true;
  }

  /** 分页查询审计日志 */
  private async queryLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!this.requireAdmin(req, res)) return;

      const category = String(req.query.category || 'security') as AuditCategory;
      if (!VALID_CATEGORIES.includes(category)) {
        res.status(400).json({ code: 400, data: null, message: '无效的日志分类' } satisfies ApiResponse<null>);
        return;
      }

      const result = await auditLogService.query({
        category,
        limit: parseInt(String(req.query.limit || '50'), 10) || 50,
        offset: parseInt(String(req.query.offset || '0'), 10) || 0,
        search: (req.query.search as string) || undefined,
      });

      res.json({ code: 200, data: result, message: 'success' } satisfies ApiResponse<any>);
    } catch (err: any) {
      log.error(`查询审计日志失败: ${safeErrorMessage(err)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }

  /**
   * 读取后端运行日志
   *
   * 日志文件按模块分文件、按日期滚动（{LOGS_DIR}/{Module}_{YYYY-MM-DD}.log），
   * 这里合并今天与昨天的所有模块日志，按时间排序后取尾部 N 条返回。
   */
  private async getRuntimeLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!this.requireAdmin(req, res)) return;

      const maxLines = Math.min(parseInt(String(req.query.lines || '300'), 10) || 300, 1000);
      const levelFilter = String(req.query.level || '').toUpperCase();

      const logDir = getConfig().LOGS_DIR;
      if (!existsSync(logDir)) {
        res.json({ code: 200, data: { logs: [] }, message: 'success' } satisfies ApiResponse<any>);
        return;
      }

      const dayStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = dayStr(new Date());
      const yesterday = dayStr(new Date(Date.now() - 86400000));

      const files = (await fs.readdir(logDir)).filter(
        (f) => f.endsWith('.log') && (f.includes(today) || f.includes(yesterday))
      );

      const entries: RuntimeLogEntry[] = [];
      // 文本格式: [ISO时间] [级别] [模块] [TraceID] 消息
      const LINE_RE = /^\[([^\]]+)\] \[(\w+)\] \[([^\]]+)\] \[[^\]]*\] (.*)$/;

      for (const file of files) {
        try {
          const content = await fs.readFile(path.join(logDir, file), 'utf-8');
          for (const line of content.split('\n')) {
            const m = LINE_RE.exec(line);
            if (!m) continue;
            if (levelFilter && m[2] !== levelFilter) continue;
            entries.push({ timestamp: m[1], level: m[2], module: m[3], message: m[4] });
          }
        } catch { /* 单个文件读取失败不影响整体 */ }
      }

      entries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
      const logs = entries.slice(-maxLines).reverse(); // 最新的在前

      res.json({ code: 200, data: { logs }, message: 'success' } satisfies ApiResponse<any>);
    } catch (err: any) {
      log.error(`读取运行日志失败: ${safeErrorMessage(err)}`);
      res.status(500).json({ code: 500, data: null, message: safeErrorMessage(err) } satisfies ApiResponse<null>);
    }
  }
}

export const auditLogRoutes = new AuditLogRoutes();
