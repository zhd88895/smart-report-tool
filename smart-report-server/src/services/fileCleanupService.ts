/**
 * 临时上传文件保留清理调度
 *
 * 启动后延迟 1 分钟运行一次，之后每 6 小时运行：
 * - CAS（file_hashes）按 last_used_at 超过 retentionDays 删除；
 * - data/uploads/ 根目录游离文件按 mtime 超过 retentionDays 删除。
 * 保留天数动态读取系统设置 storage.retentionDays（默认 90）。
 *
 * @module services/fileCleanupService
 */

import { fileDedupService } from './fileDedupService';
import { settingsService } from './settingsService';
import { getLogger } from '../utils/logger';

const log = getLogger('FileCleanupService', 'core');

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时
const STARTUP_DELAY_MS = 60 * 1000;     // 启动后 1 分钟
const DEFAULT_RETENTION_DAYS = 90;

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function runCleanupOnce(): Promise<void> {
  try {
    const days = settingsService.getNumber('storage.retentionDays', DEFAULT_RETENTION_DAYS);
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const dedup = await fileDedupService.cleanupDedup(cutoffIso);
    const stray = await fileDedupService.cleanupStray(cutoffMs);

    if (dedup.deleted + stray.deleted > 0) {
      log.info(
        `临时文件清理完成（保留 ${days} 天）: 去重存储 ${dedup.deleted} 个/${fmtMB(dedup.freedBytes)}，` +
        `散落文件 ${stray.deleted} 个/${fmtMB(stray.freedBytes)}`
      );
    }
  } catch (e: any) {
    log.warn(`临时文件清理失败: ${e?.message || e}`);
  }
}

/** 启动清理调度（服务启动时调用一次） */
export function startFileCleanupScheduler(): void {
  const timer = setTimeout(() => {
    runCleanupOnce();
    setInterval(runCleanupOnce, INTERVAL_MS).unref();
  }, STARTUP_DELAY_MS);
  timer.unref();
  log.info('临时文件清理调度已启动（每 6 小时，保留天数取系统设置 storage.retentionDays）');
}
