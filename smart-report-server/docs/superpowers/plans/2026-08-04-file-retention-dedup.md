# 文件保留清理 + 上传去重（秒传）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现临时上传文件的保留天数自动清理，以及基于完整 SHA-256 的上传去重（秒传），覆盖报告生成与 AI 文件分析两条上传链路。

**Architecture:** 后端新增内容寻址存储（`data/uploads/dedup/` + `file_hashes` 表）与两个服务（fileDedupService / fileCleanupService）；前端上传前先算 hash 调 check-hashes 预检查，命中则跳过上传改传 hash 引用。

**Tech Stack:** Express + sqlite3（后端，仓库 `smart-report-server/`）、React + zustand（前端，仓库 `smart-report-tool/`）。

## Global Constraints

- 设计规格：`smart-report-server/docs/superpowers/specs/2026-08-04-file-retention-dedup-design.md`，本计划覆盖其全部组件。
- 项目无单元测试框架：验证以 `npx tsc --noEmit`（双端零错误）、`npx vite build`、curl 接口实测与浏览器实测替代 TDD 测试循环。
- Node 不在默认 PATH，所有 node 命令前缀 `export PATH="/c/Program Files/nodejs:$PATH"`。
- hash 一律使用完整文件内容的 SHA-256（64 位十六进制小写）。
- 清理范围严格限定 `data/uploads/`，不得触碰 scripts / reports / knowledge-base / templates。
- 两个仓库分别提交（`smart-report-server/`、`smart-report-tool/`），master 分支直接提交。
- 完成后同步运行中的数据库（`smart-report-server/data/smart-report.db`）并重启后端实测。

---

### Task 1: fileDedupService + file_hashes 表 + check-hashes 端点

**Files:**
- Create: `smart-report-server/src/services/fileDedupService.ts`
- Create: `smart-report-server/src/routes/files.ts`
- Modify: `smart-report-server/src/db/database.ts`（迁移区，cleanupDeadAISettings 之后新增建表）
- Modify: `smart-report-server/src/index.ts`（挂载 `/api/files`）

**Interfaces:**
- Produces（后续任务依赖）:
  - `fileDedupService.register(tempPath: string, originalName: string, userId: string): Promise<{ hash: string; path: string; size: number; deduped: boolean }>`（path 为绝对路径）
  - `fileDedupService.registerBuffer(buffer: Buffer, originalName: string, userId: string): Promise<{ hash: string; path: string; size: number; deduped: boolean }>`
  - `fileDedupService.lookup(hash: string): Promise<{ hash: string; fileName: string; size: number; path: string } | null>`
  - `fileDedupService.touch(hash: string): Promise<void>`
  - `fileDedupService.cleanupDedup(cutoffIso: string): Promise<{ deleted: number; freedBytes: number }>`
  - `fileDedupService.cleanupStray(cutoffMs: number): Promise<{ deleted: number; freedBytes: number }>`
  - HTTP `POST /api/files/check-hashes`，body `{ hashes: string[] }`，响应 `{ code:200, data:{ existing: Record<string, {fileName:string; size:number}> } }`

- [ ] **Step 1: database.ts 增加 file_hashes 建表迁移**

在 `migrateSettingsHiddenFlag()` 调用之后（`runMigrations` 内）追加：

```ts
  // 迁移：上传文件 hash 去重索引表（内容寻址存储 data/uploads/dedup/）
  await runAsync(`CREATE TABLE IF NOT EXISTS file_hashes (
    hash TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  )`);
```

- [ ] **Step 2: 创建 fileDedupService.ts**

```ts
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
import { copyFile, readFile, rename, unlink, writeFile } from 'fs/promises';
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
```

- [ ] **Step 3: 创建 routes/files.ts**

```ts
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
```

- [ ] **Step 4: index.ts 挂载路由**

在 `app.use('/api/users', apiLimiter, userRoutes.getRouter());` 附近（其他路由挂载处）追加：

```ts
import filesRoutes from './routes/files';
// ...
app.use('/api/files', apiLimiter, filesRoutes);
```

- [ ] **Step 5: 验证 + 提交**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && cd smart-report-server && npx tsc --noEmit`
Expected: 无错误输出
Run: `git add -A && git commit -m "feat(files): 内容寻址去重存储 + check-hashes 预检查端点"`

---

### Task 2: fileCleanupService + retentionDays 设置开放 + 调度挂载

**Files:**
- Create: `smart-report-server/src/services/fileCleanupService.ts`
- Modify: `smart-report-server/src/db/database.ts`（seed 描述、PLACEHOLDER_SETTING_KEYS 移除该 key、迁移 unhide 清单追加）
- Modify: `smart-report-server/src/index.ts`（启动调度）

**Interfaces:**
- Consumes: `fileDedupService.cleanupDedup / cleanupStray`（Task 1）、`settingsService.getNumber`
- Produces: `startFileCleanupScheduler(): void`（index.ts 调用一次）

- [ ] **Step 1: 创建 fileCleanupService.ts**

```ts
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
```

- [ ] **Step 2: database.ts 开放 storage.retentionDays**

三处修改：
1. seed 中该条改为：
```ts
      { key: 'storage.retentionDays', value: '90', category: 'storage', label: '文件保留天数', description: '临时上传文件超过 N 天未使用自动删除，调整后于下次清理周期生效', value_type: 'number', sort_order: 2 },
```
2. `PLACEHOLDER_SETTING_KEYS` 中删除 `'storage.retentionDays', // 暂无文件清理任务` 一行，并在顶部注释的「已接入功能」列表追加 `- storage.retentionDays → fileCleanupService 临时文件保留清理`。
3. 迁移中的 unhide SQL 改为：
```ts
    const wired = await runAsync(
      `UPDATE settings SET is_hidden = 0 WHERE key IN ('system.sessionTimeout', 'storage.uploadLimit', 'storage.retentionDays', 'security.rateLimit', 'security.corsOrigin') AND COALESCE(is_hidden, 0) = 1`
    );
```

- [ ] **Step 3: index.ts 启动调度**

在 `await settingsService.initCache();`（约 index.ts:283）之后追加：

```ts
import { startFileCleanupScheduler } from './services/fileCleanupService';
// ...
  startFileCleanupScheduler();
```

- [ ] **Step 4: 验证 + 提交**

Run: `cd smart-report-server && npx tsc --noEmit`
Expected: 无错误
Run: `git add -A && git commit -m "feat(files): 临时文件保留清理调度 + 开放文件保留天数设置"`

---

### Task 3: 报告生成 dedupRefs 接入（后端）

**Files:**
- Modify: `smart-report-server/src/routes/reports.ts:148-195`（generateReport handler）

**Interfaces:**
- Consumes: `fileDedupService.register / lookup / touch`
- 契约：前端按原索引上传非命中文件 `inputFile{i}`，命中文件不传文件、改传 `dedupRefs`（JSON，`{ "0": "<hash>" }`）；`inputHashes[i]` 与索引 i 对齐（两类文件都校验）。

- [ ] **Step 1: 改造 inputFiles 组装逻辑**

将 reports.ts 155-180 行的收集逻辑替换为：

```ts
      // 秒传引用：{ 索引: hash }，命中文件不上传、从去重存储解析
      const dedupRefs: Record<string, string> = body.dedupRefs ? JSON.parse(body.dedupRefs) : {};

      // 按索引合并「新上传文件」与「秒传引用文件」，保证与 inputHashes 严格对齐
      const byIndex = new Map<number, { filename: string; path: string; size: number }>();
      if (files) {
        for (const key of Object.keys(files)) {
          const m = /^inputFile(\d+)$/.exec(key);
          if (!m) continue;
          const f = files[key]?.[0];
          if (f) byIndex.set(parseInt(m[1], 10), { filename: f.originalname, path: f.path, size: f.size });
        }
      }
      const dedupIndexes: number[] = [];
      for (const [idxStr, hash] of Object.entries(dedupRefs)) {
        const idx = parseInt(idxStr, 10);
        if (!Number.isInteger(idx) || typeof hash !== 'string') continue;
        const entry = await fileDedupService.lookup(hash.toLowerCase());
        if (!entry) {
          res.status(400).json({ code: 400, data: null, message: `文件索引 ${idx} 的秒传引用已过期，请重新上传该文件` } satisfies ApiResponse<null>);
          return;
        }
        await fileDedupService.touch(hash.toLowerCase());
        byIndex.set(idx, { filename: entry.fileName, path: entry.path, size: entry.size });
        dedupIndexes.push(idx);
      }
      const inputFiles = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
```

- [ ] **Step 2: 生成成功后收编新上传文件**

在 SSE `onComplete` 回调中（`sendSSE('complete', data)` 之前）追加收编逻辑：

```ts
      const onComplete = (data: any) => {
        // 生成成功：把新上传的临时文件收编进内容寻址存储（失败不阻塞，留待散落清理）
        const uploadedPaths = [...byIndex.entries()]
          .filter(([idx]) => !dedupIndexes.includes(idx))
          .map(([, v]) => v);
        for (const f of uploadedPaths) {
          fileDedupService.register(f.path, f.filename, req.user!.userId)
            .catch((e) => log.warn(`输入文件收编失败: ${f.filename}: ${e?.message || e}`));
        }
        sendSSE('complete', data);
        safeEnd();
      };
```

同时在文件顶部 import 区追加：

```ts
import { fileDedupService } from '../services/fileDedupService';
```

（reports.ts 已有 log 对象；如无则使用 `getLogger('ReportRoutes', 'core')`。）

- [ ] **Step 3: 验证 + 提交**

Run: `cd smart-report-server && npx tsc --noEmit`
Expected: 无错误
Run: `git add -A && git commit -m "feat(reports): 报告生成支持秒传引用（dedupRefs）并收编输入文件"`

---

### Task 4: AI analyze-file 去重接入（后端）

**Files:**
- Modify: `smart-report-server/src/routes/ai.ts:307-330`（analyzeFile handler 开头）

**Interfaces:**
- Consumes: `fileDedupService.registerBuffer / lookup / touch`
- 契约：前端命中时不附文件，表单改传 `dedupHash`（64 位十六进制）。

- [ ] **Step 1: 改造 analyzeFile 文件来源**

将 `const file = req.file;` 与 `if (!file)` 校验之间的逻辑替换为：

```ts
      const file = req.file;
      const dedupHash = (((req.body as any)?.dedupHash as string) || '').toLowerCase();
      // ...
      // 文件内容来源：秒传引用（去重存储）或新上传 buffer
      let fileBuffer: Buffer;
      let fileName: string;
      if (dedupHash) {
        if (!/^[a-f0-9]{64}$/.test(dedupHash)) {
          res.status(400).json({ code: 400, data: null, message: '无效的秒传引用' } satisfies ApiResponse<null>);
          return;
        }
        const entry = await fileDedupService.lookup(dedupHash);
        if (!entry) {
          res.status(400).json({ code: 400, data: null, message: '文件已过期，请重新上传' } satisfies ApiResponse<null>);
          return;
        }
        await fileDedupService.touch(dedupHash);
        fileBuffer = await readFile(entry.path);
        fileName = entry.fileName;
      } else {
        if (!file) {
          res.status(400).json({ code: 400, data: null, message: '请上传巡检日志文件' } satisfies ApiResponse<null>);
          return;
        }
        fileBuffer = file.buffer;
        fileName = file.originalname;
        // 收编进内容寻址存储（失败不阻塞分析）
        fileDedupService.registerBuffer(file.buffer, file.originalname, req.user!.userId)
          .catch((e) => log.warn(`分析文件收编失败: ${e?.message || e}`));
      }
```

并将后面 `readAndConvertFile(file.buffer, file.originalname)` 改为 `readAndConvertFile(fileBuffer, fileName)`。
文件顶部 import 追加（`readFile` 已在 `fs/promises` 导入中，确认即可）：

```ts
import { fileDedupService } from '../services/fileDedupService';
```

- [ ] **Step 2: 验证 + 提交**

Run: `cd smart-report-server && npx tsc --noEmit`
Expected: 无错误
Run: `git add -A && git commit -m "feat(ai): 分析上传接入去重存储（dedupHash 秒传）"`

---

### Task 5: 前端 checkFileHashes 服务 + 报告创建秒传

**Files:**
- Modify: `smart-report-tool/src/services/api.ts`（追加 checkFileHashes；apiGenerateReport 支持 dedupIndices）
- Modify: `smart-report-tool/src/types/index.ts:187-207`（InputFileEntry 加 dedup 字段）
- Modify: `smart-report-tool/src/components/report/BatchFileUploader.tsx`（hash 完成后预检查 + 秒传徽标）
- Modify: `smart-report-tool/src/pages/ReportCreatePage.tsx:424-440`（传 dedupIndices）

**Interfaces:**
- Produces:
  - `checkFileHashes(hashes: string[]): Promise<Record<string, { fileName: string; size: number }>>`
  - `InputFileEntry.dedup?: boolean`（true = 已命中秒传，不上传）
  - `apiGenerateReport` params 新增可选 `dedupIndices?: number[]`（与 inputFiles/inputHashes 同索引）

- [ ] **Step 1: api.ts 追加 checkFileHashes + 改造 apiGenerateReport**

```ts
/**
 * 上传前 hash 预检查（秒传判定）：返回已存在于服务端去重存储的 hash → 文件信息
 */
export async function checkFileHashes(hashes: string[]): Promise<Record<string, { fileName: string; size: number }>> {
  try {
    const res = await fetchWithAuth(`${API_BASE}/files/check-hashes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.data?.existing || {};
  } catch {
    return {};
  }
}
```

apiGenerateReport params 增加 `dedupIndices?: number[];`，追加上传字段处改为：

```ts
  const dedupSet = new Set(params.dedupIndices ?? []);
  const dedupRefs: Record<number, string> = {};
  params.inputFiles.forEach((file, idx) => {
    if (dedupSet.has(idx)) {
      dedupRefs[idx] = params.inputHashes?.[idx] || '';
    } else {
      formData.append(`inputFile${idx}`, file);
    }
  });
  if (Object.keys(dedupRefs).length > 0) {
    formData.append('dedupRefs', JSON.stringify(dedupRefs));
  }
```

- [ ] **Step 2: InputFileEntry 加字段**

types/index.ts InputFileEntry 中 `hash?: string;` 之后追加：

```ts
  /** 命中服务端去重存储（秒传），生成时不上传、按 hash 引用 */
  dedup?: boolean;
```

- [ ] **Step 3: BatchFileUploader 预检查 + 徽标**

import 区追加 `import { checkFileHashes } from '@/services/api';`。
`computeFileHash(file).then(...)` 回调（约 :172-176）改为：

```ts
    computeFileHash(file).then((fileHash) => {
      if (!fileHash) return;
      updateFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, hash: fileHash } : f))
      );
      // 秒传预检查：服务端去重存储已有同内容文件则标记（压缩包不参）
      if (!isArchive) {
        checkFileHashes([fileHash]).then((existing) => {
          if (existing[fileHash]) {
            updateFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, dedup: true } : f))
            );
          }
        });
      }
    }).catch(() => {});
```

文件条目渲染处（文件名旁的 Badge 区）在 `status === 'done'` 徽标附近追加：

```tsx
              {f.dedup && (
                <Badge variant="secondary" className="text-[10px]">⚡秒传</Badge>
              )}
```

（具体插入点以实现时读到的渲染结构为准，保持现有样式风格。）

- [ ] **Step 4: ReportCreatePage 传 dedupIndices**

`generateReport({...})` 参数对象中追加：

```ts
        dedupIndices: doneInputFiles.map((f, i) => (f.dedup ? i : -1)).filter((i) => i >= 0),
```

（reportStore 的 generateReport 签名需同步透传：检查 `stores/reportStore.ts` 与 `services/api.ts` 之间是否有一层封装，有则一并透传 dedupIndices。）

- [ ] **Step 5: 验证 + 提交**

Run: `cd smart-report-tool && npx tsc --noEmit && npx vite build`
Expected: 无错误、构建成功
Run: `git add -A && git commit -m "feat(report): 报告创建支持秒传（hash 预检查 + dedupRefs）"`

---

### Task 6: 前端 AI 分析秒传 + 端到端验证

**Files:**
- Modify: `smart-report-tool/src/components/report/AIAnalysisPanel.tsx:104-120`（handleAnalyze）

**Interfaces:**
- Consumes: `checkFileHashes`（Task 5）、后端 `dedupHash` 契约（Task 4）

- [ ] **Step 1: handleAnalyze 增加秒传分支**

`const formData = new FormData();` 之前插入：

```ts
      // 秒传判定：完整计算文件 SHA-256，命中去重存储则不再上传
      let dedupHash = '';
      try {
        const buf = await selectedFile.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const existing = await checkFileHashes([hash]);
        if (existing[hash]) dedupHash = hash;
      } catch { /* 计算失败则走正常上传 */ }
```

formData 组装改为：

```ts
      const formData = new FormData();
      if (dedupHash) formData.append('dedupHash', dedupHash);
      else formData.append('file', selectedFile);
```

并在成功开始流式读取后提示：dedupHash 命中时 `toast.info('文件已存在，使用秒传模式');`（toast 已导入）。

- [ ] **Step 2: 前端验证 + 提交**

Run: `cd smart-report-tool && npx tsc --noEmit && npx vite build`
Expected: 无错误、构建成功
Run: `git add -A && git commit -m "feat(ai-analysis): AI 文件分析支持秒传"`

- [ ] **Step 3: 同步运行数据库 + 重启后端**

```bash
cd smart-report-server
python -c "
import sqlite3
conn = sqlite3.connect('data/smart-report.db', timeout=10)
conn.execute('''CREATE TABLE IF NOT EXISTS file_hashes (
  hash TEXT PRIMARY KEY, file_name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL, uploaded_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_used_at TEXT NOT NULL)''')
conn.execute(\"UPDATE settings SET is_hidden = 0, description = '临时上传文件超过 N 天未使用自动删除，调整后于下次清理周期生效' WHERE key = 'storage.retentionDays'\")
conn.commit()
print('done')
"
# 重启后端（netstat 找 PID → taskkill → cmd start /b npx tsx src/index.ts）
```

Expected: `/api/health` 200；启动 1 分钟后日志出现清理记录（现存 109 个残留文件按 90 天判定——mtime 均在近两周内不会被删，属预期；清理验证在 Step 5 做）。

- [ ] **Step 4: 浏览器实测秒传**

WebBridge 登录（admin/admin123）→ /report/create → AI 智能分析上传同一日志文件两次：
- 第一次：正常上传分析成功；
- 第二次：toast 提示「文件已存在，使用秒传模式」，请求体无文件字段（network 面板或后端日志验证 register 命中 deduped=true）。

- [ ] **Step 5: 清理逻辑实测**

```bash
# 构造一个 91 天前的散落文件，触发一次清理逻辑（直接调服务或等调度）
cd smart-report-server
python -c "
import os, time
p = 'data/uploads/test-stale-file.txt'
open(p, 'w').write('stale')
old = time.time() - 91 * 86400
os.utime(p, (old, old))
print('created stale file')
"
# 用 tsx 一次性执行清理：
export PATH="/c/Program Files/nodejs:$PATH"
npx tsx -e "import('./src/services/fileDedupService.ts').then(async m => { const r = await m.fileDedupService.cleanupStray(Date.now() - 90*86400000); console.log(r); })"
```

Expected: `{ deleted: 1, ... }`，test-stale-file.txt 被删；其余新文件不受影响。删除测试残留后提交。

---

## Self-Review 记录

- 规格覆盖：组件 1（CAS/索引）→ Task 1；组件 2（预检查端点）→ Task 1；组件 3（报告接入）→ Task 3 + 5；组件 4（AI 分析接入）→ Task 4 + 6；组件 5（清理 + 设置开放）→ Task 2。✅
- 类型一致性：`register/registerBuffer/lookup/touch/cleanupDedup/cleanupStray` 签名在 Tasks 1-4 一致；`dedupIndices/dedupRefs/dedupHash` 前后端契约一致（索引对齐、hash 小写 64 位）。✅
- 偏差说明：项目无测试框架，TDD 步骤以 tsc/build/curl/浏览器实测替代（Global Constraints 已注明）。
