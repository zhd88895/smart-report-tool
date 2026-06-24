/**
 * 会话管理服务
 *
 * 基于 SQLite 的会话管理，支持：
 * - 短期会话（重启后自动失效）
 * - 长期持久会话（"记住我"，重启后仍有效）
 * - 空闲超时自动退出
 * - HttpOnly Secure Cookie
 *
 * @module sessionService
 */

import crypto from 'crypto';
import { getLogger } from '../utils/logger';
import { getDatabase, runAsync, getAsync, allAsync } from '../db/database';

const log = getLogger('SessionService', 'core');

/** 会话 ID 长度 */
const SESSION_ID_BYTES = 32;

/** 签名密钥长度 */
const SIGN_KEY_BYTES = 16;

/** 登录令牌长度 */
const REMEMBER_TOKEN_BYTES = 48;

/**
 * 会话数据结构
 */
export interface Session {
  id: string;
  userId: string;
  username: string;
  role: string;
  /** 所属服务器实例 ID，为空表示持久会话（记住我） */
  instanceId: string | null;
  /** 是否持久会话 */
  isPersistent: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 最后活动时间 */
  lastActivityAt: string;
  /** 过期时间 */
  expiresAt: string | null;
}

/**
 * 会话服务类
 */
export class SessionService {
  /**
   * 创建会话表
   */
  async initTable(): Promise<void> {
    const db = await getDatabase();
    await runAsync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        instance_id TEXT,
        is_persistent INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        expires_at TEXT
      )
    `);
    await runAsync(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)
    `);
    await runAsync(`
      CREATE INDEX IF NOT EXISTS idx_sessions_instance_id ON sessions(instance_id)
    `);
    log.info('会话表已初始化');
  }

  /**
   * 生成安全的随机会话 ID
   */
  generateSessionId(): string {
    return crypto.randomBytes(SESSION_ID_BYTES).toString('hex');
  }

  /**
   * 生成记住我令牌
   */
  generateRememberToken(): string {
    return crypto.randomBytes(REMEMBER_TOKEN_BYTES).toString('base64url');
  }

  /**
   * 生成服务器实例 ID
   */
  generateInstanceId(): string {
    return `inst_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * 创建新会话
   *
   * @param userId - 用户 ID
   * @param username - 用户名
   * @param role - 角色
   * @param instanceId - 当前服务器实例 ID（null 表示持久会话）
   * @param sessionExpiryMinutes - 会话过期分钟数（仅用于非持久会话）
   * @returns 会话 ID 和可能设置的记住我令牌
   */
  async createSession(
    userId: string,
    username: string,
    role: string,
    instanceId: string | null,
    sessionExpiryMinutes: number = 30
  ): Promise<{ sessionId: string; rememberToken?: string }> {
    const sessionId = this.generateSessionId();
    const isPersistent = instanceId === null;
    const now = new Date().toISOString();

    let expiresAt: string | null = null;
    if (!isPersistent) {
      // 非持久会话：设置空闲超时
      const expiry = new Date(Date.now() + sessionExpiryMinutes * 60 * 1000);
      expiresAt = expiry.toISOString();
    }

    await runAsync(
      `INSERT INTO sessions (id, user_id, username, role, instance_id, is_persistent, created_at, last_activity_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, userId, username, role, instanceId, isPersistent ? 1 : 0, now, now, expiresAt]
    );

    const result: { sessionId: string; rememberToken?: string } = { sessionId };

    // 持久会话生成 rememberToken 作为额外的 cookie 值
    if (isPersistent) {
      result.rememberToken = this.generateRememberToken();
    }

    log.info(`会话已创建: user=${username}, persistent=${isPersistent}`);
    return result;
  }

  /**
   * 验证并获取会话
   *
   * @param sessionId - 会话 ID
   * @param currentInstanceId - 当前服务器实例 ID
   * @returns 会话信息或 null（会话无效）
   */
  async getValidSession(
    sessionId: string,
    currentInstanceId: string
  ): Promise<Session | null> {
    const row = await getAsync(
      `SELECT * FROM sessions WHERE id = ?`,
      [sessionId]
    );

    if (!row) return null;

    const session: Session = {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      role: row.role,
      instanceId: row.instance_id,
      isPersistent: row.is_persistent === 1,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      expiresAt: row.expires_at,
    };

    // 非持久会话：检查服务器实例（重启后失效）
    if (!session.isPersistent && session.instanceId !== currentInstanceId) {
      // 不是当前服务器实例签发的会话，自动清理
      await this.deleteSession(sessionId);
      log.warn(`会话已失效（服务器重启）: ${session.username}`);
      return null;
    }

    // 检查空闲超时（非持久会话）
    if (!session.isPersistent && session.expiresAt) {
      if (new Date(session.expiresAt) < new Date()) {
        await this.deleteSession(sessionId);
        log.warn(`会话已过期（空闲超时）: ${session.username}`);
        return null;
      }
    }

    return session;
  }

  /**
   * 将会话标记为正在活动（更新 last_activity_at）
   */
  async touchSession(sessionId: string, sessionExpiryMinutes: number = 30): Promise<void> {
    const now = new Date().toISOString();
    const newExpiry = new Date(Date.now() + sessionExpiryMinutes * 60 * 1000).toISOString();

    await runAsync(
      `UPDATE sessions SET last_activity_at = ?, expires_at = ? WHERE id = ? AND is_persistent = 0`,
      [now, newExpiry, sessionId]
    );
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    await runAsync(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
  }

  /**
   * 删除用户的所有会话
   */
  async deleteUserSessions(userId: string): Promise<void> {
    await runAsync(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  }

  /**
   * 清理过期的非持久会话
   */
  async cleanupExpiredSessions(currentInstanceId: string): Promise<number> {
    const now = new Date().toISOString();
    // 删除过期的 + 其他实例的
    const result = await runAsync(
      `DELETE FROM sessions WHERE (is_persistent = 0 AND (expires_at < ? OR instance_id != ?))`,
      [now, currentInstanceId]
    );
    const count = result.changes || 0;
    if (count > 0) {
      log.info(`已清理 ${count} 个过期会话`);
    }
    return count;
  }
}

export const sessionService = new SessionService();
