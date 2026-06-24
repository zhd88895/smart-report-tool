import JSZip from 'jszip';
import * as pako from 'pako';

export interface ArchiveEntry {
  name: string;
  size: number;
  content: string; // base64 or text
  isText: boolean;
}

export interface ExtractResult {
  entries: ArchiveEntry[];
  errors: string[];
}

/** Detect archive type from filename */
export function detectArchiveType(filename: string): 'zip' | 'gz' | 'tar' | 'rar' | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'zip') return 'zip';
  if (ext === 'gz' || ext === 'tgz') return 'gz';
  if (ext === 'tar') return 'tar';
  if (ext === 'rar') return 'rar';
  return null;
}

/**
 * 智能解码文件名：先尝试 UTF-8，如果包含乱码则回退到 GBK。
 * Windows 上压缩工具（WinRAR/7-Zip/系统右键压缩）生成的中文 ZIP 文件名通常编码为 GBK。
 */
function decodeFileName(bytes: Uint8Array): string {
  // 先尝试 UTF-8
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  try {
    const decoded = utf8.decode(bytes).replace(/\0/g, '').trim();
    // 检查是否包含明显的乱码特征
    if (decoded && !/[\uFFFD]{2,}/.test(decoded) && !/[\x00-\x08\x0B\x0C\x0E-\x1F]{3,}/.test(decoded)) {
      return decoded;
    }
  } catch { /* UTF-8 解码失败 */ }

  // 回退到 GBK
  try {
    const gbk = new TextDecoder('gbk', { fatal: true });
    const decoded = gbk.decode(bytes).replace(/\0/g, '').trim();
    if (decoded) return decoded;
  } catch { /* GBK 也失败 */ }

  // 最后手段
  return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
}

/** Extract ZIP archive */
export async function extractZip(file: File): Promise<ExtractResult> {
  const result: ExtractResult = { entries: [], errors: [] };
  try {
    const zip = await JSZip.loadAsync(file, {
      // 自动检测文件名编码：尝试 UTF-8，失败回退 GBK
      decodeFileName: (bytes) => {
        // JSZip 传入的 bytes 可能是 string[]（字符码数组）、Uint8Array 或 Buffer
        let arr: Uint8Array;
        if (Array.isArray(bytes)) {
          arr = new Uint8Array(bytes.map((c: string) => c.charCodeAt(0)));
        } else {
          arr = new Uint8Array((bytes as Uint8Array).buffer);
        }
        // 先尝试 UTF-8
        try {
          const utf8 = new TextDecoder('utf-8', { fatal: true });
          const decoded = utf8.decode(arr);
          if (!/[\uFFFD]{2,}/.test(decoded)) return decoded;
        } catch {}
        // 回退 GBK
        try {
          const gbk = new TextDecoder('gbk', { fatal: true });
          return gbk.decode(arr);
        } catch {}
        return new TextDecoder('utf-8').decode(arr);
      },
    });
    const promises: Promise<void>[] = [];
    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      promises.push(
        entry.async('uint8array').then((data) => {
          const isText = isTextFile(relativePath);
          result.entries.push({
            name: relativePath,
            size: data.length,
            content: isText ? new TextDecoder('utf-8').decode(data) : arrayBufferToBase64(data),
            isText,
          });
        })
      );
    });
    await Promise.all(promises);
  } catch (e) {
    result.errors.push(`ZIP 解压失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

/** Extract GZ (gzip) - single file */
export async function extractGz(file: File): Promise<ExtractResult> {
  const result: ExtractResult = { entries: [], errors: [] };
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const inflated = pako.inflate(uint8);
    const isText = isTextFile(file.name.replace(/\.gz$/i, ''));
    result.entries.push({
      name: file.name.replace(/\.gz$/i, ''),
      size: inflated.length,
      content: isText ? new TextDecoder('utf-8').decode(inflated) : arrayBufferToBase64(inflated),
      isText,
    });
  } catch (e) {
    result.errors.push(`GZ 解压失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

/** Extract TAR archive (basic parser) */
export async function extractTar(file: File): Promise<ExtractResult> {
  const result: ExtractResult = { entries: [], errors: [] };
  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    let offset = 0;
    while (offset + 512 <= data.length) {
      // TAR header is 512 bytes
      const nameBytes = data.slice(offset, offset + 100);
      const name = decodeFileName(nameBytes);
      if (!name) break;

      const sizeBytes = data.slice(offset + 124, offset + 136);
      const sizeStr = new TextDecoder('ascii').decode(sizeBytes).replace(/\0/g, '').trim();
      const fileSize = parseInt(sizeStr, 8);
      if (isNaN(fileSize)) { offset += 512; continue; }

      const contentBytes = data.slice(offset + 512, offset + 512 + fileSize);
      const isText = isTextFile(name);
      result.entries.push({
        name,
        size: fileSize,
        content: isText ? new TextDecoder('utf-8').decode(contentBytes) : arrayBufferToBase64(contentBytes),
        isText,
      });

      offset += 512 + fileSize;
      if (offset % 512 !== 0) offset += 512 - (offset % 512);
    }
  } catch (e) {
    result.errors.push(`TAR 解压失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

/** Main extract dispatcher */
export async function extractArchive(file: File): Promise<ExtractResult> {
  const type = detectArchiveType(file.name);
  switch (type) {
    case 'zip': return extractZip(file);
    case 'gz': return extractGz(file);
    case 'tar': return extractTar(file);
    case 'rar': return { entries: [], errors: ['RAR 格式暂不支持，请解压后重新上传'] };
    default: return { entries: [], errors: ['未知的压缩格式'] };
  }
}

function isTextFile(filename: string): boolean {
  const textExts = ['.txt', '.log', '.csv', '.json', '.xml', '.html', '.md', '.cfg', '.conf', '.ini', '.yaml', '.yml', '.py', '.sh', '.bat', '.ps1'];
  const lower = filename.toLowerCase();
  return textExts.some((ext) => lower.endsWith(ext));
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
