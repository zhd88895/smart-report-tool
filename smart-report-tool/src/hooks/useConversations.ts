import { useEffect } from 'react';
import { useConversationStore } from '@/stores/conversationStore';

export function useConversations() {
  const { conversations, fetchConversations, removeConversation } = useConversationStore();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  return { conversations, removeConversation, refreshConversations: fetchConversations };
}
