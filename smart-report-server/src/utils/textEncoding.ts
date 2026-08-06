/**
 * 文本编码解码工具
 *
 * 运维场景中日志文件来源复杂：Linux 导出的多为 UTF-8，中文 Windows / 老设备
 * 导出的常为 GBK，部分工具会带 BOM。Node 默认按 UTF-8 解码 GBK 文件会产生
 * 大量 U+FFFD 替换字符（乱码），直接送给 AI 会污染分析上下文。
 *
 * 本模块提供统一的 Buffer → 文本解码，按 BOM → UTF-8 → GBK 的顺序探测，
 * 以替换字符数量作为解码质量的评判依据。
 *
 * @module utils/textEncoding
 */

import iconv from 'iconv-lite';

/** 统计字符串中 U+FFFD 替换字符（解码失败标志）的数量 */
function countReplacementChars(s: string): number {
  let count = 0;
  let idx = s.indexOf('�');
  while (idx !== -1) {
    count++;
    idx = s.indexOf('�', idx + 1);
  }
  return count;
}

/**
 * 将文件 Buffer 解码为文本，自动探测编码。
 *
 * 探测顺序：
 * 1. UTF-8 BOM（EF BB BF）→ 按 UTF-8 解码并去除 BOM
 * 2. UTF-16 LE BOM（FF FE）→ 按 UTF-16 LE 解码
 * 3. UTF-16 BE BOM（FE FF）→ 字节交换后按 UTF-16 LE 解码
 * 4. 无 BOM：先按 UTF-8 解码，若无替换字符直接返回
 * 5. UTF-8 解码含替换字符时，尝试 GBK（中文 Windows 日志常见），
 *    替换字符更少者胜出
 *
 * @param buffer 文件内容
 * @returns 解码后的文本
 */
export function decodeTextBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) return '';

  // 1. UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString('utf-8');
  }
  // 2. UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.subarray(2).toString('utf16le');
  }
  // 3. UTF-16 BE BOM（Node 不直接支持 utf16be，交换字节后按 LE 解码）
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const body = buffer.subarray(2);
    const swapped = Buffer.allocUnsafe(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    if (body.length % 2 === 1) swapped[body.length - 1] = body[body.length - 1];
    return swapped.toString('utf16le');
  }

  // 4. 无 BOM：先试 UTF-8
  const utf8 = buffer.toString('utf-8');
  const utf8Bad = countReplacementChars(utf8);
  if (utf8Bad === 0) return utf8;

  // 5. UTF-8 含无效序列：尝试 GBK，取替换字符更少者
  try {
    const gbk = iconv.decode(buffer, 'gbk');
    if (countReplacementChars(gbk) < utf8Bad) return gbk;
  } catch { /* GBK 解码失败则保留 UTF-8 结果 */ }

  return utf8;
}
