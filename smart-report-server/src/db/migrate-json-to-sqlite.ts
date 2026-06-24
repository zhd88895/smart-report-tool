/**
 * JSON 到 SQLite 数据库迁移脚本
 * 
 * 本脚本将旧的 db.json 数据迁移到新的 SQLite 数据库，
 * 并修复文件路径以匹配当前项目结构。
 * 
 * @module db/migrate-json-to-sqlite
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { initDatabase, runAsync, getAsync, allAsync } from './database';

interface JsonDatabase {
  users: any[];
  scripts: any[];
  templates: any[];
  reports: any[];
  conversations: any[];
}

/**
 * 修复文件路径，将旧路径转换为当前项目结构
 */
function fixFilePath(oldPath: string, dataDir: string): string {
  // 旧路径格式: C:\Users\a7073\智能报告生成工具\scripts\script_xxx\...
  // 新路径格式: data/scripts/script_xxx/...
  
  if (!oldPath) return oldPath;
  
  // 提取相对路径部分
  const oldPrefix = 'C:\\Users\\a7073\\智能报告生成工具\\';
  const oldPrefixAlt = 'C:/Users/a7073/智能报告生成工具/';
  
  let relativePath = oldPath;
  if (oldPath.startsWith(oldPrefix)) {
    relativePath = oldPath.slice(oldPrefix.length);
  } else if (oldPath.startsWith(oldPrefixAlt)) {
    relativePath = oldPath.slice(oldPrefixAlt.length);
  }
  
  // 构建新路径
  const newPath = path.join(dataDir, relativePath);
  
  // 确保路径使用正斜杠（SQLite 存储）
  return newPath.replace(/\\/g, '/');
}

/**
 * 迁移用户数据
 */
async function migrateUsers(users: any[]): Promise<void> {
  if (!users || users.length === 0) {
    logger.info('没有用户数据需要迁移');
    return;
  }
  
  logger.info(`迁移 ${users.length} 个用户...`);
  
  for (const user of users) {
    try {
      await runAsync(
        `INSERT OR REPLACE INTO users (
          id, username, password, role, display_name, status, region,
          created_at, last_login_at, login_attempts, locked_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.username,
          user.password,
          user.role || 'member',
          user.displayName || user.display_name || user.username,
          user.status || 'approved',
          user.region || '全部',
          user.createdAt || user.created_at || new Date().toISOString(),
          user.lastLoginAt || user.last_login_at || null,
          user.loginAttempts || user.login_attempts || 0,
          user.lockedUntil || user.locked_until || null,
        ]
      );
    } catch (error: any) {
      logger.error(`迁移用户 ${user.username} 失败: ${error.message}`);
    }
  }
  
  logger.info('用户数据迁移完成');
}

/**
 * 迁移脚本数据
 */
async function migrateScripts(scripts: any[], dataDir: string): Promise<void> {
  if (!scripts || scripts.length === 0) {
    logger.info('没有脚本数据需要迁移');
    return;
  }
  
  logger.info(`迁移 ${scripts.length} 个脚本...`);
  
  for (const script of scripts) {
    try {
      // 修复文件路径
      const fixedFilePath = fixFilePath(script.filePath, dataDir);
      
      // 确保脚本目录存在
      const scriptDir = path.dirname(fixedFilePath);
      if (!existsSync(scriptDir)) {
        await fs.mkdir(scriptDir, { recursive: true });
      }
      
      // 如果旧文件存在，复制到新位置
      if (existsSync(script.filePath) && script.filePath !== fixedFilePath) {
        await fs.copyFile(script.filePath, fixedFilePath);
        logger.info(`复制脚本文件: ${script.filePath} -> ${fixedFilePath}`);
      }
      
      // 插入脚本记录
      await runAsync(
        `INSERT OR REPLACE INTO scripts (
          id, name, description, script_type, region, input_formats, input_format_manual,
          version, category, file_name, file_path, file_hash, file_size, template_required,
          template_ids, requirements, deps_status, uploaded_at, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          script.id,
          script.name,
          script.description || '',
          script.scriptType || script.script_type || 'python',
          script.region || '全部',
          script.inputFormats || script.input_formats || '',
          script.inputFormatManual || script.input_format_manual || false ? 1 : 0,
          script.version || '1.0',
          script.category || 'host',
          script.fileName || script.file_name,
          fixedFilePath,
          script.fileHash || script.file_hash || '',
          script.fileSize || script.file_size || 0,
          script.templateRequired || script.template_required || false ? 1 : 0,
          JSON.stringify(script.templateIds || script.template_ids || []),
          JSON.stringify(script.requirements || []),
          JSON.stringify(script.depsStatus || script.deps_status || { status: 'none', log: '', packages: [] }),
          script.uploadedAt || script.uploaded_at || new Date().toISOString(),
          script.uploadedBy || script.uploaded_by || 'unknown',
        ]
      );
      
      // 迁移辅助文件
      if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
        for (const aux of script.auxiliaryFiles) {
          const fixedAuxPath = fixFilePath(aux.path, dataDir);
          
          // 确保辅助文件目录存在
          const auxDir = path.dirname(fixedAuxPath);
          if (!existsSync(auxDir)) {
            await fs.mkdir(auxDir, { recursive: true });
          }
          
          // 如果旧文件存在，复制到新位置
          if (existsSync(aux.path) && aux.path !== fixedAuxPath) {
            await fs.copyFile(aux.path, fixedAuxPath);
            logger.info(`复制辅助文件: ${aux.path} -> ${fixedAuxPath}`);
          }
          
          await runAsync(
            'INSERT INTO script_auxiliary_files (script_id, name, size, path, hash) VALUES (?, ?, ?, ?, ?)',
            [script.id, aux.name, aux.size || 0, fixedAuxPath, aux.hash || '']
          );
        }
      }
      
      logger.info(`迁移脚本: ${script.name} (${script.id})`);
    } catch (error: any) {
      logger.error(`迁移脚本 ${script.name} 失败: ${error.message}`);
    }
  }
  
  logger.info('脚本数据迁移完成');
}

/**
 * 迁移模板数据
 */
async function migrateTemplates(templates: any[], dataDir: string): Promise<void> {
  if (!templates || templates.length === 0) {
    logger.info('没有模板数据需要迁移');
    return;
  }
  
  logger.info(`迁移 ${templates.length} 个模板...`);
  
  for (const template of templates) {
    try {
      // 修复文件路径
      const fixedFilePath = fixFilePath(template.filePath, dataDir);
      
      // 确保模板目录存在
      const templateDir = path.dirname(fixedFilePath);
      if (!existsSync(templateDir)) {
        await fs.mkdir(templateDir, { recursive: true });
      }
      
      // 如果旧文件存在，复制到新位置
      if (existsSync(template.filePath) && template.filePath !== fixedFilePath) {
        await fs.copyFile(template.filePath, fixedFilePath);
        logger.info(`复制模板文件: ${template.filePath} -> ${fixedFilePath}`);
      }
      
      await runAsync(
        `INSERT OR REPLACE INTO templates (
          id, name, description, file_type, file_name, file_path, file_size,
          compatible_script_type, uploaded_at, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          template.id,
          template.name,
          template.description || '',
          template.fileType || template.file_type || path.extname(template.fileName || template.file_name || '').slice(1),
          template.fileName || template.file_name,
          fixedFilePath,
          template.fileSize || template.file_size || 0,
          template.compatibleScriptType || template.compatible_script_type || 'python',
          template.uploadedAt || template.uploaded_at || new Date().toISOString(),
          template.uploadedBy || template.uploaded_by || 'unknown',
        ]
      );
      
      logger.info(`迁移模板: ${template.name} (${template.id})`);
    } catch (error: any) {
      logger.error(`迁移模板 ${template.name} 失败: ${error.message}`);
    }
  }
  
  logger.info('模板数据迁移完成');
}

/**
 * 主迁移函数
 */
export async function migrateJsonToSqlite(): Promise<void> {
  const config = getConfig();
  const dbJsonPath = path.join(config.DATA_DIR, 'db.json');
  
  // 检查 JSON 文件是否存在
  if (!existsSync(dbJsonPath)) {
    logger.info('没有找到 db.json 文件，跳过迁移');
    return;
  }
  
  // 检查 SQLite 数据库是否已存在且有数据
  const dbPath = path.join(config.DATA_DIR, 'smart-report.db');
  if (existsSync(dbPath)) {
    try {
      const userCount = await getAsync('SELECT COUNT(*) as count FROM users');
      if (userCount && userCount.count > 0) {
        logger.info('SQLite 数据库已存在且包含数据，跳过迁移');
        return;
      }
    } catch (error) {
      // 数据库可能损坏，继续迁移
      logger.warn('检查 SQLite 数据库时出错，继续迁移...');
    }
  }
  
  logger.info('开始从 JSON 迁移到 SQLite...');
  
  try {
    // 读取 JSON 数据
    const jsonData = await fs.readFile(dbJsonPath, 'utf-8');
    const db: JsonDatabase = JSON.parse(jsonData);
    
    // 初始化 SQLite 数据库
    await initDatabase();
    
    // 迁移数据
    await migrateUsers(db.users || []);
    await migrateScripts(db.scripts || [], config.DATA_DIR);
    await migrateTemplates(db.templates || [], config.DATA_DIR);
    
    // 备份 JSON 文件
    const backupPath = path.join(config.DATA_DIR, `db.json.backup.${Date.now()}`);
    await fs.copyFile(dbJsonPath, backupPath);
    logger.info(`JSON 数据已备份到: ${backupPath}`);
    
    logger.info('JSON 到 SQLite 迁移完成！');
  } catch (error: any) {
    logger.error(`迁移失败: ${error.message}`);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  migrateJsonToSqlite()
    .then(() => {
      console.log('迁移完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('迁移失败:', error);
      process.exit(1);
    });
}