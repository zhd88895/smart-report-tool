/**
 * AI 分析任务队列仓储
 *
 * 对应 `analysis_tasks` 表（建表见 db/database.ts 迁移段）。
 * 任务记录持久化到数据库，配合 analysisTaskService 的内存运行时，
 * 实现「刷新页面/断线重连后恢复任务状态」。
 *
 * 归属校验：所有按 ID 的读写都带 user_id 限定，不匹配按「不存在」处理。
 *
 * @module db/repositories/analysisTaskRepository
 */

import { randomUUID } from 'crypto';
import { getAsync, allAsync, runAsync } from '../database';

export type AnalysisTaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface AnalysisTaskRecord {
  id: string;
  userId: string;
  fileName: string;
  /** 文件在去重存储（file_hashes）中的 SHA-256 引用 */
  fileHash: string;
  category: string;
  customPrompt: string;
  supplements: unknown[];
  knowledgeFileIds: string[];
  modelId: string | null;
  modelName: string;
  author: string;
  userHint: string;
  status: AnalysisTaskStatus;
  resultText: string | null;
  error: string | null;
  reportId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try { return JSON.parse(value) as T; } catch { return defaultValue; }
}

function rowToRecord(row: any): AnalysisTaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    fileHash: row.file_hash,
    category: row.category,
    customPrompt: row.custom_prompt ?? '',
    supplements: safeJsonParse(row.supplements, []),
    knowledgeFileIds: safeJsonParse(row.knowledge_file_ids, []),
    modelId: row.model_id ?? null,
    modelName: row.model_name ?? '',
    author: row.author ?? '',
    userHint: row.user_hint ?? '',
    status: row.status,
    resultText: row.result_text ?? null,
    error: row.error ?? null,
    reportId: row.report_id ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
  };
}

export const analysisTaskRepository = {
  async create(data: {
    userId: string;
    fileName: string;
    fileHash: string;
    category: string;
    customPrompt?: string;
    supplements?: unknown[];
    knowledgeFileIds?: string[];
    modelId?: string | null;
    modelName?: string;
    author?: string;
    userHint?: string;
  }): Promise<AnalysisTaskRecord> {
    const id = `at_${randomUUID()}`;
    const now = new Date().toISOString();
    await runAsync(
      `INSERT INTO analysis_tasks
        (id, user_id, file_name, file_hash, category, custom_prompt, supplements,
         knowledge_file_ids, model_id, model_name, author, user_hint, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'queued',?)`,
      [
        id, data.userId, data.fileName, data.fileHash, data.category,
        data.customPrompt ?? '', JSON.stringify(data.supplements ?? []),
        JSON.stringify(data.knowledgeFileIds ?? []), data.modelId ?? null,
        data.modelName ?? '', data.author ?? '', data.userHint ?? '', now,
      ]
    );
    return (await this.findById(id))!;
  },

  async findById(id: string): Promise<AnalysisTaskRecord | null> {
    const row = await getAsync(`SELECT * FROM analysis_tasks WHERE id = ?`, [id]);
    return row ? rowToRecord(row) : null;
  },

  async findByIdAndUser(id: string, userId: string): Promise<AnalysisTaskRecord | null> {
    const row = await getAsync(`SELECT * FROM analysis_tasks WHERE id = ? AND user_id = ?`, [id, userId]);
    return row ? rowToRecord(row) : null;
  },

  /** 某用户的任务列表（新的在前，限量 50） */
  async listByUser(userId: string, limit = 50): Promise<AnalysisTaskRecord[]> {
    const rows = await allAsync(
      `SELECT * FROM analysis_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    return rows.map(rowToRecord);
  },

  /** 全局最早的一条排队任务（队列调度用；全局串行，避免并发打爆 AI 接口） */
  async findOldestQueued(): Promise<AnalysisTaskRecord | null> {
    const row = await getAsync(
      `SELECT * FROM analysis_tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
    );
    return row ? rowToRecord(row) : null;
  },

  /** 条件迁移 queued → running（防并发重复调度） */
  async claimForRun(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await runAsync(
      `UPDATE analysis_tasks SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`,
      [now, id]
    );
    return (result?.changes ?? 0) > 0;
  },

  async markDone(id: string, resultText: string, reportId: string | null): Promise<void> {
    await runAsync(
      `UPDATE analysis_tasks SET status = 'done', result_text = ?, report_id = ?, finished_at = ? WHERE id = ?`,
      [resultText, reportId, new Date().toISOString(), id]
    );
  },

  async markError(id: string, error: string): Promise<void> {
    await runAsync(
      `UPDATE analysis_tasks SET status = 'error', error = ?, finished_at = ? WHERE id = ?`,
      [error, new Date().toISOString(), id]
    );
  },

  /** 条件迁移 queued → cancelled（运行中的任务不可取消） */
  async cancel(id: string, userId: string): Promise<boolean> {
    const result = await runAsync(
      `UPDATE analysis_tasks SET status = 'cancelled', finished_at = ? WHERE id = ? AND user_id = ? AND status = 'queued'`,
      [new Date().toISOString(), id, userId]
    );
    return (result?.changes ?? 0) > 0;
  },

  /** 删除终态任务记录（done/error/cancelled；运行/排队中不允许删） */
  async removeFinished(id: string, userId: string): Promise<boolean> {
    const result = await runAsync(
      `DELETE FROM analysis_tasks WHERE id = ? AND user_id = ? AND status IN ('done','error','cancelled')`,
      [id, userId]
    );
    return (result?.changes ?? 0) > 0;
  },

  /** 服务重启恢复：把中断的 running 标记为 error（queued 保留，由调度器恢复执行） */
  async recoverInterrupted(): Promise<number> {
    const result = await runAsync(
      `UPDATE analysis_tasks SET status = 'error', error = '服务重启，任务中断', finished_at = ? WHERE status = 'running'`,
      [new Date().toISOString()]
    );
    return result?.changes ?? 0;
  },
};
