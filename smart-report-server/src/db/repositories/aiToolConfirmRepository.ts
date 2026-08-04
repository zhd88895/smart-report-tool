/**
 * AI 工具待确认调用仓储
 *
 * 对应 `pending_tool_calls` 表（建表见 db/database.ts createSchema）。
 * 两种用途：
 * 1. 写/执行类工具（write_script/run_script）的待确认记录：
 *    工具被模型调用时只落 pending 记录，用户确认后才真正执行；
 * 2. 工具级 DB 审计：只读工具调用也写一条 status='executed' 的记录
 *    （含 tool 名、参数摘要、结果状态）。
 *
 * 归属校验：confirm/cancel 均通过 WHERE id=? AND user_id=? 限定，
 * 不匹配一律按「不存在」处理（路由层返回 404）。
 *
 * @module db/repositories/aiToolConfirmRepository
 */

import { randomUUID } from 'crypto';
import { getAsync, allAsync, runAsync } from '../database';

/** 待确认记录状态机：pending → confirmed → executed；pending → cancelled */
export type PendingToolStatus = 'pending' | 'confirmed' | 'cancelled' | 'executed';

export interface PendingToolCallRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  tool: string;
  args: Record<string, unknown>;
  status: PendingToolStatus;
  /** 执行结果/错误摘要（JSON 字符串存库，读取时透传） */
  result: string | null;
  createdAt: string;
}

function rowToRecord(row: any): PendingToolCallRecord {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id ?? null,
    tool: row.tool,
    args: safeJsonParse(row.args, {}),
    status: row.status,
    result: row.result ?? null,
    createdAt: row.created_at,
  };
}

function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

export const aiToolConfirmRepository = {
  /**
   * 创建一条工具调用记录
   * - 写/执行类工具：status='pending'，等待用户确认
   * - 只读工具审计：status='executed'，result 为结果摘要
   */
  async create(data: {
    userId: string;
    conversationId?: string | null;
    tool: string;
    args: Record<string, unknown>;
    status?: PendingToolStatus;
    result?: string | null;
  }): Promise<PendingToolCallRecord> {
    const record: PendingToolCallRecord = {
      id: `ptc_${randomUUID()}`,
      userId: data.userId,
      conversationId: data.conversationId ?? null,
      tool: data.tool,
      args: data.args ?? {},
      status: data.status ?? 'pending',
      result: data.result ?? null,
      createdAt: new Date().toISOString(),
    };
    await runAsync(
      `INSERT INTO pending_tool_calls (id, user_id, conversation_id, tool, args, status, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.conversationId,
        record.tool,
        JSON.stringify(record.args),
        record.status,
        record.result,
        record.createdAt,
      ]
    );
    return record;
  },

  /** 归属校验读取：WHERE id=? AND user_id=?，不匹配返回 null（路由层 404） */
  async findByIdAndUser(id: string, userId: string): Promise<PendingToolCallRecord | null> {
    const row = await getAsync(
      'SELECT * FROM pending_tool_calls WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return row ? rowToRecord(row) : null;
  },

  /**
   * 条件状态迁移（归属 + 当前状态双重限定，防并发重复确认/取消）。
   * 返回是否迁移成功（changes > 0）。
   */
  async transitionStatus(
    id: string,
    userId: string,
    fromStatus: PendingToolStatus,
    toStatus: PendingToolStatus,
    result?: string | null
  ): Promise<boolean> {
    const res = await runAsync(
      `UPDATE pending_tool_calls SET status = ?, result = COALESCE(?, result)
       WHERE id = ? AND user_id = ? AND status = ?`,
      [toStatus, result ?? null, id, userId, fromStatus]
    );
    return (res.changes ?? 0) > 0;
  },

  /** 不限定当前状态的更新（执行完成后写结果），仍校验归属 */
  async updateResult(
    id: string,
    userId: string,
    status: PendingToolStatus,
    result: string
  ): Promise<boolean> {
    const res = await runAsync(
      `UPDATE pending_tool_calls SET status = ?, result = ?
       WHERE id = ? AND user_id = ?`,
      [status, result, id, userId]
    );
    return (res.changes ?? 0) > 0;
  },

  /** 某用户的近期工具调用记录（审计查询用） */
  async findRecentByUser(userId: string, limit = 50): Promise<PendingToolCallRecord[]> {
    const rows = await allAsync(
      'SELECT * FROM pending_tool_calls WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, Math.max(1, Math.min(limit, 200))]
    );
    return rows.map(rowToRecord);
  },
};
