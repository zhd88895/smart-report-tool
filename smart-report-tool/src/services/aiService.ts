import { AIIntent, ConversationMessage } from '@/types';
import { getApiUrl } from './api';
import { useAIConfigStore } from '@/stores/aiConfigStore';

/** 检测 X-AI-Fallback 响应头：后端走 .env 系统默认兜底时点亮共享提示条 */
function detectFallbackHeader(res: Response): void {
  if (res.headers.get('X-AI-Fallback') === 'true') {
    useAIConfigStore.getState().setFallbackNotice(true);
  }
}

/** 工具调用轨迹记录（后端 runToolLoop 返回的 toolsUsed） */
export interface ToolCallRecord {
  name: string;
  ok: boolean;
  summary: string;
}

/** 待确认工具信息（后端 pendingConfirm 字段） */
export interface PendingConfirm {
  pendingId: string;
  tool: string;
  argsSummary: string;
}

/** 发送消息的统一返回（enableTools 时可能带工具轨迹与待确认信息） */
export interface SendMessageResult {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolCalls?: ToolCallRecord[];
  pendingConfirm?: PendingConfirm;
}

/** 发送消息的可选参数：enableTools 开启后端工具调用循环 */
export interface SendMessageOptions {
  enableTools?: boolean;
}

/** 把后端 /ai/chat(+stream 降级) 的 JSON 响应体规整为 SendMessageResult */
function parseChatJson(data: any): SendMessageResult {
  const d = data?.data ?? {};
  return {
    content: d.message || '',
    usage: d.usage,
    toolCalls: Array.isArray(d.toolsUsed) ? d.toolsUsed : undefined,
    pendingConfirm: d.pendingConfirm ?? undefined,
  };
}

export const recognizeIntent = detectIntent;

export function detectIntent(message: string): AIIntent {
  const lower = message.toLowerCase();
  if (/报告|查找|搜索|查询|列表/.test(lower)) return 'query_report';
  if (/分析|解读|性能|问题|故障|诊断/.test(lower)) return 'analyze_data';
  return 'general';
}

export async function checkAIStatus(): Promise<{ configured: boolean }> {
  const url = getApiUrl('/ai/status');
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('无法检查 AI 配置状态');
  const data = await res.json();
  return data.data || { configured: false };
}

export async function sendMessage(
  message: string,
  history: ConversationMessage[],
  modelId?: string,
  opts?: SendMessageOptions
): Promise<SendMessageResult> {
  const url = getApiUrl('/ai/chat');
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages, modelId, enableTools: opts?.enableTools }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || 'AI 服务暂不可用');
  }
  detectFallbackHeader(res);
  // 后端 POST /api/ai/chat 返回 data.message（见 routes/ai.ts 的 callUserAI/runToolLoop 结果）
  return parseChatJson(await res.json());
}

export async function sendMessageStream(
  message: string,
  history: ConversationMessage[],
  onChunk: (text: string) => void,
  modelId?: string,
  opts?: SendMessageOptions
): Promise<SendMessageResult> {
  const url = getApiUrl('/ai/chat/stream');
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages, modelId, enableTools: opts?.enableTools }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || 'AI 服务暂不可用');
  }
  detectFallbackHeader(res);

  // 工具模式已支持真实流式（后端 SSE：choices delta 增量 + tool_call/final 事件）。
  // X-AI-Tools-NonStream 旧降级分支保留以兼容未升级的后端
  if (res.headers.get('X-AI-Tools-NonStream') === 'true') {
    const result = parseChatJson(await res.json());
    if (result.content) onChunk(result.content);
    return result;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('不支持流式响应');
  const decoder = new TextDecoder();
  let fullText = '';
  // 工具模式的完整结果（final 事件携带）与逐条工具轨迹（tool_call 事件）
  interface StreamFinalData {
    message?: string;
    usage?: SendMessageResult['usage'];
    toolsUsed?: ToolCallRecord[];
    pendingConfirm?: PendingConfirm;
  }
  // 用对象持有避免 TS 闭包窄化（handleLine 内赋值在 return 处被推断为 never）
  const streamState: { finalData: StreamFinalData | null } = { finalData: null };
  const toolCalls: ToolCallRecord[] = [];
  // 跨 read 循环的行缓冲：TCP 分片可能把一条 data: 行切断，
  // 只处理以 \n 结尾的完整行，不完整部分留给下一轮拼接
  let buffer = '';
  /** 解析一行 SSE 数据（忽略空行 / [DONE] / 非 data 行） */
  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('data: ')) {
      const dataPart = trimmed.slice(6);
      if (dataPart === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataPart);
        // 工具模式自定义事件
        if (parsed.type === 'tool_call') {
          if (parsed.data) toolCalls.push(parsed.data);
          return;
        }
        if (parsed.type === 'final') {
          streamState.finalData = parsed.data ?? {};
          return;
        }
        if (parsed.type === 'error') {
          throw new Error(parsed.data?.message || 'AI 服务暂不可用');
        }
        // 普通流式增量（OpenAI choices[0].delta.content 格式）
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) { fullText += delta; onChunk(delta); }
      } catch (e) {
        // 解析失败的行忽略；主动抛出的业务错误继续上抛
        if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
      }
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 末尾不完整的一行（可能为空串）留到下一轮
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }
    // 流结束后若 buffer 还残留完整行，再处理一次
    if (buffer.trim()) handleLine(buffer);
  } finally { reader.releaseLock(); }
  // 工具模式：final.message 是完整结论（pending 暂停时含提示文案），
  // 优先于流式拼接的 fullText；工具轨迹优先用逐条收集的 tool_call 事件
  const finalData = streamState.finalData;
  return {
    content: finalData?.message || fullText,
    usage: finalData?.usage ?? undefined,
    toolCalls: toolCalls.length ? toolCalls : finalData?.toolsUsed ?? undefined,
    pendingConfirm: finalData?.pendingConfirm ?? undefined,
  };
}

/** 确认执行待确认工具（POST /api/ai/tools/confirm），返回执行结果摘要 */
export async function confirmToolCall(pendingId: string): Promise<{ summary: string; detail?: unknown }> {
  const url = getApiUrl('/ai/tools/confirm');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pendingId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || '确认执行失败');
  return { summary: data.data?.summary || '执行完成', detail: data.data?.detail };
}

/** 取消待确认工具（POST /api/ai/tools/cancel） */
export async function cancelToolCall(pendingId: string): Promise<{ summary: string }> {
  const url = getApiUrl('/ai/tools/cancel');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pendingId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || '取消失败');
  return { summary: data.data?.summary || '已取消' };
}
