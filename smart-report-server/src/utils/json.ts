/**
 * JSON 工具函数
 *
 * 提供安全的 JSON 解析和序列化工具。
 *
 * @module utils/json
 */

/**
 * 安全 JSON 解析：失败时返回默认值
 * @param value - 待解析的 JSON 字符串
 * @param defaultValue - 解析失败时的默认值
 */
export function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}
