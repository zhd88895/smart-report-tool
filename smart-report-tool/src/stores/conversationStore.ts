import { create } from 'zustand';
import { Conversation, ConversationMessage } from '@/types';
import {
  getAllConversationsService,
  deleteConversation,
} from '@/services/conversationService';
import { putConversation } from '@/services/db';

interface ConversationState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  isLoading: boolean;
  error: string | null;
  fetchConversations: () => Promise<void>;
  addConversation: (conversation: Conversation) => Promise<void>;
  appendMessage: (conversationId: string, message: ConversationMessage) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  createNewConversation: (userId: string, userName: string) => Promise<void>;
  sendMessage: (conversationId: string, message: ConversationMessage) => Promise<void>;
  setCurrentConversation: (conversation: Conversation | null) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  isLoading: false,
  error: null,

  fetchConversations: async () => {
    set({ isLoading: true, error: null });
    try {
      const conversations = await getAllConversationsService();
      set({ conversations, isLoading: false });
    } catch {
      set({ error: '加载对话记录失败', isLoading: false });
    }
  },

  addConversation: async (conversation) => {
    await putConversation(conversation);
    await get().fetchConversations();
  },

  appendMessage: async (conversationId, message) => {
    const conversation = get().conversations.find((c) => c.id === conversationId);
    if (!conversation) return;
    const updated: Conversation = {
      ...conversation,
      messages: [...conversation.messages, message],
      updatedAt: new Date().toISOString(),
    };
    await putConversation(updated);
    await get().fetchConversations();
    if (get().currentConversation?.id === conversationId) {
      set({ currentConversation: updated });
    }
  },

  removeConversation: async (id) => {
    await deleteConversation(id);
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
    await putConversation(conversation);
    await get().fetchConversations();
    set({ currentConversation: conversation });
  },

  sendMessage: async (conversationId: string, message: ConversationMessage) => {
    await get().appendMessage(conversationId, message);
  },

  setCurrentConversation: (conversation) => {
    set({ currentConversation: conversation });
  },
}));
