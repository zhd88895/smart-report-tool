/**
 * 通用类型定义模块
 * 
 * 本模块定义了应用中使用的通用接口和类型。
 * 
 * @module types
 */

/**
 * API响应格式接口
 * 
 * @template T - 响应数据的类型
 */
export interface ApiResponse<T> {
  /** 响应状态码 */
  code: number;
  /** 响应数据 */
  data: T;
  /** 响应消息 */
  message: string;
  /** 错误信息（可选） */
  error?: string;
}

/**
 * 分页请求参数接口
 */
export interface PaginationParams {
  /** 当前页码（从1开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 排序字段 */
  sortBy?: string;
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页响应数据接口
 * 
 * @template T - 列表项的类型
 */
export interface PaginatedResponse<T> {
  /** 数据列表 */
  items: T[];
  /** 总数量 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
  /** 是否有下一页 */
  hasNext: boolean;
  /** 是否有上一页 */
  hasPrev: boolean;
}

/**
 * 用户信息接口
 */
export interface UserInfo {
  /** 用户ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** 角色 */
  role: 'admin' | 'senior' | 'member';
  /** 创建时间 */
  createdAt: Date;
  /** 最后登录时间 */
  lastLoginAt?: Date;
}

/**
 * 文件信息接口
 */
export interface FileInfo {
  /** 文件ID */
  id: string;
  /** 文件名 */
  fileName: string;
  /** 文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** MIME类型 */
  mimeType: string;
  /** 上传时间 */
  uploadedAt: Date;
  /** 上传者ID */
  uploadedBy: string;
}

/**
 * 报告信息接口
 */
export interface ReportInfo {
  /** 报告ID */
  id: string;
  /** 报告标题 */
  title: string;
  /** 报告描述 */
  description: string;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** 创建者ID */
  createdBy: string;
  /** 报告状态 */
  status: 'draft' | 'published' | 'archived';
  /** 文件ID列表 */
  fileIds: string[];
}

/**
 * 日志记录接口
 */
export interface LogRecord {
  /** 日志ID */
  id: string;
  /** 时间戳 */
  timestamp: Date;
  /** 日志级别 */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** 消息 */
  message: string;
  /** 用户ID */
  userId?: string;
  /** IP地址 */
  ip?: string;
  /** 额外数据 */
  metadata?: Record<string, any>;
}