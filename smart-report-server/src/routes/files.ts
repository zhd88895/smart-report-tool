/**
 * 文件相关路由：上传前 hash 预检查（秒传判定）
 *
 * @module routes/files
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { fileDedupService } from '../services/fileDedupService';
import { ApiResponse } from '../types';

const router = Router();

const HASH_RE = /^[a-f0-9]{64}$/i;
const MAX_HASHES = 100;

/**
 * POST /api/files/check-hashes
 * body: { hashes: string[] }
 * 响应: { existing: { [hash]: { fileName, size } } } —— 仅含命中项
 */
router.post('/check-hashes', authenticate, async (req: Request, res: Response) => {
  const hashes = (req.body as any)?.hashes;
  if (!Array.isArray(hashes)) {
    res.status(400).json({ code: 400, data: null, message: 'hashes 必须为数组' } satisfies ApiResponse<null>);
    return;
  }
  const existing: Record<string, { fileName: string; size: number }> = {};
  for (const h of hashes.slice(0, MAX_HASHES)) {
    if (typeof h !== 'string' || !HASH_RE.test(h)) continue;
    const entry = await fileDedupService.lookup(h.toLowerCase());
    if (entry) existing[h.toLowerCase()] = { fileName: entry.fileName, size: entry.size };
  }
  res.json({ code: 200, data: { existing }, message: 'success' } satisfies ApiResponse<any>);
});

export default router;
