# AI 支持包整包智能分析实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 智能分析能够真正分析服务器支持包（tar.gz/zip/tar/gz）：后端内存解压 + 三层优先级智能筛选关键文本日志，新增「整机支持包」类别，前端上传压缩包自动切换。

**Architecture:** 新增 `archiveAnalysisService`（npm tar + adm-zip 内存解压 → 文本判定 → P0/P1/P2 预算化筛选 → 结构化上下文）；analyze-file 在两条文件来源分支（新上传 / dedupHash 秒传）汇合后统一走压缩包检测分支；前后端各加 `support` 类别。

**Tech Stack:** Express + npm tar（已有依赖）+ adm-zip（新增，零原生依赖）；React + zustand。

## Global Constraints

- 设计规格：`smart-report-server/docs/superpowers/specs/2026-08-04-ai-archive-analysis-design.md`，本计划覆盖其全部组件。
- 项目无单元测试框架：验证以 tsx 脚本实测、`npx tsc --noEmit`、`npx vite build`、curl / 浏览器实测替代 TDD。
- Node 不在默认 PATH，node/npm/npx 命令前缀 `export PATH="/c/Program Files/nodejs:$PATH"`。
- 样本包：`samples/2288HV6_2106194YFAX3N9000003_20260507-0829.tar.gz`（工作区根，只读使用，不得修改）。
- 两仓库分别提交（`smart-report-server/`、`smart-report-tool/`），master 直接提交。
- 整包去重收编行为不变：`registerBuffer` 仍对整包 buffer 做 hash。

---

### Task 1: archiveAnalysisService（解压 + 智能筛选）

**Files:**
- Create: `smart-report-server/src/services/archiveAnalysisService.ts`
- Modify: `smart-report-server/package.json`（新增 adm-zip 依赖）

**Interfaces:**
- Produces（Task 2 依赖）:
  - `isArchiveFile(fileName: string, buffer?: Buffer): boolean`
  - `extractEntries(buffer: Buffer, fileName: string): Promise<ArchiveEntry[]>`
  - `smartSelect(entries: ArchiveEntry[]): { context: string; summary: SelectSummary }`
  - `ArchiveEntry = { path: string; size: number; text: string | null }`
  - `SelectSummary = { total: number; textFiles: number; selected: number; skippedBinary: number; skippedBudget: number }`

- [ ] **Step 1: 安装 adm-zip**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
cd smart-report-server && npm install adm-zip && npm install -D @types/adm-zip
```

Expected: package.json dependencies 出现 `adm-zip`，devDependencies 出现 `@types/adm-zip`

- [ ] **Step 2: 创建 archiveAnalysisService.ts**

```ts
/**
 * 支持包（压缩包）智能分析服务
 *
 * 内存解压 tar/tar.gz/tgz/gz/zip，按三层优先级规则挑选关键文本日志，
 * 在总文本预算内拼接成带文件路径标注的结构化上下文供 AI 分析。
 *
 * @module services/archiveAnalysisService
 */

import zlib from 'zlib';
import { Readable } from 'stream';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import { getLogger } from '../utils/logger';

const log = getLogger('ArchiveAnalysisService', 'core');

export interface ArchiveEntry {
  path: string;
  size: number;
  /** 文本内容；null 表示二进制或被安全限制跳过 */
  text: string | null;
}

export interface SelectSummary {
  total: number;
  textFiles: number;
  selected: number;
  skippedBinary: number;
  skippedBudget: number;
}

// ── 安全限制 ─────────────────────────────────
const MAX_ENTRIES = 2000;
const MAX_SINGLE_FILE = 32 * 1024 * 1024;   // 32MB
const MAX_TOTAL_EXTRACT = 200 * 1024 * 1024; // 200MB

// ── 筛选预算 ─────────────────────────────────
const TOTAL_BUDGET = 150 * 1024; // 总文本预算 150KB
const P0_FULL_LIMIT = 64 * 1024; // P0 全取上限
const P0_HEAD = 48 * 1024;       // P0 截断：头 48KB + 尾 16KB
const P0_TAIL = 16 * 1024;
const P1_TAIL = 32 * 1024;       // P1 取尾部 32KB（最新日志在末尾）
const P2_TAIL = 8 * 1024;        // P2 取尾部 8KB

const TEXT_EXTS = ['.txt', '.log', '.csv', '.json', '.xml', '.ini', '.cfg', '.conf',
  '.yaml', '.yml', '.md', '.html', '.htm', '.out', '.err', '.info', '.jsonl'];

const P0_RE = /(event|alarm|sel|diagnos|fault|fdm_log)/i;
const P1_RE = /(kernel|raid|storage|sensor|bmc|system|power|fan|temp|osdump|linux)/i;

/** 是否压缩包（扩展名 + 可选 magic bytes 双重判定） */
export function isArchiveFile(fileName: string, buffer?: Buffer): boolean {
  const lower = fileName.toLowerCase();
  const byName = /\.(zip|tar|gz|tgz)$/.test(lower);
  if (!buffer || buffer.length < 4) return byName;
  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isTar = buffer.length > 265 && buffer.subarray(257, 262).toString('ascii') === 'ustar';
  return byName || isGzip || isZip || isTar;
}

/** 路径安全校验：拒绝绝对路径与路径穿越 */
function isSafeEntryPath(p: string): boolean {
  if (!p || p.includes('\0')) return false;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:\//.test(norm)) return false;
  return !norm.split('/').includes('..');
}

/** 文本判定：扩展名白名单；扩展名未知时抽样前 8KB 检测 NUL 字节 */
function detectText(name: string, data: Buffer): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (TEXT_EXTS.includes(ext)) return true;
  const sample = data.subarray(0, Math.min(data.length, 8192));
  if (sample.includes(0)) return false;
  // 控制字符比例粗判
  let ctrl = 0;
  for (const b of sample) {
    if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  return ctrl / Math.max(sample.length, 1) < 0.05;
}

/** tar / tar.gz / tgz 流式解析（tar.Parser 自动识别 gzip） */
function parseTar(buffer: Buffer): Promise<{ path: string; size: number; data: Buffer }[]> {
  return new Promise((resolve, reject) => {
    const out: { path: string; size: number; data: Buffer }[] = [];
    let total = 0;
    let aborted = false;
    const parser = new tar.Parser({
      onentry: (entry) => {
        if (aborted) { entry.resume(); return; }
        if ((entry as any).type !== 'File') { entry.resume(); return; }
        const p = entry.path;
        const size = entry.size ?? 0;
        if (!isSafeEntryPath(p) || size > MAX_SINGLE_FILE || out.length >= MAX_ENTRIES) {
          entry.resume();
          return;
        }
        const chunks: Buffer[] = [];
        entry.on('data', (c: Buffer) => chunks.push(c));
        entry.on('end', () => {
          total += size;
          if (total > MAX_TOTAL_EXTRACT) { aborted = true; return; }
          out.push({ path: p, size, data: Buffer.concat(chunks) });
        });
      },
    });
    parser.on('end', () => resolve(out));
    parser.on('error', reject);
    Readable.from(buffer).pipe(parser);
  });
}

/** 解压为条目列表（含文本判定） */
export async function extractEntries(buffer: Buffer, fileName: string): Promise<ArchiveEntry[]> {
  const lower = fileName.toLowerCase();
  const raw: { path: string; size: number; data: Buffer }[] = [];

  if (/\.zip$/.test(lower) || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    // ZIP
    const zip = new AdmZip(buffer);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const p = e.entryName;
      const data = e.getData();
      if (!isSafeEntryPath(p) || data.length > MAX_SINGLE_FILE || raw.length >= MAX_ENTRIES) continue;
      raw.push({ path: p, size: data.length, data });
      if (raw.reduce((s, r) => s + r.size, 0) > MAX_TOTAL_EXTRACT) break;
    }
  } else if (/\.(tar\.gz|tgz|tar)$/.test(lower)
    || (buffer.length > 265 && buffer.subarray(257, 262).toString('ascii') === 'ustar')) {
    // TAR / TAR.GZ
    Object.assign(raw, await parseTar(buffer));
  } else if (/\.gz$/.test(lower) || (buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    // 单文件 GZ：先尝试按 tar.gz 解析，失败则当单文件
    try {
      Object.assign(raw, await parseTar(buffer));
    } catch { /* 非 tar.gz */ }
    if (raw.length === 0) {
      const inflated = zlib.gunzipSync(buffer);
      if (inflated.length <= MAX_SINGLE_FILE) {
        raw.push({ path: lower.replace(/\.gz$/, ''), size: inflated.length, data: inflated });
      }
    }
  } else {
    throw new Error('不支持的压缩格式（支持 zip / tar / tar.gz / tgz / gz）');
  }

  return raw.map((r) => ({
    path: r.path,
    size: r.size,
    text: detectText(r.path, r.data) ? r.data.toString('utf-8') : null,
  }));
}

/** 截断工具：取尾部 n 字节（按字符截，避免破坏 UTF-8 边界问题由 toString 处理） */
function tailOf(text: string, n: number): string {
  return text.length > n ? text.slice(text.length - n) : text;
}

/** 三层优先级智能筛选，预算内拼接结构化上下文 */
export function smartSelect(entries: ArchiveEntry[]): { context: string; summary: SelectSummary } {
  const textEntries = entries.filter((e) => e.text !== null);
  const summary: SelectSummary = {
    total: entries.length,
    textFiles: textEntries.length,
    selected: 0,
    skippedBinary: entries.length - textEntries.length,
    skippedBudget: 0,
  };

  const p0 = textEntries.filter((e) => P0_RE.test(e.path));
  const p1 = textEntries.filter((e) => !P0_RE.test(e.path) && P1_RE.test(e.path));
  const p2 = textEntries.filter((e) => !P0_RE.test(e.path) && !P1_RE.test(e.path));

  const parts: string[] = [];
  let used = 0;

  const take = (entry: ArchiveEntry, pick: (t: string) => string): boolean => {
    const body = pick(entry.text!);
    const block = `\n===== 文件: ${entry.path} (原始 ${entry.size} 字节) =====\n${body}\n`;
    if (used + block.length > TOTAL_BUDGET) { summary.skippedBudget++; return false; }
    parts.push(block);
    used += block.length;
    summary.selected++;
    return true;
  };

  for (const e of p0) {
    take(e, (t) => t.length <= P0_FULL_LIMIT
      ? t
      : `${t.slice(0, P0_HEAD)}\n...[中段省略 ${(t.length - P0_HEAD - P0_TAIL) / 1024 | 0}KB]...\n${tailOf(t, P0_TAIL)}`);
  }
  for (const e of p1) take(e, (t) => tailOf(t, P1_TAIL));
  for (const e of p2) take(e, (t) => tailOf(t, P2_TAIL));

  const header = `【支持包智能筛选摘要】包内共 ${summary.total} 个文件，其中文本文件 ${summary.textFiles} 个；` +
    `已挑选 ${summary.selected} 个关键文件用于分析（跳过二进制 ${summary.skippedBinary} 个` +
    `${summary.skippedBudget > 0 ? `，超出文本预算跳过 ${summary.skippedBudget} 个` : ''}）。` +
    `以下为按优先级挑选的文件内容：\n`;

  log.info(`支持包筛选: 共 ${summary.total} 文件, 文本 ${summary.textFiles}, 选中 ${summary.selected}, 预算跳过 ${summary.skippedBudget}`);
  return { context: header + parts.join(''), summary };
}
```

- [ ] **Step 3: 用样本包验证服务**

Create `smart-report-server/test-archive.ts`（临时文件，验证后删除）:

```ts
import { readFileSync } from 'fs';
import { extractEntries, smartSelect, isArchiveFile } from './src/services/archiveAnalysisService';

async function main() {
  const buf = readFileSync('../samples/2288HV6_2106194YFAX3N9000003_20260507-0829.tar.gz');
  console.log('isArchiveFile:', isArchiveFile('2288HV6_x.tar.gz', buf));
  const entries = await extractEntries(buf, '2288HV6_x.tar.gz');
  console.log('entries:', entries.length, 'text:', entries.filter(e => e.text !== null).length);
  const { context, summary } = smartSelect(entries);
  console.log('summary:', JSON.stringify(summary));
  console.log('context length:', context.length);
  const hasEvent = context.includes('current_event.txt');
  const hasDisk = context.includes('DISK0');
  console.log('contains current_event.txt:', hasEvent, '| contains DISK0 alarm:', hasDisk);
  if (!hasEvent || !hasDisk) { console.error('FAIL: 关键告警文件未被选中'); process.exit(1); }
  console.log('PASS');
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
```

Run: `cd smart-report-server && export PATH="/c/Program Files/nodejs:$PATH" && npx tsx test-archive.ts`
Expected: `isArchiveFile: true`；entries 约 500+；`contains DISK0 alarm: true`；`PASS`；context length ≤ 约 160KB

- [ ] **Step 4: tsc + 删除临时脚本 + 提交**

```bash
cd smart-report-server && npx tsc --noEmit && rm test-archive.ts
git add -A && git commit -m "feat(ai): 支持包内存解压与三层优先级智能筛选服务"
```

---

### Task 2: 后端 analyze-file 接入 + 「整机支持包」类别

**Files:**
- Modify: `smart-report-server/src/services/aiPrompts.ts`（CATEGORY_LABELS + ANALYSIS_PROMPTS 加 support）
- Modify: `smart-report-server/src/routes/ai.ts:76`（multer 上限 50MB）与 analyzeFile 内容来源分支（约 :355）

**Interfaces:**
- Consumes: `isArchiveFile / extractEntries / smartSelect`（Task 1）
- Produces: 类别 `support` 对前后端生效（Task 3 前端同步）

- [ ] **Step 1: aiPrompts.ts 加 support 类别**

`ANALYSIS_PROMPTS` 中 `database` 条目之后（`other` 之前任意位置）追加：

```ts
  support: `${COMMON_REQUIREMENTS}

## 整机支持包专项要求
输入为服务器支持包（如 BMC 一键收集包）经智能筛选后的关键文件合集，每个文件以「===== 文件: 路径 =====」分隔。

- 输出格式：先列出【故障告警摘要】（按严重程度排序：严重 → 警告 → 信息），再列出【整机健康概览】，最后给出【处理建议】
- 故障告警摘要：每条包含时间、告警级别、部件（如磁盘/RAID/电源/风扇/温度传感器）、问题描述、所在文件
- 整机健康概览，按以下维度归纳：
  - 硬件部件：磁盘、RAID 卡与逻辑盘、内存、CPU、电源、风扇
  - 传感器：温度/电压/功耗是否越限
  - 系统事件：SEL/事件日志中的反复出现或近期的关键事件
  - 固件与配置：固件异常、配置错误、服务异常
- 处理建议：针对每条故障给出可执行的处置动作（如更换磁盘、检查背板、固件升级）
- 注意区分「当前活动告警」与「历史已恢复事件」，历史事件只需概述`,
```

`CATEGORY_LABELS` 中追加（`other` 之前）：

```ts
  support: '整机支持包',
```

- [ ] **Step 2: ai.ts multer 上限放宽**

`src/routes/ai.ts:76` 行：

```ts
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
```

- [ ] **Step 3: analyzeFile 接入压缩包分支**

import 区追加：

```ts
import { isArchiveFile, extractEntries, smartSelect } from '../services/archiveAnalysisService';
```

将 `const content = await readAndConvertFile(fileBuffer, fileName);`（约 :355）替换为：

```ts
      // 读取文件内容：压缩包走解压+智能筛选，普通文件走文本/CLI 转换
      let content: string;
      if (isArchiveFile(fileName, fileBuffer)) {
        let entries;
        try {
          entries = await extractEntries(fileBuffer, fileName);
        } catch (e: any) {
          res.status(400).json({ code: 400, data: null, message: `压缩包解压失败: ${e?.message || e}` } satisfies ApiResponse<null>);
          return;
        }
        const { context, summary } = smartSelect(entries);
        if (summary.selected === 0) {
          res.status(400).json({ code: 400, data: null, message: '压缩包内未找到可分析的文本日志' } satisfies ApiResponse<null>);
          return;
        }
        content = context;
      } else {
        content = await readAndConvertFile(fileBuffer, fileName);
      }
```

- [ ] **Step 4: tsc + 提交**

```bash
cd smart-report-server && npx tsc --noEmit
git add -A && git commit -m "feat(ai): analyze-file 接入支持包整包分析 + 新增整机支持包类别"
```

---

### Task 3: 前端类别 + 自动切换 + 限制放宽

**Files:**
- Modify: `smart-report-tool/src/components/report/AIAnalysisPanel.tsx`（CATEGORIES、handleFileChange、徽标）
- Modify: `smart-report-tool/src/constants/analysisPrompts.ts`（DEFAULT_PROMPTS 加 support）

**Interfaces:**
- Consumes: 后端 `support` 类别（Task 2）
- Produces: 无（最终 UI 行为）

- [ ] **Step 1: DEFAULT_PROMPTS 加 support**

`src/constants/analysisPrompts.ts` 中 `DEFAULT_PROMPTS` 的 `database` 条目之后追加（与后端 Task 2 Step 1 的 support 提示词文本完全一致）。

- [ ] **Step 2: CATEGORIES 加条目**

`AIAnalysisPanel.tsx` 的 `CATEGORIES` 数组（约 :30）在 `{ key: 'other', label: '其他' }` 之前追加：

```ts
  { key: 'support', label: '整机支持包' },
```

- [ ] **Step 3: handleFileChange 放宽 50MB + 压缩包自动切换类别**

将（约 :97-102）：

```ts
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) { toast.error('文件不能超过 10MB'); return; }
      setSelectedFile(file); setResult(null); setStreamingText(''); setError(null);
    }
  };
```

替换为：

```ts
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { toast.error('文件不能超过 50MB'); return; }
      setSelectedFile(file); setResult(null); setStreamingText(''); setError(null);
      // 压缩包：自动切到整机支持包类别，走整包智能分析
      if (/\.(zip|tar|gz|tgz)$/i.test(file.name)) {
        setCategory('support');
        toast.info('检测到压缩包，将自动提取包内关键日志进行整体分析');
      }
    }
  };
```

- [ ] **Step 4: 文件名旁加「整包智能分析」徽标**

文件名展示处（约 :345，压缩包显示 Archive 图标的同一行）在图标后追加：

```tsx
                 {selectedFile.name.match(/\.(zip|tar|gz|tgz)$/i) && (
                   <Badge variant="secondary" className="text-[10px]">整包智能分析</Badge>
                 )}
```

（具体插入点以实现时读到的渲染结构为准，保持现有样式风格。）

- [ ] **Step 5: 验证 + 提交**

```bash
cd smart-report-tool && npx tsc --noEmit && npx vite build
git add -A && git commit -m "feat(ai-analysis): 整机支持包类别 + 压缩包自动切换 + 50MB 上限"
```

---

### Task 4: 端到端实测

**Files:**
- 无代码改动（实测 + 清理）

- [ ] **Step 1: 重启后端**

```bash
netstat -ano | grep ":3001" | grep LISTEN   # 找 PID
taskkill //PID <pid> //F
cd smart-report-server && export PATH="/c/Program Files/nodejs:$PATH" && cmd.exe //c "start /b npx tsx src/index.ts > server-restart.log 2>&1"
sleep 12 && curl.exe -s http://localhost:3001/api/health
```

Expected: `{"code":200,...}`

- [ ] **Step 2: curl 实测样本包分析**

```bash
cd smart-report-server
curl.exe -s -c t-cookies.txt -X POST http://localhost:3001/api/users/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin123\"}"
curl.exe -s -b t-cookies.txt -X POST http://localhost:3001/api/ai/analyze-file -F "file=@../samples/2288HV6_2106194YFAX3N9000003_20260507-0829.tar.gz" -F "category=support" --max-time 180 -o t-analyze.out -w "HTTP=%{http_code}"
```

Expected: `HTTP=200`，t-analyze.out 为 SSE 流，内容包含 DISK0 / RAID / 降级等告警关键词（`grep -a "DISK0\|RAID\|降级" t-analyze.out | head -3` 有输出）
同时验证收编：`SELECT COUNT(*) FROM file_hashes` ≥ 1 且文件名为样本包名

- [ ] **Step 3: 秒传兼容实测**

同一文件再传一次前先取 hash，check-hashes 应命中；再用纯 dedupHash 调 analyze-file：

```bash
HASH=$(python -c "import hashlib; print(hashlib.sha256(open('../samples/2288HV6_2106194YFAX3N9000003_20260507-0829.tar.gz','rb').read()).hexdigest())")
curl.exe -s -b t-cookies.txt -X POST http://localhost:3001/api/files/check-hashes -H "Content-Type: application/json" -d "{\"hashes\":[\"$HASH\"]}"
curl.exe -s -b t-cookies.txt -X POST http://localhost:3001/api/ai/analyze-file -F "dedupHash=$HASH" -F "category=support" --max-time 180 -o t-analyze2.out -w "HTTP=%{http_code}"
```

Expected: check-hashes 返回 existing 命中；第二次 `HTTP=200`，流内容同样含告警关键词

- [ ] **Step 4: 浏览器冒烟**

WebBridge 打开 http://localhost:5173/report/create（必要时重新登录）→ 已登录态切到 AI 模式 → evaluate 注入样本文件不可行（浏览器无法读本地文件），改为验证 UI：上传控件旁 50MB 文案与「整机支持包」类别存在：

```json
{"action":"evaluate","code":"(() => { const tabs = [...document.querySelectorAll('[role=tab], button')].map(t=>t.textContent.trim()); return JSON.stringify({hasSupport: tabs.some(t=>t.includes('整机支持包'))}); })()"}
```

Expected: `hasSupport: true`

- [ ] **Step 5: 清理测试残留**

```bash
cd smart-report-server && rm -f t-cookies.txt t-analyze.out t-analyze2.out .webbridge-cmd.json
python -c "
import sqlite3, os
conn = sqlite3.connect('data/smart-report.db', timeout=10)
for row in conn.execute('SELECT path FROM file_hashes').fetchall():
    p = os.path.join('data/uploads', row[0])
    if os.path.exists(p): os.remove(p)
conn.execute('DELETE FROM file_hashes'); conn.commit(); print('cleared')
"
git status --short  # 应干净
```

---

## Self-Review 记录

- 规格覆盖：组件 1（archiveAnalysisService）→ Task 1；组件 2（analyze-file 接入 + 50MB）→ Task 2；组件 3（support 类别前后端）→ Task 2 + 3；组件 4（前端限制/UI）→ Task 3；组件 5（错误处理）→ Task 1 Step 2（抛错）+ Task 2 Step 3（400 分支）；组件 6（测试）→ Task 4。✅
- 类型一致性：`isArchiveFile/extractEntries/smartSelect/ArchiveEntry/SelectSummary` 在 Task 1 定义、Task 2 消费签名一致；`support` 类别 key 前后端一致。✅
- 偏差说明：项目无测试框架，TDD 步骤以 tsx 实测脚本 + curl/浏览器实测替代（Global Constraints 已注明）。
