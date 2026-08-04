/**
 * 数据库初始化入口
 *
 * 在应用启动时调用，完成数据库连接、建表、默认管理员创建等。
 *
 * @module db/init
 */

import bcrypt from 'bcryptjs';
import { initDatabase } from './database';
import { userRepository } from './repositories';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function initializeDatabase(): Promise<void> {
  // 初始化 SQLite 数据库
  await initDatabase();

  // 检查是否有管理员用户，首次启动创建默认管理员
  const hasAdmin = await userRepository.existsAdmin();
  if (!hasAdmin) {
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!initialPassword) {
      logger.error('首次启动需要设置环境变量 ADMIN_INITIAL_PASSWORD 作为默认管理员密码');
      throw new Error('ADMIN_INITIAL_PASSWORD 未设置，请设置此环境变量后重新启动');
    }
    if (initialPassword.length < 8) {
      throw new Error('ADMIN_INITIAL_PASSWORD 长度不能少于 8 位');
    }
    const hashedPassword = bcrypt.hashSync(initialPassword, config.BCRYPT_ROUNDS);
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
    logger.info('已创建默认管理员账户 admin（请登录后立即修改密码）');
  }
  
  logger.info('数据库初始化完成');
}
