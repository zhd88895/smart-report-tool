import { useState, useCallback } from 'react';
import {
  sendMessageStream,
  sendMessage,
  recognizeIntent,
  type SendMessageResult,
} from '@/services/aiService';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import type { ConversationMessage } from '@/types';

export function useAIAssistant() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (message: string, history: ConversationMessage[] = []): Promise<SendMessageResult> => {
      setIsLoading(true);
      setError(null);
      try {
        // 从配置 store 取会话级选择的模型 id（null 表示用服务端默认）
        const modelId = useAIConfigStore.getState().selectedModelId ?? undefined;
        // enableTools：开启后端工具循环（只读工具 + 写/执行工具待确认流）
        const result = await sendMessage(message, history, modelId, { enableTools: true });
        setIsLoading(false);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI请求失败';
        setError(msg);
        setIsLoading(false);
        return { content: '抱歉，AI助手暂时无法响应，请稍后重试。' };
      }
    },
    []
  );

  const sendStream = useCallback(
    async (
      message: string,
      history: ConversationMessage[] = [],
      onChunk?: (text: string) => void
    ): Promise<SendMessageResult> => {
      setIsLoading(true);
      setError(null);
      try {
        // 从配置 store 取会话级选择的模型 id（null 表示用服务端默认）
        const modelId = useAIConfigStore.getState().selectedModelId ?? undefined;
        // enableTools：后端流式工具循环（文本增量实时推送 + tool_call/final 事件），
        // aiService 内部解析 SSE 并逐段回调 onChunk
        const result = await sendMessageStream(message, history, (chunk) => onChunk?.(chunk), modelId, {
          enableTools: true,
        });
        setIsLoading(false);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI请求失败';
        setError(msg);
        setIsLoading(false);
        return { content: '抱歉，AI助手暂时无法响应，请稍后重试。' };
      }
    },
    []
  );

  const cancel = useCallback(() => { setIsLoading(false); }, []);

  return { isLoading, error, send, sendStream, cancel, recognizeIntent };
}
