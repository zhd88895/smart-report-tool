/**
 * SQLite 数据库连接与底层操作封装
 *
 * 本模块提供统一的 SQLite 连接、建表、事务和查询封装，
 * 所有业务模块通过此模块访问数据库。
 *
 * @module db/database
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getConfig } from '../config';
import { logger, getLogger } from '../utils/logger';

// 模块级日志实例（其他模块，仅 ERROR）
const log = getLogger('Database', 'other');

export interface DbRow {
  [key: string]: any;
}

let dbInstance: sqlite3.Database | null = null;

/**
 * 初始化数据库：确保目录存在、打开连接、创建表结构
 */
export async function initDatabase(): Promise<sqlite3.Database> {
  if (dbInstance) return dbInstance;

  const config = getConfig();
  const dbDir = config.DATA_DIR;
  const dbPath = path.join(dbDir, 'smart-report.db');

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      log.error(`打开数据库失败: ${err.message}`);
      throw err;
    }
  });

  await runAsync('PRAGMA foreign_keys = ON');
  await runAsync('PRAGMA journal_mode = WAL');
  await createSchema();

  return dbInstance;
}

/**
 * 获取数据库单例实例
 */
export async function getDatabase(): Promise<sqlite3.Database> {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

/**
 * 获取数据库文件路径（用于迁移/备份等）
 */
export function getDatabasePath(): string {
  const config = getConfig();
  return path.join(config.DATA_DIR, 'smart-report.db');
}

/**
 * 创建数据库表结构
 */
async function createSchema(): Promise<void> {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      region TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      login_attempts INTEGER DEFAULT 0,
      locked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      script_type TEXT NOT NULL DEFAULT 'python',
      region TEXT,
      input_formats TEXT,
      input_format_manual INTEGER DEFAULT 0,
      version TEXT DEFAULT '1.0',
      category TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT,
      file_size INTEGER DEFAULT 0,
      template_required INTEGER DEFAULT 0,
      template_ids TEXT,
      requirements TEXT,
      deps_status TEXT,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT
    );

    CREATE TABLE IF NOT EXISTS script_auxiliary_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      path TEXT NOT NULL,
      hash TEXT,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      file_type TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      compatible_script_type TEXT DEFAULT 'python',
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      script_id TEXT NOT NULL,
      script_name TEXT,
      template_id TEXT,
      template_name TEXT,
      output_format TEXT,
      workspace_dir TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT,
      status TEXT NOT NULL DEFAULT 'generating',
      error TEXT,
      logs TEXT,
      file_paths TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      messages TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scripts_uploaded_by ON scripts(uploaded_by);
    CREATE INDEX IF NOT EXISTS idx_reports_script_id ON reports(script_id);
    CREATE INDEX IF NOT EXISTS idx_reports_generated_by ON reports(generated_by);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  `;

  await execAsync(schema);

  // 迁移：为旧版 reports 表添加 type/region/date/author/created_at 列
  for (const col of ['type', 'region', 'date', 'author', 'created_at']) {
    try {
      await runAsync(`ALTER TABLE reports ADD COLUMN ${col} TEXT`);
      logger.info(`数据库迁移: 已添加 reports.${col} 列`);
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
      }
    }
  }
}

/**
 * 检查列是否存在（用于迁移判断）
 */
export async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    const row = await getAsync(`PRAGMA table_info(${table})`);
    return !!row;
  } catch {
    return false;
  }
}
export function runAsync(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('数据库未初始化'));
      return;
    }
    dbInstance.run(sql, params, function (this: sqlite3.RunResult, err: Error | null) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

/**
 * 执行返回单行结果的 SQL
 */
export function getAsync(sql: string, params: any[] = []): Promise<DbRow | undefined> {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('数据库未初始化'));
      return;
    }
    dbInstance.get(sql, params, (err: Error | null, row: DbRow | undefined) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

/**
 * 执行返回多行结果的 SQL
 */
export function allAsync(sql: string, params: any[] = []): Promise<DbRow[]> {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('数据库未初始化'));
      return;
    }
    dbInstance.all(sql, params, (err: Error | null, rows: DbRow[]) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * 执行多条 SQL（用于建表、迁移脚本等）
 */
export function execAsync(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('数据库未初始化'));
      return;
    }
    dbInstance.exec(sql, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * 在事务中执行回调函数
 */
export async function withTransaction<T>(callback: () => Promise<T>): Promise<T> {
  await runAsync('BEGIN TRANSACTION');
  try {
    const result = await callback();
    await runAsync('COMMIT');
    return result;
  } catch (error) {
    await runAsync('ROLLBACK');
    throw error;
  }
}
