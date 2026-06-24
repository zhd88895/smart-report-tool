/**
 * 数据库迁移脚本
 *
 * 将旧的 JSON 文件数据库（db.json）迁移到 SQLite 数据库，
 * 并将脚本、模板、报告文件统一迁移到 DATA_DIR 下。
 *
 * 用法：
 *   npx tsx src/scripts/migrate-to-sqlite.ts
 *
 * 迁移前请确保已备份数据。迁移完成后，db.json 会被重命名为 db.json.bak。
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { loadConfig, getConfig, SCRIPTS_DIR, TEMPLATES_DIR, REPORTS_DIR } from '../config';
import { initDatabase, runAsync } from '../db/database';
import {
  userRepository,
  scriptRepository,
  templateRepository,
  reportRepository,
  conversationRepository,
} from '../db/repositories';
import { logger } from '../utils/logger';

interface OldDb {
  users: any[];
  scripts: any[];
  templates: any[];
  reports: any[];
  conversations: any[];
}

async function copyFileSafe(src: string, dest: string): Promise<boolean> {
  if (!existsSync(src)) {
    logger.warn(`源文件不存在，跳过: ${src}`);
    return false;
  }
  const destDir = path.dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  await fs.copyFile(src, dest);
  return true;
}

async function migrate() {
  loadConfig();
  const config = getConfig();

  const oldDbPath = path.join(config.DATA_DIR, 'db.json');
  if (!existsSync(oldDbPath)) {
    logger.info('未找到 db.json，无需迁移，直接初始化 SQLite 数据库');
    await initDatabase();
    return;
  }

  logger.info(`读取旧数据库: ${oldDbPath}`);
  const raw = await fs.readFile(oldDbPath, 'utf-8');
  const oldDb: OldDb = JSON.parse(raw);

  logger.info('初始化 SQLite 数据库...');
  await initDatabase();

  // 迁移用户
  if (oldDb.users && oldDb.users.length > 0) {
    logger.info(`迁移 ${oldDb.users.length} 个用户...`);
    for (const user of oldDb.users) {
      await userRepository.create({
        id: user.id,
        username: user.username,
        password: user.password,
        role: user.role || 'member',
        displayName: user.displayName || user.username,
        status: user.status || 'pending',
        region: user.region || '全部',
        createdAt: user.createdAt || new Date().toISOString(),
        lastLoginAt: user.lastLoginAt,
        loginAttempts: user.loginAttempts || 0,
        lockedUntil: user.lockedUntil,
      });
    }
  }

  // 迁移脚本及辅助文件
  if (oldDb.scripts && oldDb.scripts.length > 0) {
    logger.info(`迁移 ${oldDb.scripts.length} 个脚本...`);
    for (const script of oldDb.scripts) {
      const newScriptDir = path.join(SCRIPTS_DIR, script.id);
      const newFilePath = path.join(newScriptDir, script.fileName);

      // 复制主脚本文件
      if (script.filePath && existsSync(script.filePath)) {
        await copyFileSafe(script.filePath, newFilePath);
      }

      // 复制辅助文件
      const newAuxFiles = [];
      if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
        for (const aux of script.auxiliaryFiles) {
          const newAuxPath = path.join(newScriptDir, 'aux', aux.name);
          const copied = await copyFileSafe(aux.path, newAuxPath);
          if (copied) {
            newAuxFiles.push({
              name: aux.name,
              size: aux.size,
              path: newAuxPath,
              hash: aux.hash || '',
            });
          }
        }
      }

      await scriptRepository.create({
        id: script.id,
        name: script.name,
        description: script.description || '',
        scriptType: script.scriptType || 'python',
        region: script.region || '全部',
        inputFormats: script.inputFormats || '',
        inputFormatManual: script.inputFormatManual || false,
        version: script.version || '1.0',
        category: script.category || 'host',
        fileName: script.fileName,
        filePath: newFilePath,
        fileHash: script.fileHash || '',
        fileSize: script.fileSize || 0,
        templateRequired: script.templateRequired || false,
        templateIds: script.templateIds || [],
        auxiliaryFiles: newAuxFiles,
        requirements: script.requirements || [],
        depsStatus: script.depsStatus || { status: 'none', log: '', packages: [] },
        uploadedAt: script.uploadedAt,
        uploadedBy: script.uploadedBy || 'unknown',
      });
    }
  }

  // 迁移模板
  if (oldDb.templates && oldDb.templates.length > 0) {
    logger.info(`迁移 ${oldDb.templates.length} 个模板...`);
    for (const template of oldDb.templates) {
      const newTemplateDir = path.join(TEMPLATES_DIR, template.id);
      const newFilePath = path.join(newTemplateDir, template.fileName);

      if (template.filePath && existsSync(template.filePath)) {
        await copyFileSafe(template.filePath, newFilePath);
      }

      await templateRepository.create({
        id: template.id,
        name: template.name,
        description: template.description || '',
        fileType: template.fileType || '',
        fileName: template.fileName,
        filePath: newFilePath,
        fileSize: template.fileSize || 0,
        compatibleScriptType: template.compatibleScriptType || 'python',
        uploadedAt: template.uploadedAt,
        uploadedBy: template.uploadedBy || 'unknown',
      });
    }
  }

  // 迁移报告（只迁移元数据，报告工作目录保持原样或迁移）
  if (oldDb.reports && oldDb.reports.length > 0) {
    logger.info(`迁移 ${oldDb.reports.length} 个报告...`);
    for (const report of oldDb.reports) {
      let newWorkspaceDir = report.workspaceDir;
      // 如果工作目录在旧的 reports 路径下，尝试迁移
      if (report.workspaceDir && existsSync(report.workspaceDir)) {
        const newReportDir = path.join(REPORTS_DIR, report.id);
        if (!existsSync(newReportDir)) {
          mkdirSync(newReportDir, { recursive: true });
        }
        const entries = await fs.readdir(report.workspaceDir, { withFileTypes: true });
        for (const entry of entries) {
          const src = path.join(report.workspaceDir, entry.name);
          const dest = path.join(newReportDir, entry.name);
          if (entry.isFile()) {
            await fs.copyFile(src, dest);
          } else if (entry.isDirectory()) {
            // 简单处理：目录不递归迁移
            logger.warn(`报告目录包含子目录，未递归复制: ${src}`);
          }
        }
        newWorkspaceDir = newReportDir;
      }

      await reportRepository.create({
        id: report.id,
        name: report.name,
        description: report.description || '',
        scriptId: report.scriptId,
        scriptName: report.scriptName || '',
        templateId: report.templateId,
        templateName: report.templateName,
        outputFormat: report.outputFormat || '',
        workspaceDir: newWorkspaceDir,
        generatedAt: report.generatedAt,
        generatedBy: report.generatedBy || 'unknown',
        status: report.status,
        error: report.error,
        logs: report.logs || [],
      });
    }
  }

  // 迁移对话
  if (oldDb.conversations && oldDb.conversations.length > 0) {
    logger.info(`迁移 ${oldDb.conversations.length} 个对话...`);
    for (const conv of oldDb.conversations) {
      await conversationRepository.create({
        id: conv.id,
        userId: conv.userId,
        userName: conv.userName || '',
        messages: conv.messages || [],
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt || conv.createdAt,
      });
    }
  }

  // 备份旧数据库
  const backupPath = `${oldDbPath}.bak`;
  await fs.rename(oldDbPath, backupPath);
  logger.info(`旧数据库已备份为: ${backupPath}`);

  logger.info('迁移完成！');
}

migrate().catch((error) => {
  logger.error(`迁移失败: ${error.message}`);
  process.exit(1);
});
