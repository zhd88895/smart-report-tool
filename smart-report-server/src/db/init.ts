/**
 * 数据库初始化入口
 *
 * 在应用启动时调用，完成数据库连接、建表、默认管理员创建等。
 * 包含从 JSON 数据库迁移到 SQLite 的逻辑。
 *
 * @module db/init
 */

import bcrypt from 'bcryptjs';
import { initDatabase } from './database';
import { userRepository } from './repositories';
import { migrateJsonToSqlite } from './migrate-json-to-sqlite';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function initializeDatabase(): Promise<void> {
  // 首先尝试从 JSON 迁移到 SQLite（如果需要）
  try {
    await migrateJsonToSqlite();
  } catch (error: any) {
    logger.warn(`JSON 迁移失败或跳过: ${error.message}`);
  }
  
  // 初始化 SQLite 数据库
  await initDatabase();

  // 检查是否有管理员用户
  const hasAdmin = await userRepository.existsAdmin();
  if (!hasAdmin) {
    const hashedPassword = bcrypt.hashSync('admin123', config.BCRYPT_ROUNDS);
    await userRepository.create({
      id: `admin_${Date.now()}`,
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      displayName: 'Administrator',
      status: 'approved',
      region: '全部',
      createdAt: new Date().toISOString(),
      loginAttempts: 0,
    });
    logger.info('Created default admin user: admin');
  }
  
  logger.info('数据库初始化完成');
}
