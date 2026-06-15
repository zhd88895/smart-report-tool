import { useState, useCallback } from 'react';
import { sendMessage as sendMessageService, recognizeIntent } from '@/services/aiService';

export function useAIAssistant() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (message: string): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const content = await sendMessageService(message, []);
        setIsLoading(false);
        return content;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI请求失败';
        setError(msg);
        setIsLoading(false);
        return '抱歉，AI助手暂时无法响应，请稍后重试。';
      }
    },
    []
  );

  return {
    isLoading,
    error,
    send,
    recognizeIntent,
  };
}
