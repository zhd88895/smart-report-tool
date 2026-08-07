/**
 * 模型上限探测服务：通过实际调用逐步试出模型的真实输入/输出上限。
 *
 * 原理：
 * - 输入上限：先用一次小请求读取 usage.prompt_tokens 校准「字符/token」比例，
 *   再按比例生成精确大小的填充文本，从当前配置值开始倍增进阶，
 *   触发上下文错误后二分逼近；同时解析错误信息中厂商给出的真实上限数值。
 * - 输出上限：用极小 prompt 携带候选 max_tokens 参数探测厂商是否做参数校验，
 *   校验则二分出最大可接受值；不校验则报告「厂商未校验，以官方文档为准」。
 *
 * 注意：探测会真实消耗 API 额度（输入探测最坏约 2~3 倍目标上下文的 token）。
 * 任务在内存中异步执行，前端轮询进度；服务重启后任务记录丢失（结果无持久化）。
 *
 * @module services/modelLimitProbeService
 */

import { getLogger } from '../utils/logger';
import {
  resolveConfig,
  OUTPUT_TOKEN_CEILING,
  type ResolvedConfig,
} from './aiProviderService';

const log = getLogger('ModelLimitProbe', 'core');

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

export interface ProbeStep {
  time: string;
  message: string;
}

export interface ProbeResult {
  /** 实测输入（上下文）上限；探测失败为 null */
  maxInputTokens: number | null;
  /** 实测输出上限；厂商未校验参数时为 null */
  maxOutputTokens: number | null;
  /** true 表示输出上限是「厂商接受的最大参数值」，不代表模型真实生成能力 */
  outputIsParamLimit: boolean;
  notes: string[];
}

export interface ProbeJob {
  id: string;
  userId: string;
  modelId: string;
  modelName: string;
  status: 'running' | 'done' | 'error';
  steps: ProbeStep[];
  result: ProbeResult | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 单次探测请求的结果分类 */
type ProbeAttempt =
  | { kind: 'ok'; promptTokens?: number }
  | { kind: 'context_error'; errorText: string }
  | { kind: 'param_error'; errorText: string }
  | { kind: 'fatal'; errorText: string };

// ═══════════════════════════════════════════════════════
//  任务注册表（内存）
// ═══════════════════════════════════════════════════════

const jobs = new Map<string, ProbeJob>();
let jobSeq = 0;

/** 输入探测的绝对天花板：1M token（超出这个量级厂商侧一般也不支持） */
const INPUT_PROBE_CAP = 1048576;
/** 二分收敛精度：上下限差距小于该值即停止 */
const INPUT_PROBE_TOLERANCE = 8192;
/** 单请求超时：大上下文 prefill 可能很慢 */
const REQUEST_TIMEOUT_MS = 300000;
/** 填充文本单元（中英文混合，避免极端分词特例） */
const FILLER_UNIT = '日志分析上限探针填充内容 The quick brown fox jumps over the lazy dog. ';

function genJobId(): string {
  jobSeq += 1;
  return `probe_${Date.now().toString(36)}_${jobSeq}`;
}

function addStep(job: ProbeJob, message: string): void {
  job.steps.push({ time: new Date().toISOString(), message });
  log.info(`[${job.id}] ${message}`);
}

// ═══════════════════════════════════════════════════════
//  探测请求
// ═══════════════════════════════════════════════════════

const CONTEXT_ERROR_RE = /context|too long|too many tokens|length|超出|上下文|长度|token.*(limit|exceed|超过)/i;
const OUTPUT_PARAM_ERROR_RE = /max_?tokens|max_completion_tokens|output.*(limit|exceed|too (large|long))|输出/i;

/** 从厂商错误信息中尽力提取真实上限数值（如 "maximum context length is 1048576"） */
function extractLimitFromError(errorText: string): number | null {
  const patterns = [
    /(?:maximum context length is|context (?:window|length|limit)[^\d]{0,20})(\d{4,})/i,
    /(?:max(?:imum)?[^\d]{0,30})(\d{5,})\s*tokens?/i,
    /(?:上限|最大|长度)[^\d]{0,10}(\d{4,})/,
  ];
  for (const re of patterns) {
    const m = errorText.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1000 && n <= 10_000_000) return n;
    }
  }
  return null;
}

/**
 * 发送一次探测请求。
 * @param inputText 输入内容（输入探测用大填充文本，输出探测用 'Hi'）
 * @param maxOutput 输出参数值
 */
async function sendProbe(
  cfg: ResolvedConfig,
  inputText: string,
  maxOutput: number
): Promise<ProbeAttempt> {
  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [cfg.quirks.authHeader]: `${cfg.quirks.authPrefix}${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: inputText }],
        [cfg.quirks.tokenParam]: maxOutput,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('timed out') || (e as any)?.name === 'TimeoutError') {
      return { kind: 'fatal', errorText: '请求超时（300s）' };
    }
    return { kind: 'fatal', errorText: msg || '网络请求失败' };
  }

  if (response.ok) {
    const data = (await response.json().catch(() => null)) as any;
    return { kind: 'ok', promptTokens: data?.usage?.prompt_tokens };
  }

  const errorText = await response.text().catch(() => '');
  if (response.status === 401) return { kind: 'fatal', errorText: 'API Key 无效或已过期' };
  if (response.status === 429) return { kind: 'fatal', errorText: '请求频率过高（429），请稍后再试' };

  if (response.status === 400 || response.status === 413 || response.status === 422) {
    if (CONTEXT_ERROR_RE.test(errorText)) return { kind: 'context_error', errorText };
    if (OUTPUT_PARAM_ERROR_RE.test(errorText)) return { kind: 'param_error', errorText };
    // 无法归类的 4xx：输出参数探测时保守按参数错误处理，输入探测按上下文错误处理
    return { kind: 'context_error', errorText };
  }
  return { kind: 'fatal', errorText: `API 返回错误 (${response.status}): ${errorText.slice(0, 200)}` };
}

// ═══════════════════════════════════════════════════════
//  输入上限探测
// ═══════════════════════════════════════════════════════

async function probeInputLimit(
  job: ProbeJob,
  cfg: ResolvedConfig,
  notes: string[]
): Promise<number | null> {
  // 第 1 步：校准字符/token 比例（用厂商返回的 usage.prompt_tokens 实测，避免估算误差）
  addStep(job, '第 1 步：校准字符/token 比例…');
  const calText = FILLER_UNIT.repeat(Math.ceil(20000 / FILLER_UNIT.length));
  const cal = await sendProbe(cfg, calText, 16);
  if (cal.kind === 'fatal') throw new Error(`校准请求失败：${cal.errorText}`);
  if (cal.kind !== 'ok') throw new Error(`校准请求被拒绝：${cal.errorText.slice(0, 150)}`);
  // 减去少量系统开销（消息包装约 10 token）
  const overhead = 16;
  const charsPerToken = cal.promptTokens && cal.promptTokens > overhead
    ? calText.length / (cal.promptTokens - overhead)
    : 2;
  addStep(job, `校准完成：${cal.promptTokens ?? '?'} token / ${calText.length} 字符 ≈ ${charsPerToken.toFixed(2)} 字符/token`);

  const buildText = (tokens: number) =>
    FILLER_UNIT.repeat(Math.ceil((tokens * charsPerToken) / FILLER_UNIT.length));

  // 第 2 步：从当前配置值开始倍增进阶，直到触发上下文错误或到达探测天花板
  addStep(job, '第 2 步：从当前配置值开始倍增进阶探测…');
  let lo = 0;   // 已验证可用
  let hi = -1;  // 已验证超限（-1 表示尚未触顶）
  let candidate = Math.min(cfg.maxInputTokens, INPUT_PROBE_CAP);

  while (candidate <= INPUT_PROBE_CAP) {
    addStep(job, `尝试输入 ≈ ${candidate.toLocaleString()} token…`);
    const attempt = await sendProbe(cfg, buildText(candidate), 16);
    if (attempt.kind === 'ok') {
      lo = candidate;
      addStep(job, `✓ ${candidate.toLocaleString()} token 可用`);
      if (candidate >= INPUT_PROBE_CAP) break;
      candidate = Math.min(candidate * 2, INPUT_PROBE_CAP);
      continue;
    }
    if (attempt.kind === 'fatal') throw new Error(attempt.errorText);
    // 上下文超限：先尝试从错误信息解析厂商给出的真实上限
    const realLimit = extractLimitFromError(attempt.errorText);
    addStep(job, `✗ ${candidate.toLocaleString()} token 超限：${attempt.errorText.slice(0, 120)}`);
    if (realLimit && realLimit < candidate) {
      notes.push(`厂商错误信息中给出了真实上限 ${realLimit.toLocaleString()}，直接采用`);
      // 用真实上限验证一次（若刚好等于已验证值则跳过）
      if (realLimit > lo) {
        addStep(job, `验证厂商给出的上限 ${realLimit.toLocaleString()}…`);
        const verify = await sendProbe(cfg, buildText(realLimit), 16);
        if (verify.kind === 'ok') {
          addStep(job, `✓ ${realLimit.toLocaleString()} token 验证通过`);
          return realLimit;
        }
        // 验证失败（可能厂商数值含输出预留），二分继续
        hi = realLimit;
      } else {
        return lo > 0 ? lo : realLimit;
      }
    } else {
      hi = candidate;
    }
    break;
  }

  if (lo >= INPUT_PROBE_CAP || (lo > 0 && hi === -1)) {
    notes.push(`已探测到天花板 ${INPUT_PROBE_CAP.toLocaleString()} 仍未超限，真实上限可能更高`);
    return lo;
  }
  if (hi === -1 || lo === 0) return lo > 0 ? lo : null;

  // 第 3 步：二分逼近
  addStep(job, `第 3 步：在 ${lo.toLocaleString()} ~ ${hi.toLocaleString()} 之间二分逼近…`);
  while (hi - lo > INPUT_PROBE_TOLERANCE) {
    const mid = Math.floor((lo + hi) / 2);
    const attempt = await sendProbe(cfg, buildText(mid), 16);
    if (attempt.kind === 'ok') {
      lo = mid;
      addStep(job, `✓ ${mid.toLocaleString()} token 可用`);
    } else if (attempt.kind === 'fatal') {
      throw new Error(attempt.errorText);
    } else {
      hi = mid;
      addStep(job, `✗ ${mid.toLocaleString()} token 超限`);
    }
  }
  return lo;
}

// ═══════════════════════════════════════════════════════
//  输出上限探测
// ═══════════════════════════════════════════════════════

async function probeOutputLimit(
  job: ProbeJob,
  cfg: ResolvedConfig,
  notes: string[]
): Promise<{ value: number | null; isParamLimit: boolean }> {
  addStep(job, '输出探测：检查厂商是否校验输出参数…');

  // 先用天花板试：接受说明厂商不校验（或上限确实这么高）
  const first = await sendProbe(cfg, 'Hi', OUTPUT_TOKEN_CEILING);
  if (first.kind === 'ok') {
    notes.push(`厂商未校验输出参数，接受至 ${OUTPUT_TOKEN_CEILING.toLocaleString()}；真实生成上限请以官方文档为准`);
    return { value: null, isParamLimit: false };
  }
  if (first.kind === 'fatal') throw new Error(first.errorText);
  if (first.kind === 'context_error') {
    notes.push('厂商对输出参数的报错无法归类，跳过输出探测');
    return { value: null, isParamLimit: false };
  }
  // 从错误信息解析真实输出上限
  const realLimit = extractLimitFromError(first.errorText);
  if (realLimit) {
    addStep(job, `厂商错误信息给出输出上限 ${realLimit.toLocaleString()}，验证中…`);
    const verify = await sendProbe(cfg, 'Hi', realLimit);
    if (verify.kind === 'ok') {
      addStep(job, `✓ 输出上限 ${realLimit.toLocaleString()} 验证通过`);
      return { value: realLimit, isParamLimit: true };
    }
  }

  // 二分最大可接受的输出参数（小请求，速度快）
  addStep(job, '二分探测最大可接受的输出参数…');
  let lo = 16, hi = OUTPUT_TOKEN_CEILING;
  while (hi - lo > 1024) {
    const mid = Math.floor((lo + hi) / 2);
    const attempt = await sendProbe(cfg, 'Hi', mid);
    if (attempt.kind === 'ok') lo = mid;
    else if (attempt.kind === 'fatal') throw new Error(attempt.errorText);
    else if (attempt.kind === 'context_error') { notes.push('输出探测报错无法归类，中止'); return { value: null, isParamLimit: false }; }
    else hi = mid;
  }
  addStep(job, `✓ 最大可接受输出参数 ≈ ${lo.toLocaleString()}`);
  return { value: lo, isParamLimit: true };
}

// ═══════════════════════════════════════════════════════
//  任务入口
// ═══════════════════════════════════════════════════════

async function runProbe(job: ProbeJob): Promise<void> {
  const notes: string[] = [];
  const result: ProbeResult = {
    maxInputTokens: null,
    maxOutputTokens: null,
    outputIsParamLimit: false,
    notes,
  };
  try {
    const cfg = await resolveConfig(job.userId, job.modelId);
    addStep(job, `开始探测 ${cfg.providerName} / ${cfg.model}（当前配置：输入 ${cfg.maxInputTokens.toLocaleString()} / 输出 ${cfg.maxOutputTokens.toLocaleString()}）`);

    result.maxInputTokens = await probeInputLimit(job, cfg, notes);
    const out = await probeOutputLimit(job, cfg, notes);
    result.maxOutputTokens = out.value;
    result.outputIsParamLimit = out.isParamLimit;

    if (result.maxInputTokens != null && result.maxInputTokens < cfg.maxInputTokens) {
      notes.push(`实测输入上限低于当前配置值 ${cfg.maxInputTokens.toLocaleString()}，建议下调以避免请求被拒`);
    }
    job.result = result;
    job.status = 'done';
    addStep(job, '探测完成');
  } catch (e) {
    job.status = 'error';
    job.error = (e as Error).message || '探测失败';
    job.result = result.maxInputTokens != null || result.maxOutputTokens != null ? result : null;
    addStep(job, `探测中止：${job.error}`);
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

/**
 * 启动一次模型上限探测（异步执行，立即返回任务 ID）。
 */
export function startLimitProbe(userId: string, modelDbId: string, modelName: string): ProbeJob {
  // 同一用户同一模型已有运行中的任务时直接复用，避免重复消耗额度
  for (const j of jobs.values()) {
    if (j.userId === userId && j.modelId === modelDbId && j.status === 'running') return j;
  }
  const job: ProbeJob = {
    id: genJobId(),
    userId,
    modelId: modelDbId,
    modelName,
    status: 'running',
    steps: [],
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  // 保留最近 50 个任务，防内存膨胀
  if (jobs.size > 50) {
    const oldest = [...jobs.values()]
      .filter((j) => j.status !== 'running')
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (oldest) jobs.delete(oldest.id);
  }
  void runProbe(job);
  return job;
}

/** 查询探测任务（限定 user_id 保证隔离） */
export function getLimitProbeJob(userId: string, jobId: string): ProbeJob | null {
  const job = jobs.get(jobId);
  return job && job.userId === userId ? job : null;
}
