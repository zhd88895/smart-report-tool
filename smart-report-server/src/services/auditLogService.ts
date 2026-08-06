/**
 * 审计日志服务
 *
 * 记录系统内的关键操作，供「系统日志」页面查询：
 * - security：安全审计（用户编辑/删除/角色变更/密码重置等敏感操作，含被拒绝的尝试）
 * - settings：系统设置操作（配置项修改）
 * - auth：登录日志（登录成功/失败、登出）
 *
 * 后端运行日志不入库，由路由层直接读取日志文件目录。
 *
 * @module services/auditLogService
 */

import { randomUUID } from 'crypto';
import { runAsync, allAsync, getAsync } from '../db/database';

export type AuditCategory = 'security' | 'settings' | 'auth';
export type AuditResult = 'success' | 'failed' | 'denied';

export interface AuditLogEntry {
  id: string;
  category: AuditCategory;
  action: string;
  actorId: string | null;
  actorName: string | null;
  target: string | null;
  detail: string | null;
  result: AuditResult;
  ip: string | null;
  createdAt: string;
}

export interface RecordAuditInput {
  category: AuditCategory;
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  target?: string | null;
  detail?: string | null;
  result?: AuditResult;
  ip?: string | null;
}

export interface QueryAuditInput {
  category: AuditCategory;
  limit?: number;
  offset?: number;
  search?: string;
}

class AuditLogService {
  /**
   * 写入一条审计日志。调用方通常无需 await（可 .catch 忽略），
   * 审计写入失败绝不应阻断业务操作。
   */
  async record(input: RecordAuditInput): Promise<void> {
    await runAsync(
      `INSERT INTO audit_logs (id, category, action, actor_id, actor_name, target, detail, result, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.category,
        input.action,
        input.actorId ?? null,
        input.actorName ?? null,
        input.target ?? null,
        input.detail ? String(input.detail).slice(0, 1000) : null,
        input.result ?? 'success',
        input.ip ?? null,
        new Date().toISOString(),
      ]
    );
  }

  /** 分页查询审计日志（按时间倒序） */
  async query(input: QueryAuditInput): Promise<{ logs: AuditLogEntry[]; total: number }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    const params: any[] = [input.category];
    let where = 'category = ?';
    if (input.search && input.search.trim()) {
      where += ' AND (actor_name LIKE ? OR target LIKE ? OR detail LIKE ? OR action LIKE ?)';
      const kw = `%${input.search.trim()}%`;
      params.push(kw, kw, kw, kw);
    }

    const totalRow = await getAsync(`SELECT COUNT(*) AS cnt FROM audit_logs WHERE ${where}`, params);
    const rows = await allAsync(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      total: (totalRow as any)?.cnt ?? 0,
      logs: rows.map((r: any) => ({
        id: r.id,
        category: r.category,
        action: r.action,
        actorId: r.actor_id,
        actorName: r.actor_name,
        target: r.target,
        detail: r.detail,
        result: r.result,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    };
  }
}

export const auditLogService = new AuditLogService();
