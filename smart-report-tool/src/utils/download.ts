/**
 * 下载相关工具函数
 *
 * @module utils/download
 */

/**
 * 解析 Content-Disposition 响应头中的文件名。
 *
 * 后端会同时返回两种格式：
 *   Content-Disposition: attachment; filename="ascii_fallback"; filename*=UTF-8''%E4%B8%AD%E6%96%87
 *
 * 必须优先匹配 RFC 5987 的 `filename*=`（UTF-8 percent-encoding），
 * 否则普通正则会贪婪命中第一个 `filename=`（ASCII fallback，中文已被替换为 ?）。
 *
 * @param cd - Content-Disposition 响应头原始值
 * @returns 解码后的文件名；无法解析时返回 null
 */
export function parseContentDispositionFilename(cd: string | null): string | null {
  if (!cd) return null;
  // 优先 RFC 5987 filename*=UTF-8''...
  const star = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1].trim());
  // fallback 到普通 filename=
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/);
  if (plain) return decodeURIComponent(plain[1].trim());
  return null;
}
