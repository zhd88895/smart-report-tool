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

/** 文本判定：扩展名白名单；扩展名未知时抽样前 8KB 检测 NUL 字节与控制字符比例 */
function detectText(name: string, data: Buffer): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (TEXT_EXTS.includes(ext)) return true;
  const sample = data.subarray(0, Math.min(data.length, 8192));
  if (sample.includes(0)) return false;
  let ctrl = 0;
  for (const b of sample) {
    if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  return ctrl / Math.max(sample.length, 1) < 0.05;
}

/** tar / tar.gz / tgz 流式解析（gzip 数据先解压再走 tar.t 列表解析器） */
function parseTar(buffer: Buffer): Promise<{ path: string; size: number; data: Buffer }[]> {
  return new Promise((resolve, reject) => {
    let input = buffer;
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      try {
        input = zlib.gunzipSync(buffer);
      } catch (e) {
        reject(e);
        return;
      }
    }
    const out: { path: string; size: number; data: Buffer }[] = [];
    let total = 0;
    let aborted = false;
    const lister = tar.t({
      onentry: (entry: any) => {
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
    } as any);
    (lister as any).on('end', () => resolve(out));
    (lister as any).on('error', reject);
    Readable.from(input).pipe(lister as any);
  });
}

/** 解压为条目列表（含文本判定） */
export async function extractEntries(buffer: Buffer, fileName: string): Promise<ArchiveEntry[]> {
  const lower = fileName.toLowerCase();
  const raw: { path: string; size: number; data: Buffer }[] = [];

  if (/\.zip$/.test(lower) || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    // ZIP
    const zip = new AdmZip(buffer);
    let total = 0;
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const p = e.entryName;
      const data = e.getData();
      if (!isSafeEntryPath(p) || data.length > MAX_SINGLE_FILE || raw.length >= MAX_ENTRIES) continue;
      raw.push({ path: p, size: data.length, data });
      total += data.length;
      if (total > MAX_TOTAL_EXTRACT) break;
    }
  } else if (/\.(tar\.gz|tgz|tar)$/.test(lower)
    || (buffer.length > 265 && buffer.subarray(257, 262).toString('ascii') === 'ustar')) {
    // TAR / TAR.GZ
    raw.push(...await parseTar(buffer));
  } else if (/\.gz$/.test(lower) || (buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    // 单文件 GZ：先尝试按 tar.gz 解析，失败则当单文件
    try {
      raw.push(...await parseTar(buffer));
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

/** 截断工具：取尾部 n 个字符 */
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
      : `${t.slice(0, P0_HEAD)}\n...[中段省略 ${((t.length - P0_HEAD - P0_TAIL) / 1024) | 0}KB]...\n${tailOf(t, P0_TAIL)}`);
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
