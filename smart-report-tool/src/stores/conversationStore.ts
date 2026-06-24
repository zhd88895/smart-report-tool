import { create } from 'zustand';
import { Conversation, ConversationMessage } from '@/types';
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/api';

interface ConversationState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  isLoading: boolean;
  error: string | null;
  fetchConversations: (userId?: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  createNewConversation: (userId: string, userName: string) => Promise<void>;
  appendMessage: (conversationId: string, message: ConversationMessage) => Promise<void>;
  sendMessage: (conversationId: string, message: ConversationMessage) => Promise<void>;
  setCurrentConversation: (conversation: Conversation | null) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  isLoading: false,
  error: null,

  fetchConversations: async (userId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const path = userId ? `/conversations?userId=${encodeURIComponent(userId)}` : '/conversations';
      const data = await apiGet(path);
      set({ conversations: data.data?.conversations || [], isLoading: false });
    } catch {
      set({ error: '加载对话记录失败', isLoading: false });
    }
  },

  removeConversation: async (id) => {
    try {
      await apiDelete(`/conversations/${id}`);
    } catch {
      set({ error: '删除对话失败，请检查后端服务' });
      return; // 后端失败不更新本地状态
    }
    await get().fetchConversations();
    if (get().currentConversation?.id === id) {
      set({ currentConversation: null });
    }
  },

  createNewConversation: async (userId: string, userName: string) => {
    const conversation: Conversation = {
      id: `conv_${Date.now()}`,
      userId,
      userName,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await apiPost('/conversations', conversation);
    } catch {
      set({ error: '创建对话失败，请检查后端服务' });
      return; // 后端失败不添加到本地
    }
    set((state) => ({ conversations: [conversation, ...state.conversations], currentConversation: conversation }));
  },

  appendMessage: async (conversationId, message) => {
    const conversation = get().conversations.find((c) => c.id === conversationId);
    if (!conversation) return;
    const updated: Conversation = {
      ...conversation,
      messages: [...conversation.messages, message],
      updatedAt: new Date().toISOString(),
    };
    // 先乐观更新本地，再同步后端
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === conversationId ? updated : c)),
    }));
    if (get().currentConversation?.id === conversationId) {
      set({ currentConversation: updated });
    }
    // 同步后端
    try {
      await apiPut(`/conversations/${conversationId}`, { messages: updated.messages, updatedAt: updated.updatedAt });
    } catch {
      set({ error: '同步对话失败，消息可能未持久化' });
    }
  },

  sendMessage: async (conversationId, message) => {
    await get().appendMessage(conversationId, message);
  },

  setCurrentConversation: (conversation) => {
    set({ currentConversation: conversation });
  },
}));
