import { AIIntent, ConversationMessage } from '@/types';

export const recognizeIntent = detectIntent;

export function detectIntent(message: string): AIIntent {
  const lower = message.toLowerCase();
  if (/报告|查找|搜索|查询|列表/.test(lower)) return 'query_report';
  if (/分析|解读|性能|问题|故障|诊断/.test(lower)) return 'analyze_data';
  return 'general';
}

export async function sendMessage(message: string, history: ConversationMessage[]): Promise<string> {
  // Try to use CodeBuddy SDK if available
  const sdk = (window as unknown as Record<string, unknown>).__CodeBuddyAgentSDK__;
  if (sdk && typeof (sdk as { sendMessage?: (m: string, h: ConversationMessage[]) => Promise<string> }).sendMessage === 'function') {
    return (sdk as { sendMessage: (m: string, h: ConversationMessage[]) => Promise<string> }).sendMessage(message, history);
  }

  throw new Error('AI 服务暂不可用，请确认已配置 AI 模型接入');
}
