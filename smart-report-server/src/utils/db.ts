/**
 * 数据库操作工具
 * 
 * 本模块提供JSON文件数据库的读写操作，使用写入队列解决并发写入问题。
 * 提供原子更新、备份等高级功能。
 * 
 * @module db
 */

import { getConfig } from '../config';
import { logger } from './logger';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * 数据库数据结构定义
 */
export interface DatabaseData {
  /** 用户数据 */
  users: any[];
  /** 脚本数据 */
  scripts: any[];
  /** 模板数据 */
  templates: any[];
  /** 报告数据 */
  reports: any[];
  /** 对话数据 */
  conversations: any[];
}

/**
 * 写入队列类
 * 解决JSON文件并发写入问题，确保写入操作串行执行
 */
class WriteQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing: boolean = false;

  /**
   * 将写入操作加入队列
   * @param operation - 异步写入操作
   */
  async enqueue(operation: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await operation();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  /**
   * 处理队列中的写入操作（串行执行）
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    while (this.queue.length > 0) {
      const operation = this.queue.shift();
      if (operation) {
        await operation();
      }
    }
    this.processing = false;
  }
}

/**
 * 数据库操作类
 * 提供JSON文件数据库的读写、原子更新、备份等功能
 */
export class Database {
  private dbPath: string;
  private dataDir: string;
  private writeQueue: WriteQueue;
  private initialized: boolean = false;

  /**
   * 创建数据库实例
   *
   * @throws {Error} 如果配置加载失败
   */
  constructor() {
    const config = getConfig();
    this.dataDir = config.DATA_DIR;
    this.dbPath = path.join(this.dataDir, 'db.json');
    this.writeQueue = new WriteQueue();

    // 确保数据目录存在
    this.ensureDataDir();
  }

  /**
   * 确保数据目录存在
   */
  private ensureDataDir(): void {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
        logger.info(`创建数据目录: ${this.dataDir}`);
      }
    } catch (error) {
      logger.error(`创建数据目录失败: ${error}`);
      throw error;
    }
  }

  /**
   * 读取数据库
   *
   * 首次读取时，如果数据库为空（无用户），会自动创建默认管理员账号。
   *
   * @returns 数据库内容
   */
  async read(): Promise<DatabaseData> {
    try {
      let data: DatabaseData;

      if (!existsSync(this.dbPath)) {
        logger.warn('db.json不存在，返回空数据库');
        data = this.getEmptyDatabase();
      } else {
        const rawData = await fs.readFile(this.dbPath, 'utf-8');
        data = JSON.parse(rawData);
      }

      // 首次读取时确保存在默认管理员账号
      if (!this.initialized) {
        await this.ensureDefaultAdmin(data);
        this.initialized = true;

        // 如果刚写入了默认管理员，重新读取以获取持久化后的数据
        if (existsSync(this.dbPath)) {
          const rawData = await fs.readFile(this.dbPath, 'utf-8');
          data = JSON.parse(rawData);
        }
      }

      return data;
    } catch (error) {
      logger.error(`读取数据库失败: ${error}`);
      return this.getEmptyDatabase();
    }
  }

  /**
   * 确保数据库中存在默认管理员账号
   *
   * 当 users 数组为空时，创建一个默认 admin 用户并写入数据库。
   *
   * @param data - 当前数据库数据
   */
  private async ensureDefaultAdmin(data: DatabaseData): Promise<void> {
    if (data.users && data.users.length > 0) {
      return;
    }

    const config = getConfig();
    const hashedPassword = bcrypt.hashSync('admin123', config.BCRYPT_ROUNDS);
    const adminUser: any = {
      id: `admin_${Date.now()}`,
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      displayName: 'Administrator',
      status: 'approved',
      region: '全部',
      createdAt: new Date().toISOString(),
      loginAttempts: 0,
    };

    data.users.push(adminUser);
    await this.write(data);
    logger.info('[INFO] Created default admin user: admin');
  }

  /**
   * 写入数据库（通过队列保证并发安全）
   *
   * @param data - 要写入的数据
   * @throws {Error} 如果写入失败
   */
  async write(data: DatabaseData): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      try {
        const jsonData = JSON.stringify(data, null, 2);
        await fs.writeFile(this.dbPath, jsonData, 'utf-8');
        logger.debug('数据库写入成功');
      } catch (error) {
        logger.error(`写入数据库失败: ${error}`);
        throw error;
      }
    });
  }

  /**
   * 原子更新操作（读取-修改-写入）
   * 
   * @param updater - 更新函数，接收当前数据，返回更新后的数据
   * @throws {Error} 如果更新失败
   */
  async atomicUpdate(updater: (data: DatabaseData) => DatabaseData): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      try {
        const currentData = await this.read();
        const updatedData = updater(currentData);
        const jsonData = JSON.stringify(updatedData, null, 2);
        await fs.writeFile(this.dbPath, jsonData, 'utf-8');
        logger.debug('数据库原子更新成功');
      } catch (error) {
        logger.error(`数据库原子更新失败: ${error}`);
        throw error;
      }
    });
  }

  /**
   * 获取空数据库结构
   * 
   * @returns 空的数据库数据结构
   */
  private getEmptyDatabase(): DatabaseData {
    return {
      users: [],
      scripts: [],
      templates: [],
      reports: [],
      conversations: []
    };
  }

  /**
   * 备份数据库
   * 
   * @returns 备份文件的路径
   * @throws {Error} 如果备份失败
   */
  async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.dataDir, `db.backup.${timestamp}.json`);

    try {
      if (existsSync(this.dbPath)) {
        await fs.copyFile(this.dbPath, backupPath);
        logger.info(`数据库备份成功: ${backupPath}`);
      }
      return backupPath;
    } catch (error) {
      logger.error(`数据库备份失败: ${error}`);
      throw error;
    }
  }

  /**
   * 获取数据库文件路径
   * 
   * @returns 数据库文件路径
   */
  getDbPath(): string {
    return this.dbPath;
  }
}

/**
 * 数据库单例实例
 */
export const db = new Database();