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
 * 安全错误消息：生产环境下模糊化内部错误详情
 * @param error - 错误对象
 * @returns 适合返回给客户端的错误消息
 */
export function safeErrorMessage(error: unknown): string {
  if (process.env.NODE_ENV === 'production') {
    return '操作失败，请稍后重试';
  }
  return error instanceof Error ? error.message : String(error);
}