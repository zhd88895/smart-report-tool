/**
 * 用户业务逻辑服务
 *
 * 本模块提供用户相关的业务逻辑处理，包括注册、登录、用户管理等。
 * 使用bcryptjs进行密码哈希，确保安全性。
 *
 * @module userService
 */

import bcrypt from 'bcryptjs';
import { userRepository } from '../db/repositories';
import { logger, getLogger, generateTraceId, Logger } from '../utils/logger';
import { config } from '../config';
import { generateToken } from '../middleware/auth';

// 模块级日志实例（核心业务模块）
const log = getLogger('UserService', 'core');

/**
 * 用户信息接口
 */
export interface User {
  /** 用户ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 密码哈希 */
  password: string;
  /** 用户角色 */
  role: 'admin' | 'senior' | 'member';
  /** 显示名称 */
  displayName: string;
  /** 用户状态 */
  status: 'pending' | 'approved' | 'rejected';
  /** 所属区域 */
  region: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后登录时间 */
  lastLoginAt?: string;
  /** 登录失败次数 */
  loginAttempts?: number;
  /** 账户锁定时间 */
  lockedUntil?: string;
}

/**
 * 用户安全信息（不包含密码）
 */
export type SafeUser = Omit<User, 'password'>;

/**
 * 用户服务类
 *
 * 提供用户相关的所有业务逻辑操作
 */
export class UserService {
  private readonly saltRounds: number;
  private readonly maxLoginAttempts: number = 5;
  private readonly lockDuration: number = 15 * 60 * 1000; // 15分钟

  /**
   * 创建用户服务实例
   */
  constructor() {
    this.saltRounds = config.BCRYPT_ROUNDS;
  }

  /**
   * 注册新用户
   *
   * @param username - 用户名
   * @param password - 密码
   * @param displayName - 显示名称
   * @param region - 所属区域
   * @returns 创建的安全用户信息
   * @throws {Error} 如果用户名已存在或区域无效
   */
  async register(
    username: string,
    password: string,
    displayName?: string,
    region?: string
  ): Promise<SafeUser> {
    const traceId = generateTraceId();
    log.info(`⇢ register 调用开始`, traceId, { username, region });

    // 参数验证
    if (!username || !password) {
      log.warn(`注册失败: 用户名或密码为空`, traceId);
      throw new Error('用户名和密码不能为空');
    }

    if (!region || region === '全部') {
      log.warn(`注册失败: 未选择区域或区域无效`, traceId);
      throw new Error('请选择所属区域');
    }

    if (password.length < 6) {
      log.warn(`注册失败: 密码长度不足`, traceId);
      throw new Error('密码长度至少6位');
    }

    // 检查用户名是否已存在
    const existingUser = await userRepository.findByUsername(username);
    if (existingUser) {
      log.warn(`注册失败: 用户名已存在`, traceId, { username });
      throw new Error('用户名已存在');
    }

    // 密码哈希
    const hashedPassword = bcrypt.hashSync(password, this.saltRounds);

    // 创建新用户
    const newUser: User = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username,
      password: hashedPassword,
      role: 'member',
      displayName: displayName || username,
      status: 'pending',
      region,
      createdAt: new Date().toISOString(),
      loginAttempts: 0,
    };

    const created = await userRepository.create(newUser);
    log.info(`✓ register 完成: ${username} (${region})`, traceId, {
      userId: created.id,
      role: created.role,
    });
    return created;
  }

  /**
   * 用户登录
   *
   * @param username - 用户名
   * @param password - 密码
   * @returns 包含用户信息和JWT Token的对象
   * @throws {Error} 如果登录失败
   */
  async login(
    username: string,
    password: string
  ): Promise<{ user: SafeUser; token: string }> {
    const traceId = generateTraceId();
    log.info(`⇢ login`, traceId, { username });

    if (!username || !password) {
      log.warn(`登录失败: 用户名或密码为空`, traceId);
      throw new Error('用户名和密码不能为空');
    }

    const user = await userRepository.findByUsername(username);

    if (!user) {
      log.warn(`登录失败: 用户不存在`, traceId, { username });
      throw new Error('用户名或密码错误');
    }

    // 检查账户是否被锁定
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remaining = Math.ceil(
        (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
      );
      log.warn(`登录失败: 账户已锁定 (剩余${remaining}分钟)`, traceId, {
        username,
        lockedUntil: user.lockedUntil,
      });
      throw new Error(`账户已锁定，请${remaining}分钟后再试`);
    }

    // 检查用户状态
    if (user.status === 'pending') {
      log.warn(`登录失败: 账户待审核`, traceId, { username });
      throw new Error('账户待审核，请联系管理员');
    }
    if (user.status === 'rejected') {
      log.warn(`登录失败: 账户已被拒绝`, traceId, { username });
      throw new Error('账户已被拒绝');
    }

    // 验证密码
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      // 增加登录失败次数
      const loginAttempts = (user.loginAttempts || 0) + 1;
      const lockedUntil =
        loginAttempts >= this.maxLoginAttempts
          ? new Date(Date.now() + this.lockDuration).toISOString()
          : user.lockedUntil;

      if (lockedUntil && loginAttempts >= this.maxLoginAttempts) {
        log.warn(`用户 ${username} 被锁定，登录失败次数过多`, traceId, {
          attempts: loginAttempts,
        });
      }

      await userRepository.update(user.id, { loginAttempts, lockedUntil });
      throw new Error('用户名或密码错误');
    }

    // 登录成功，重置登录失败次数
    const { password: _, ...safeUser } = user;
    await userRepository.update(user.id, {
      loginAttempts: 0,
      lockedUntil: undefined,
      lastLoginAt: new Date().toISOString(),
    });

    // 生成JWT Token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    log.info(`✓ login 完成: ${username}`, traceId, {
      userId: user.id,
      role: user.role,
    });

    return { user: safeUser, token };
  }

  /**
   * 获取用户列表
   *
   * @param filter - 可选过滤条件
   * @returns 安全用户信息列表
   */
  async getUsers(filter?: {
    status?: string;
    region?: string;
    role?: string;
  }): Promise<SafeUser[]> {
    return userRepository.findAll(filter);
  }

  /**
   * 删除用户
   *
   * @param userId - 用户ID
   * @throws {Error} 如果用户不存在
   */
  async deleteUser(userId: string): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ deleteUser`, traceId, { userId });

    const user = await userRepository.findById(userId);

    if (!user) {
      log.warn(`删除失败: 用户不存在`, traceId, { userId });
      throw new Error('用户不存在');
    }

    // 不能删除管理员账户
    if (user.role === 'admin') {
      log.warn(`删除失败: 不能删除管理员账户`, traceId, { userId });
      throw new Error('不能删除管理员账户');
    }

    await userRepository.delete(userId);
    log.info(`✓ deleteUser 完成: ${userId}`, traceId);
  }

  /**
   * 更新用户状态
   *
   * @param userId - 用户ID
   * @param status - 新状态
   * @returns 更新后的安全用户信息
   * @throws {Error} 如果用户不存在或状态无效
   */
  async updateUserStatus(
    userId: string,
    status: 'pending' | 'approved' | 'rejected'
  ): Promise<SafeUser> {
    const traceId = generateTraceId();
    log.info(`⇢ updateUserStatus`, traceId, { userId, status });

    const updated = await userRepository.update(userId, { status });
    if (!updated) {
      log.warn(`更新失败: 用户不存在`, traceId, { userId });
      throw new Error('用户不存在');
    }
    log.info(`✓ updateUserStatus 完成: ${userId} -> ${status}`, traceId);
    return updated;
  }

  /**
   * 更新用户角色
   *
   * @param userId - 用户ID
   * @param role - 新角色
   * @returns 更新后的安全用户信息
   * @throws {Error} 如果用户不存在或角色无效
   */
  async updateUserRole(
    userId: string,
    role: 'admin' | 'senior' | 'member'
  ): Promise<SafeUser> {
    const traceId = generateTraceId();
    log.info(`⇢ updateUserRole`, traceId, { userId, role });

    const updated = await userRepository.update(userId, { role });
    if (!updated) {
      log.warn(`更新失败: 用户不存在`, traceId, { userId });
      throw new Error('用户不存在');
    }
    log.info(`✓ updateUserRole 完成: ${userId} -> ${role}`, traceId);
    return updated;
  }

  /**
   * 更新用户个人资料
   *
   * @param userId - 用户ID
   * @param data - 要更新的数据
   * @param isAdmin - 是否是管理员操作
   * @returns 更新后的安全用户信息
   * @throws {Error} 如果用户不存在或数据无效
   */
  async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      region?: string;
    },
    isAdmin: boolean = false
  ): Promise<SafeUser> {
    const traceId = generateTraceId();
    log.info(`⇢ updateProfile`, traceId, { userId, updateFields: Object.keys(data) });

    // 只有管理员才能将区域设为"全部"
    if (data.region === '全部' && !isAdmin) {
      log.warn(`更新失败: 非管理员不能将区域设为全部`, traceId, { userId });
      throw new Error('仅管理员可将区域设为"全部"');
    }

    const updated = await userRepository.update(userId, {
      displayName: data.displayName,
      region: data.region,
    });

    if (!updated) {
      log.warn(`更新失败: 用户不存在`, traceId, { userId });
      throw new Error('用户不存在');
    }

    log.info(`✓ updateProfile 完成: ${userId}`, traceId);
    return updated;
  }

  /**
   * 修改用户密码
   *
   * @param userId - 用户ID
   * @param currentPassword - 当前密码
   * @param newPassword - 新密码
   * @throws {Error} 如果密码验证失败或用户不存在
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ changePassword`, traceId, { userId });

    if (!userId || !currentPassword || !newPassword) {
      log.warn(`修改密码失败: 信息不完整`, traceId);
      throw new Error('请填写完整信息');
    }

    if (newPassword.length < 6) {
      log.warn(`修改密码失败: 新密码太短`, traceId);
      throw new Error('新密码至少6位');
    }

    const user = await userRepository.findById(userId);

    if (!user) {
      log.warn(`修改密码失败: 用户不存在`, traceId, { userId });
      throw new Error('用户不存在');
    }

    // 验证当前密码
    const isPasswordValid = bcrypt.compareSync(currentPassword, user.password);
    if (!isPasswordValid) {
      log.warn(`修改密码失败: 当前密码不正确`, traceId, { userId });
      throw new Error('当前密码不正确');
    }

    // 更新密码
    await userRepository.update(userId, {
      password: bcrypt.hashSync(newPassword, this.saltRounds),
    });
    log.info(`✓ changePassword 完成: ${userId}`, traceId);
  }

  /**
   * 管理员重置用户密码
   *
   * @param userId - 用户ID
   * @param newPassword - 新密码
   * @throws {Error} 如果用户不存在或密码无效
   */
  async adminResetPassword(userId: string, newPassword: string): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ adminResetPassword`, traceId, { userId });

    if (!newPassword) {
      log.warn(`重置密码失败: 密码为空`, traceId);
      throw new Error('新密码不能为空');
    }

    if (newPassword.length < 6) {
      log.warn(`重置密码失败: 密码太短`, traceId);
      throw new Error('新密码至少6位');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      log.warn(`重置密码失败: 用户不存在`, traceId, { userId });
      throw new Error('用户不存在');
    }

    await userRepository.update(userId, {
      password: bcrypt.hashSync(newPassword, this.saltRounds),
    });
    log.info(`✓ adminResetPassword 完成: ${userId}`, traceId);
  }

  /**
   * 获取用户信息（内部使用）
   *
   * @param userId - 用户ID
   * @returns 用户信息或null
   */
  async getUserById(userId: string): Promise<User | null> {
    return userRepository.findById(userId);
  }
}

/**
 * 用户服务单例实例
 */
export const userService = new UserService();
