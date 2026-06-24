/**
 * JWT鉴权中间件模块
 * 
 * 本模块提供JWT Token的生成、验证和鉴权中间件功能。
 * 用于保护API端点，确保只有经过认证和授权的用户才能访问。
 * 
 * @module auth
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { ApiResponse } from '../types';

/**
 * 用户角色类型
 */
export type UserRole = 'admin' | 'senior' | 'member';

/**
 * 用户信息接口
 */
export interface User {
  /** 用户ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 用户角色 */
  role: UserRole;
}

/**
 * JWT Token负载接口
 */
export interface JwtPayload extends User {
  /** 签发时间 */
  iat: number;
  /** 过期时间 */
  exp: number;
}

/**
 * 扩展Express Request接口，添加用户信息
 */
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * 生成JWT Token
 * 
 * @param user - 用户信息
 * @returns 生成的JWT Token字符串
 * @throws {Error} 如果JWT_SECRET未配置则抛出错误
 */
export function generateToken(user: User): string {
  const config = getConfig();
  
  if (!config.JWT_SECRET) {
    throw new Error('JWT_SECRET未配置，无法生成Token');
  }
  
  const payload = {
    userId: user.userId,
    username: user.username,
    role: user.role,
  };
  
  const options: jwt.SignOptions = {
    expiresIn: config.JWT_EXPIRES_IN as any,
  };
  
  return jwt.sign(payload, config.JWT_SECRET, options);
}

/**
 * 验证并解码JWT Token
 * 
 * @param token - JWT Token字符串
 * @returns 解码后的Token负载
 * @throws {Error} 如果Token无效或过期则抛出错误
 */
export function verifyToken(token: string): JwtPayload {
  const config = getConfig();
  
  if (!config.JWT_SECRET) {
    throw new Error('JWT_SECRET未配置，无法验证Token');
  }
  
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token已过期');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Token无效');
    } else {
      throw new Error('Token验证失败');
    }
  }
}

/**
 * JWT鉴权中间件
 * 
 * 验证请求中的Authorization头是否包含有效的JWT Token。
 * 如果验证成功，将用户信息添加到req.user中。
 * 
 * @param req - Express请求对象
 * @param res - Express响应对象
 * @param next - Express下一个中间件函数
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    // 获取Authorization头
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      const response: ApiResponse<null> = {
        code: 401,
        data: null,
        message: '未提供Authorization头',
        error: '缺少认证信息',
      };
      res.status(401).json(response);
      return;
    }
    
    // 检查Authorization头格式
    if (!authHeader.startsWith('Bearer ')) {
      const response: ApiResponse<null> = {
        code: 401,
        data: null,
        message: 'Authorization头格式错误',
        error: '应使用Bearer格式',
      };
      res.status(401).json(response);
      return;
    }
    
    // 提取Token
    const token = authHeader.substring(7); // 移除'Bearer '前缀
    
    if (!token) {
      const response: ApiResponse<null> = {
        code: 401,
        data: null,
        message: '未提供Token',
        error: 'Token为空',
      };
      res.status(401).json(response);
      return;
    }
    
    // 验证Token
    const decoded = verifyToken(token);
    
    // 将用户信息添加到请求对象
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
    };
    
    // 继续执行下一个中间件
    next();
    
  } catch (error) {
    console.error('JWT鉴权失败:', error);
    
    const response: ApiResponse<null> = {
      code: 401,
      data: null,
      message: '认证失败',
      error: error instanceof Error ? error.message : 'Token验证失败',
    };
    
    res.status(401).json(response);
  }
}

/**
 * 角色授权中间件工厂
 * 
 * 创建一个中间件，检查用户是否具有指定角色之一。
 * 
 * @param roles - 允许的角色列表
 * @returns Express中间件函数
 */
export function authorize(roles: UserRole[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // 检查用户信息是否存在（authenticate中间件应该已经设置）
      if (!req.user) {
        const response: ApiResponse<null> = {
          code: 401,
          data: null,
          message: '用户未认证',
          error: '缺少用户信息',
        };
        res.status(401).json(response);
        return;
      }
      
      // 检查用户角色是否在允许列表中
      if (!roles.includes(req.user.role)) {
        const response: ApiResponse<null> = {
          code: 403,
          data: null,
          message: '权限不足',
          error: `需要角色: ${roles.join(', ')}`,
        };
        res.status(403).json(response);
        return;
      }
      
      // 权限验证通过，继续执行
      next();
      
    } catch (error) {
      console.error('角色授权失败:', error);
      
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '授权检查失败',
        error: error instanceof Error ? error.message : '未知错误',
      };
      
      res.status(500).json(response);
    }
  };
}

/**
 * 验证Token有效性（不抛出异常）
 * 
 * @param token - JWT Token字符串
 * @returns 是否有效
 */
export function isTokenValid(token: string): boolean {
  try {
    verifyToken(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从Token中提取用户信息（不验证签名）
 * 
 * @param token - JWT Token字符串
 * @returns 解码后的用户信息或null
 */
export function extractUserFromToken(token: string): User | null {
  try {
    const decoded = jwt.decode(token) as JwtPayload | null;
    if (!decoded) {
      return null;
    }
    
    return {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}