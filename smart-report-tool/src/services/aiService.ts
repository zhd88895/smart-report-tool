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

  // Fallback: mock response with delay
  await new Promise((resolve) => setTimeout(resolve, 800));
  return `收到您的消息："${message}"

我是智能报告助手的模拟回复。在实际环境中，这里会接入 CodeBuddy Agent SDK 提供真实的 AI 对话能力。

您可以尝试：
- 查询已生成的报告
- 分析数据库日志性能
- 询问一般运维问题`;
}

export async function analyzeLogs(logContent: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return `## 日志分析结果（模拟）

已分析日志内容，共 ${logContent.length} 字符。

### 初步发现
- 未发现严重错误（模拟分析）
- 系统运行状态正常
- 建议定期巡检

### 建议
1. 关注磁盘空间使用情况
2. 监控数据库连接池
3. 检查网络延迟指标

> 注：此为模拟分析结果，实际环境将接入真实 AI 模型进行分析。`;
}
