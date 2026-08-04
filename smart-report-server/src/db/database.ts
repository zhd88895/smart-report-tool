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
import { sessionService } from '../services/sessionService';

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
      python_version TEXT DEFAULT 'embedded',
      is_multi_file INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS script_extra_files (
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      category TEXT NOT NULL DEFAULT 'system',
      label TEXT,
      description TEXT,
      value_type TEXT DEFAULT 'string',
      options TEXT,
      editable_by TEXT DEFAULT 'admin',
      is_secret INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings_history (
      id TEXT PRIMARY KEY,
      setting_key TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT,
      changed_by_name TEXT,
      changed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
    CREATE INDEX IF NOT EXISTS idx_settings_history_key ON settings_history(setting_key);

    -- 资产补充信息表
    CREATE TABLE IF NOT EXISTS asset_supplements (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      asset_type TEXT NOT NULL, -- host/storage/virtualization/network/database
      category TEXT NOT NULL, -- 具体分类，如 server/switch/storage_array/vmware/esxi等
      supplement_type TEXT NOT NULL, -- manual/upload/parsed
      field_name TEXT NOT NULL, -- 字段名称，如 manufacturer/model/version等
      field_value TEXT, -- 手动输入的值
      file_path TEXT, -- 上传的文件路径
      file_name TEXT, -- 上传的文件名
      file_size INTEGER, -- 文件大小
      file_hash TEXT, -- 文件哈希
      parsed_content TEXT, -- 解析后的内容
      metadata TEXT, -- 元数据JSON
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_asset_supplements_report_id ON asset_supplements(report_id);
    CREATE INDEX IF NOT EXISTS idx_asset_supplements_asset_type ON asset_supplements(asset_type);
    CREATE INDEX IF NOT EXISTS idx_asset_supplements_category ON asset_supplements(category);

    -- 知识库分类表
    CREATE TABLE IF NOT EXISTS kb_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT 'blue',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 知识库文件表
    CREATE TABLE IF NOT EXISTS kb_files (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      file_ext TEXT NOT NULL,
      content TEXT,
      content_length INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ready',
      error_message TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES kb_categories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_files_category_id ON kb_files(category_id);
    CREATE INDEX IF NOT EXISTS idx_kb_files_file_type ON kb_files(file_type);
    CREATE INDEX IF NOT EXISTS idx_kb_files_title ON kb_files(title);

    -- 用户级 AI 厂商配置表
    CREATE TABLE IF NOT EXISTS user_ai_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      vendor_key TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 用户级 AI 模型表
    CREATE TABLE IF NOT EXISTS user_ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT,
      temperature REAL DEFAULT 0.7,
      max_input_tokens INTEGER DEFAULT 128000,
      max_output_tokens INTEGER DEFAULT 4096,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES user_ai_providers(id) ON DELETE CASCADE
    );

    -- AI 用量记录表
    CREATE TABLE IF NOT EXISTS user_ai_usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      conversation_id TEXT,
      created_at TEXT NOT NULL
    );

    -- AI 工具待确认调用表（兼作工具调用审计：只读工具写 status='executed' 记录）
    CREATE TABLE IF NOT EXISTS pending_tool_calls (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      tool TEXT NOT NULL,
      args TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_tool_calls_user ON pending_tool_calls(user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_uai_providers_user ON user_ai_providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_uai_models_user ON user_ai_models(user_id);
    CREATE INDEX IF NOT EXISTS idx_uai_models_provider ON user_ai_models(provider_id);
    CREATE INDEX IF NOT EXISTS idx_uai_usage_user ON user_ai_usage_logs(user_id, created_at);
  `;

  await execAsync(schema);

  // 初始化会话表
  await sessionService.initTable();

  // ── 迁移：将历史数据中的绝对路径转为相对路径 ──
  await migrateAllPathsToRelative();

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

  // 迁移：为 reports 表添加 report_source 列（'script' | 'ai'）
  try {
    await runAsync(`ALTER TABLE reports ADD COLUMN report_source TEXT DEFAULT 'script'`);
    logger.info('数据库迁移: 已添加 reports.report_source 列');
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
    }
  }

  // 迁移：为 scripts 表添加 is_multi_file 列
  try {
    await runAsync('ALTER TABLE scripts ADD COLUMN is_multi_file INTEGER DEFAULT 0');
    logger.info('数据库迁移: 已添加 scripts.is_multi_file 列');
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
    }
  }

  // 迁移：为 user_ai_usage_logs 表添加 conversation_id 列（对话级 token 统计）
  try {
    await runAsync('ALTER TABLE user_ai_usage_logs ADD COLUMN conversation_id TEXT');
    logger.info('数据库迁移: 已添加 user_ai_usage_logs.conversation_id 列');
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
    }
  }

  // 迁移：扫描已存在的脚本目录，对每个 is_multi_file=1 的脚本，
  // 将 auxfiles/ 中的 .py 文件迁到 script_extra_files
  await migrateExtraFilesFromAux();

  // 迁移：将旧平铺目录结构的脚本文件迁移到 single/ 或 multi/ 子目录
  await migrateScriptFilesToSubdirs();

  // 迁移：为 settings 表填充初始配置数据
  await seedDefaultSettings();

  // 迁移：清理 settings 表中的 AI 类死配置（多厂商 AI 重构后由独立 AI 设置页替代，
  // 系统设置页不再展示「AI 设置」分类）
  await cleanupDeadAISettings();

  // 迁移：为 settings 表添加 is_hidden 列，并隐藏当前未接入任何功能的配置项
  // （数据保留，后续正式实现对应功能后取消隐藏即可）
  await migrateSettingsHiddenFlag();

  // 迁移：为已存在的库补充上传扩展名配置（seed 只在空库时执行）
  await migrateUploadExtensionSettings();

  // 迁移：上传文件 hash 去重索引表（内容寻址存储 data/uploads/dedup/）
  await runAsync(`CREATE TABLE IF NOT EXISTS file_hashes (
    hash TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  )`);

  // 迁移：将历史 AI 报告中存储为 userId 的 author 字段更新为显示名
  await migrateReportAuthorsToDisplayName();
}

/**
 * 一次性迁移：把 reports.author 中仍为用户 ID 的旧数据更新为 displayName / username
 */
async function migrateReportAuthorsToDisplayName(): Promise<void> {
  try {
    // 找出 author 值与 users.id 匹配的报告（包括 user_ 前缀格式和标准 UUID）
    const rows = await allAsync(
      `SELECT r.id, u.display_name, u.username
       FROM reports r
       INNER JOIN users u ON r.author = u.id`,
      []
    ) as any[];

    let updated = 0;
    for (const row of rows) {
      const newAuthor = row.display_name || row.username || null;
      if (!newAuthor) continue;
      await runAsync('UPDATE reports SET author = ? WHERE id = ?', [newAuthor, row.id]);
      updated++;
    }

    if (updated > 0) {
      logger.info(`数据库迁移: 已更新 ${updated} 条报告的作者字段（userId → 显示名）`);
    }
  } catch (e: any) {
    logger.warn(`报告作者字段迁移跳过: ${e.message}`);
  }
}

/**
 * 一次性迁移：对 is_multi_file=1 的脚本，把 auxfiles/ 目录里的 .py 文件搬到 script_extra_files
 */
async function migrateExtraFilesFromAux(): Promise<void> {
  try {
    const rows = await allAsync(
      'SELECT id FROM scripts WHERE is_multi_file = 1'
    ) as any[];
    for (const row of rows) {
      const existing = await allAsync(
        'SELECT name FROM script_extra_files WHERE script_id = ?', [row.id]
      ) as any[];
      const existingNames = new Set(existing.map((e) => e.name));
      const auxRows = await allAsync(
        'SELECT name, size, path, hash FROM script_auxiliary_files WHERE script_id = ?', [row.id]
      ) as any[];
      for (const aux of auxRows) {
        if (aux.name.toLowerCase().endsWith('.py') && !existingNames.has(aux.name)) {
          await runAsync(
            'INSERT INTO script_extra_files (script_id, name, size, path, hash) VALUES (?, ?, ?, ?, ?)',
            [row.id, aux.name, aux.size, aux.path, aux.hash]
          );
          // 同时删除 auxfiles 表里的这条记录
          await runAsync(
            'DELETE FROM script_auxiliary_files WHERE script_id = ? AND name = ?',
            [row.id, aux.name]
          );
          logger.info(`迁移: script_extra_files ← ${row.id}/${aux.name}`);
        }
      }
    }
    logger.info('extra_files 迁移完成');
  } catch (e: any) {
    logger.error(`extra_files 迁移失败: ${e.message}`);
  }
}

/**
 * 一次性迁移：将旧平铺目录结构的脚本文件迁移到 single/ 或 multi/ 子目录
 * 
 * 旧结构: data/scripts/{id}/main.py     (文件直接放在脚本根目录)
 * 新结构: data/scripts/{id}/single/main.py  (单文件模式)
 *         data/scripts/{id}/multi/main.py   (多文件模式)
 */
async function migrateScriptFilesToSubdirs(): Promise<void> {
  const fs = await import('fs/promises');
  const config = getConfig();
  const dataDir = config.DATA_DIR;

  try {
    const rows = await allAsync('SELECT id, file_name, file_path, is_multi_file FROM scripts') as any[];
    let migratedCount = 0;

    for (const row of rows) {
      const scriptRoot = path.join(dataDir, 'scripts', row.id);
      if (!existsSync(scriptRoot)) continue;

      const isMulti = row.is_multi_file === 1;
      const subDirName = isMulti ? 'multi' : 'single';
      const subDir = path.join(scriptRoot, subDirName);

      // 检查是否已经是新结构（file_path 包含 single/ 或 multi/）
      const filePath = row.file_path || '';
      if (filePath.includes('/single/') || filePath.includes('/multi/') ||
          filePath.includes('\\single\\') || filePath.includes('\\multi\\')) {
        continue; // 已经是新结构，跳过
      }

      // 创建子目录
      if (!existsSync(subDir)) {
        mkdirSync(subDir, { recursive: true });
      }

      // 获取脚本根目录下的 .py 文件列表
      try {
        const rootFiles = await fs.readdir(scriptRoot);
        const pyFiles = rootFiles.filter((f: string) =>
          f.toLowerCase().endsWith('.py')
        );

        // 移动根目录下的所有 .py 文件到子目录
        for (const pf of pyFiles) {
          const oldPath = path.join(scriptRoot, pf);
          const newPath = path.join(subDir, pf);
          if (existsSync(oldPath) && !existsSync(newPath)) {
            await fs.rename(oldPath, newPath);
          }
        }

        // 更新数据库中的 file_path
        const newFilePath = path.join(subDir, row.file_name);
        const relPath = path.relative(dataDir, newFilePath).replace(/\\/g, '/');
        await runAsync(
          'UPDATE scripts SET file_path = ? WHERE id = ?',
          [relPath, row.id]
        );

        // 更新 script_extra_files 中的路径
        if (isMulti) {
          const extraRows = await allAsync(
            'SELECT id, name, path FROM script_extra_files WHERE script_id = ?',
            [row.id]
          ) as any[];
          for (const er of extraRows) {
            const erNewPath = path.join(subDir, er.name);
            const erRelPath = path.relative(dataDir, erNewPath).replace(/\\/g, '/');
            await runAsync(
              'UPDATE script_extra_files SET path = ? WHERE id = ?',
              [erRelPath, er.id]
            );
          }
        }

        migratedCount++;
        logger.info(`目录结构迁移: ${row.id} → ${subDirName}/ (${pyFiles.length} 个 .py 文件)`);
      } catch (innerError: any) {
        logger.warn(`目录结构迁移跳过 ${row.id}: ${innerError.message}`);
      }
    }

    if (migratedCount > 0) {
      logger.info(`目录结构迁移完成: 共迁移 ${migratedCount} 个脚本`);
    }
  } catch (e: any) {
    logger.error(`目录结构迁移失败: ${e.message}`);
  }
}

/**
 * 将数据库中所有绝对路径转为相对于 DATA_DIR 的相对路径
 * 只转换一次：如果已有相对路径（不以盘符或/开头），则跳过。
 */
async function migrateAllPathsToRelative(): Promise<void> {
  const config = getConfig();
  const dataDir = config.DATA_DIR;

  // 判断路径是否为绝对路径（Windows 盘符或 Unix 根路径）
  const isAbsolute = (p: string): boolean => {
    if (!p || p.trim() === '') return false;
    if (/^[a-zA-Z]:[\\/]/.test(p)) return true; // Windows: C:\ D:\
    if (p.startsWith('/')) return true;           // Unix: /home/...
    return false;
  };

  const toRelativePath = (p: string): string => {
    if (!isAbsolute(p)) return p;
    const rel = path.relative(dataDir, path.resolve(p));
    if (rel.startsWith('..')) {
      logger.warn(`路径迁移警告: ${p} 不在数据目录 ${dataDir} 内，跳过`);
      return p;
    }
    return rel;
  };

  // 1. scripts.file_path
  const scripts = await allAsync('SELECT id, file_path FROM scripts') as any[];
  for (const s of scripts) {
    const rel = toRelativePath(s.file_path);
    if (rel !== s.file_path) {
      await runAsync('UPDATE scripts SET file_path = ? WHERE id = ?', [rel, s.id]);
      logger.info(`路径迁移: scripts.file_path ${s.id} → ${rel}`);
    }
  }

  // 2. script_auxiliary_files.path
  const auxFiles = await allAsync('SELECT id, path FROM script_auxiliary_files') as any[];
  for (const a of auxFiles) {
    const rel = toRelativePath(a.path);
    if (rel !== a.path) {
      await runAsync('UPDATE script_auxiliary_files SET path = ? WHERE id = ?', [rel, a.id]);
      logger.info(`路径迁移: aux.path ${a.id} → ${rel}`);
    }
  }

  // 3. templates.file_path
  const templates = await allAsync('SELECT id, file_path FROM templates') as any[];
  for (const t of templates) {
    const rel = toRelativePath(t.file_path);
    if (rel !== t.file_path) {
      await runAsync('UPDATE templates SET file_path = ? WHERE id = ?', [rel, t.id]);
      logger.info(`路径迁移: templates.file_path ${t.id} → ${rel}`);
    }
  }

  // 4. reports.workspace_dir
  const reports = await allAsync('SELECT id, workspace_dir FROM reports') as any[];
  for (const r of reports) {
    const rel = toRelativePath(r.workspace_dir);
    if (rel !== r.workspace_dir) {
      await runAsync('UPDATE reports SET workspace_dir = ? WHERE id = ?', [rel, r.id]);
      logger.info(`路径迁移: reports.workspace_dir ${r.id} → ${rel}`);
    }
  }

  // 注：reports.file_paths 存储的是 workspace 内相对路径（如 "report.html"），
  // 不是 DATA_DIR 相对路径，因此不进行转换。
  logger.info('路径迁移完成');
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

/**
 * 填充默认系统配置（仅在 settings 表为空时执行）
 */
async function seedDefaultSettings(): Promise<void> {
  try {
    const count = await getAsync('SELECT COUNT(*) as cnt FROM settings') as any;
    if (count?.cnt > 0) return;

    const now = new Date().toISOString();
    const defaults = [
      // AI 类配置已整体移除：多厂商 AI 重构后由 user_ai_providers/user_ai_models 表与独立 AI 设置页替代，
      // ai.vendor / ai.baseUrl / ai.model / ai.maxTokens 均为不被任何代码读取的死配置
      { key: 'system.sessionTimeout', value: '30', category: 'system', label: '会话超时（分钟）', description: '用户空闲超时自动登出，调整后即时生效', value_type: 'number', sort_order: 1 },
      { key: 'system.dataDir', value: 'data', category: 'system', label: '数据目录', value_type: 'string', sort_order: 2 },
      { key: 'system.logLevel', value: 'info', category: 'system', label: '日志级别', value_type: 'select', options: JSON.stringify(['debug','info','warn','error']), sort_order: 3 },
      { key: 'storage.uploadLimit', value: '50', category: 'storage', label: '上传文件大小限制（MB）', description: '脚本/模板/报告等上传单文件上限，调整后即时生效', value_type: 'number', sort_order: 1 },
      { key: 'storage.retentionDays', value: '90', category: 'storage', label: '文件保留天数', description: '临时上传文件超过 N 天未使用自动删除，调整后于下次清理周期生效', value_type: 'number', sort_order: 2 },
      { key: 'storage.archiveExtensions', value: '.zip,.tar,.gz,.tgz,.tar.gz,.tar.bz2,.tar.xz', category: 'storage', label: '压缩包扩展名', description: '支持包/压缩包允许上传的扩展名，逗号分隔（如 .sds），调整后即时生效；解压按文件实际格式自动识别', value_type: 'string', sort_order: 3 },
      { key: 'storage.textExtensions', value: '.txt,.log,.conf,.csv,.xml,.json,.yml,.yaml,.out,.err,.md,.xlsx,.xls', category: 'storage', label: '文本文件扩展名', description: '单文件模式允许上传的扩展名，逗号分隔，调整后即时生效', value_type: 'string', sort_order: 4 },
      { key: 'security.adminPassword', value: 'SmartReport@2026', category: 'security', label: '管理员初始密码', value_type: 'string', is_secret: 1, sort_order: 1 },
      { key: 'security.rateLimit', value: '100', category: 'security', label: '速率限制（次/分钟）', description: '通用 API 每 IP 每分钟请求上限，调整后即时生效', value_type: 'number', sort_order: 2 },
      { key: 'security.corsOrigin', value: '', category: 'security', label: 'CORS 额外允许源', description: '在环境变量基础上追加允许的跨域来源，多个用逗号分隔，支持 *.example.com 通配', value_type: 'string', sort_order: 3 },
      { key: 'logs.format', value: 'text', category: 'logs', label: '日志格式', value_type: 'select', options: JSON.stringify(['text','json']), sort_order: 1 },
      { key: 'logs.retentionDays', value: '30', category: 'logs', label: '日志保留天数', value_type: 'number', sort_order: 2 },
      { key: 'notification.smtpHost', value: '', category: 'notification', label: 'SMTP 服务器', value_type: 'string', sort_order: 1 },
      { key: 'notification.smtpPort', value: '587', category: 'notification', label: 'SMTP 端口', value_type: 'number', sort_order: 2 },
      { key: 'notification.emailFrom', value: '', category: 'notification', label: '发件人地址', value_type: 'string', sort_order: 3 },
    ];

    for (const s of defaults) {
      await runAsync(
        `INSERT OR IGNORE INTO settings (key, value, category, label, description, value_type, options, editable_by, is_secret, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)`,
        [s.key, s.value, s.category, s.label, s.description || '', s.value_type, s.options || null, s.is_secret || 0, s.sort_order, now]
      );
    }
    logger.info('数据库迁移: settings 表已填充默认配置（13 项）');
  } catch (e: any) {
    logger.warn(`settings 种子数据填充跳过: ${e.message}`);
  }
}

/**
 * 一次性清理：删除 settings 表中 category='ai' 的死配置
 * （ai.vendor / ai.baseUrl / ai.model / ai.maxTokens，
 *  多厂商 AI 重构后不再被任何代码读取，系统设置页也不再展示「AI 设置」分类）
 */
async function cleanupDeadAISettings(): Promise<void> {
  try {
    const result = await runAsync(`DELETE FROM settings WHERE category = 'ai'`);
    const changes = (result as any)?.changes ?? 0;
    if (changes > 0) {
      logger.info(`数据库迁移: 已清理 settings 表 AI 类死配置（${changes} 项）`);
    }
  } catch (e: any) {
    logger.warn(`settings AI 死配置清理跳过: ${e.message}`);
  }
}

/**
 * 当前未被任何代码读取、仅作占位的配置项（隐藏但保留数据）。
 * 后续正式实现对应功能时，把对应 key 从此列表移除并 UPDATE is_hidden = 0 即可。
 *
 * 已接入功能（不再隐藏，调整即时生效）：
 * - system.sessionTimeout → middleware/auth.ts 会话空闲超时
 * - storage.uploadLimit   → middleware/upload.ts 上传文件大小限制
 * - storage.retentionDays → fileCleanupService 临时文件保留清理
 * - security.rateLimit    → index.ts 通用 API 限流
 * - security.corsOrigin   → middleware/cors.ts 追加允许来源
 */
const PLACEHOLDER_SETTING_KEYS = [
  'system.dataDir',        // 数据目录由环境变量 DATA_DIR 决定，运行中修改会破坏已有路径
  'system.logLevel',       // 日志器在设置缓存初始化前完成配置，需重启语义，暂未接入
  'security.adminPassword',// 管理员初始密码在用户种子逻辑中处理
  'logs.format',           // 日志格式由 logger 配置决定，需重启语义，暂未接入
  'logs.retentionDays',    // 日志保留天数在 logger 中硬编码，需重启语义，暂未接入
  'notification.smtpHost', // 邮件通知功能未实现
  'notification.smtpPort',
  'notification.emailFrom',
];

/**
 * 迁移：为 settings 表添加 is_hidden 列，并把尚未接入功能的占位配置标记为隐藏。
 * 隐藏的配置不会出现在系统设置页与设置接口中，但数据保留。
 */
async function migrateSettingsHiddenFlag(): Promise<void> {
  try {
    await runAsync('ALTER TABLE settings ADD COLUMN is_hidden INTEGER DEFAULT 0');
    logger.info('数据库迁移: 已添加 settings.is_hidden 列');
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
      logger.warn(`settings.is_hidden 列添加跳过: ${error.message}`);
    }
  }
  try {
    const placeholders = PLACEHOLDER_SETTING_KEYS.map(() => '?').join(',');
    const result = await runAsync(
      `UPDATE settings SET is_hidden = 1 WHERE key IN (${placeholders}) AND COALESCE(is_hidden, 0) = 0`,
      PLACEHOLDER_SETTING_KEYS
    );
    const changes = (result as any)?.changes ?? 0;
    if (changes > 0) {
      logger.info(`数据库迁移: 已隐藏 ${changes} 项未接入功能的占位配置`);
    }
    // 已接入功能的配置项确保可见（兼容曾被旧迁移隐藏过的数据库）
    const wired = await runAsync(
      `UPDATE settings SET is_hidden = 0 WHERE key IN ('system.sessionTimeout', 'storage.uploadLimit', 'storage.retentionDays', 'security.rateLimit', 'security.corsOrigin') AND COALESCE(is_hidden, 0) = 1`
    );
    const wiredChanges = (wired as any)?.changes ?? 0;
    if (wiredChanges > 0) {
      logger.info(`数据库迁移: 已开放 ${wiredChanges} 项已接入功能的配置`);
    }
  } catch (e: any) {
    logger.warn(`settings 占位配置隐藏跳过: ${e.message}`);
  }
}

/**
 * 迁移：为已存在的库补充上传扩展名配置
 * （seedDefaultSettings 仅在空库执行，老库需要在这里补插，INSERT OR IGNORE 幂等）
 */
async function migrateUploadExtensionSettings(): Promise<void> {
  const now = new Date().toISOString();
  const items = [
    { key: 'storage.archiveExtensions', value: '.zip,.tar,.gz,.tgz,.tar.gz,.tar.bz2,.tar.xz', label: '压缩包扩展名', description: '支持包/压缩包允许上传的扩展名，逗号分隔（如 .sds），调整后即时生效；解压按文件实际格式自动识别', sort_order: 3 },
    { key: 'storage.textExtensions', value: '.txt,.log,.conf,.csv,.xml,.json,.yml,.yaml,.out,.err,.md,.xlsx,.xls', label: '文本文件扩展名', description: '单文件模式允许上传的扩展名，逗号分隔，调整后即时生效', sort_order: 4 },
  ];
  try {
    for (const s of items) {
      await runAsync(
        `INSERT OR IGNORE INTO settings (key, value, category, label, description, value_type, options, editable_by, is_secret, sort_order, updated_at)
         VALUES (?, ?, 'storage', ?, ?, 'string', NULL, 'admin', 0, ?, ?)`,
        [s.key, s.value, s.label, s.description, s.sort_order, now]
      );
    }
  } catch (e: any) {
    logger.warn(`上传扩展名配置补插跳过: ${e.message}`);
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
