/**
 * CORS配置中间件模块
 * 
 * 本模块提供CORS（跨源资源共享）配置中间件，用于控制允许的跨域请求。
 * 从配置中读取允许的来源列表，动态设置Access-Control-Allow-Origin头。
 * 
 * @module cors
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config';

/**
 * CORS配置接口
 */
export interface CorsOptions {
  /** 允许的来源列表，默认从配置读取 */
  allowedOrigins?: string[];
  /** 允许的HTTP方法，默认GET,HEAD,PUT,PATCH,POST,DELETE */
  allowedMethods?: string[];
  /** 允许的请求头，默认Content-Type,Authorization */
  allowedHeaders?: string[];
  /** 允许的响应头，默认Content-Length */
  exposedHeaders?: string[];
  /** 是否允许携带凭证，默认true */
  credentials?: boolean;
  /** 预检请求缓存时间（秒），默认86400（24小时） */
  maxAge?: number;
}

/**
 * 默认CORS选项
 */
const defaultCorsOptions: CorsOptions = {
  allowedOrigins: getConfig().ALLOWED_ORIGINS,
  allowedMethods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length'],
  credentials: true,
  maxAge: 86400, // 24小时
};

/**
 * 检查请求来源是否在允许列表中
 * 
 * @param origin - 请求来源
 * @param allowedOrigins - 允许的来源列表
 * @returns 是否允许
 */
function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  // 如果没有origin头（非浏览器请求），允许
  if (!origin) {
    return true;
  }
  
  // 检查是否在允许列表中
  return allowedOrigins.some(allowedOrigin => {
    // 精确匹配
    if (origin === allowedOrigin) {
      return true;
    }
    
    // 支持通配符子域名（例如：*.example.com）
    if (allowedOrigin.startsWith('*.')) {
      const domain = allowedOrigin.substring(2); // 移除'*.'
      try {
        const originUrl = new URL(origin);
        return originUrl.hostname.endsWith(domain);
      } catch {
        return false;
      }
    }
    
    return false;
  });
}

/**
 * 创建CORS中间件
 * 
 * @param options - CORS配置选项
 * @returns Express中间件函数
 */
export function createCorsMiddleware(options?: CorsOptions): (req: Request, res: Response, next: NextFunction) => void {
  // 合并选项
  const corsOptions = { ...defaultCorsOptions, ...options };
  
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const origin = req.headers.origin;
      
      // 检查来源是否允许
      if (!isOriginAllowed(origin, corsOptions.allowedOrigins || [])) {
        // 如果来源不在允许列表中，不设置CORS头
        // 这会让浏览器拒绝跨域请求
        next();
        return;
      }
      
      // 设置允许的来源
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      } else {
        // 非浏览器请求，可以设置为允许的来源或'*'
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      
      // 设置允许的凭证
      if (corsOptions.credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      
      // 设置允许的响应头
      if (corsOptions.exposedHeaders && corsOptions.exposedHeaders.length > 0) {
        res.setHeader('Access-Control-Expose-Headers', corsOptions.exposedHeaders.join(', '));
      }
      
      // 处理预检请求（OPTIONS）
      if (req.method === 'OPTIONS') {
        // 设置允许的HTTP方法
        res.setHeader('Access-Control-Allow-Methods', corsOptions.allowedMethods?.join(', ') || '');
        
        // 设置允许的请求头
        res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders?.join(', ') || '');
        
        // 设置预检缓存时间
        if (corsOptions.maxAge) {
          res.setHeader('Access-Control-Max-Age', corsOptions.maxAge.toString());
        }
        
        // 返回204 No Content
        res.status(204).end();
        return;
      }
      
      // 继续执行下一个中间件
      next();
      
    } catch (error) {
      console.error('CORS中间件错误:', error);
      next(error);
    }
  };
}

/**
 * 默认CORS中间件
 */
export const corsMiddleware = createCorsMiddleware();

/**
 * 严格CORS中间件（仅允许特定来源）
 */
export const strictCorsMiddleware = createCorsMiddleware({
  credentials: true,
  maxAge: 3600, // 1小时
});

/**
 * 公开CORS中间件（允许所有来源）
 */
export const publicCorsMiddleware = createCorsMiddleware({
  allowedOrigins: ['*'],
  credentials: false,
  maxAge: 86400,
});