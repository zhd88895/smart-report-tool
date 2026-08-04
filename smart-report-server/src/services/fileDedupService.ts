/**
 * 上传文件去重服务（内容寻址存储）
 *
 * 文件以 SHA-256 命名存于 data/uploads/dedup/，同内容仅存一份；
 * file_hashes 表记录索引与最近使用时间（保留清理依据）。
 *
 * @module services/fileDedupService
 */

import { createHash } from 'crypto';
import path from 'path';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { copyFile, rename, unlink, writeFile } from 'fs/promises';
import { UPLOADS_DIR } from '../config';
import { allAsync, getAsync, runAsync } from '../db/database';
import { getLogger } from '../utils/logger';

const log = getLogger('FileDedupService', 'core');

const DEDUP_DIR = path.join(UPLOADS_DIR, 'dedup');

export interface DedupEntry {
  hash: string;
  fileName: string;
  size: number;
  /** 绝对路径 */
  path: string;
}

function ensureDedupDir(): void {
  if (!existsSync(DEDUP_DIR)) mkdirSync(DEDUP_DIR, { recursive: true });
}

/** 流式计算文件完整 SHA-256 */
async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function insertRow(hash: string, fileName: string, size: number, relPath: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await runAsync(
    `INSERT OR IGNORE INTO file_hashes (hash, file_name, size, path, uploaded_by, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hash, fileName, size, relPath, userId, now, now]
  );
}

/** 移动文件到 dedup 目录（rename 失败时 copy+unlink 回退，跨盘兼容） */
async function moveToDedup(src: string, hash: string, ext: string): Promise<string> {
  ensureDedupDir();
  const rel = path.join('dedup', `${hash}${ext}`);
  const dest = path.join(UPLOADS_DIR, rel);
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await unlink(src).catch(() => {});
  }
  return rel;
}

export const fileDedupService = {
  /** 注册落盘临时文件：命中则删临时文件复用旧文件，未命中则收编入 CAS */
  async register(tempPath: string, originalName: string, userId: string) {
    const hash = await hashFile(tempPath);
    const existing = await this.lookup(hash);
    if (existing) {
      await unlink(tempPath).catch(() => {});
      await this.touch(hash);
      return { hash, path: existing.path, size: existing.size, deduped: true };
    }
    const size = statSync(tempPath).size;
    const rel = await moveToDedup(tempPath, hash, path.extname(originalName));
    await insertRow(hash, originalName, size, rel, userId);
    return { hash, path: path.join(UPLOADS_DIR, rel), size, deduped: false };
  },

  /** 注册内存 buffer（AI 分析上传用）：仅未命中时写盘 */
  async registerBuffer(buffer: Buffer, originalName: string, userId: string) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.lookup(hash);
    if (existing) {
      await this.touch(hash);
      return { hash, path: existing.path, size: existing.size, deduped: true };
    }
    ensureDedupDir();
    const rel = path.join('dedup', `${hash}${path.extname(originalName)}`);
    await writeFile(path.join(UPLOADS_DIR, rel), buffer);
    await insertRow(hash, originalName, buffer.length, rel, userId);
    return { hash, path: path.join(UPLOADS_DIR, rel), size: buffer.length, deduped: false };
  },

  /** 按 hash 查找；索引在但文件丢失时清掉索引行返回 null */
  async lookup(hash: string): Promise<DedupEntry | null> {
    const row = await getAsync(`SELECT * FROM file_hashes WHERE hash = ?`, [hash]) as any;
    if (!row) return null;
    const abs = path.join(UPLOADS_DIR, row.path);
    if (!existsSync(abs)) {
      await runAsync(`DELETE FROM file_hashes WHERE hash = ?`, [hash]);
      log.warn(`去重索引文件丢失，已清理索引: ${hash.slice(0, 12)}…`);
      return null;
    }
    return { hash: row.hash, fileName: row.file_name, size: row.size, path: abs };
  },

  /** 刷新最近使用时间（保留清理依据） */
  async touch(hash: string): Promise<void> {
    await runAsync(`UPDATE file_hashes SET last_used_at = ? WHERE hash = ?`, [new Date().toISOString(), hash]);
  },

  /** CAS 清理：last_used_at 早于 cutoff 的记录删文件 + 删行 */
  async cleanupDedup(cutoffIso: string): Promise<{ deleted: number; freedBytes: number }> {
    const rows = await allAsync(`SELECT hash, path, size FROM file_hashes WHERE last_used_at < ?`, [cutoffIso]) as any[];
    let deleted = 0, freedBytes = 0;
    for (const row of rows) {
      try { await unlink(path.join(UPLOADS_DIR, row.path)); freedBytes += row.size; } catch { /* 文件可能已不存在 */ }
      await runAsync(`DELETE FROM file_hashes WHERE hash = ?`, [row.hash]);
      deleted++;
    }
    return { deleted, freedBytes };
  },

  /** 散落清理：uploads 根目录（不含 dedup/ 子目录）中 mtime 超期的游离文件 */
  async cleanupStray(cutoffMs: number): Promise<{ deleted: number; freedBytes: number }> {
    let deleted = 0, freedBytes = 0;
    for (const name of readdirSync(UPLOADS_DIR)) {
      const full = path.join(UPLOADS_DIR, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue; // 跳过 dedup/ 等目录
        if (st.mtimeMs >= cutoffMs) continue;
        await unlink(full);
        deleted++; freedBytes += st.size;
      } catch { /* 单文件失败不阻塞 */ }
    }
    return { deleted, freedBytes };
  },
};
