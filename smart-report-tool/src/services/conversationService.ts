import { Conversation, ConversationMessage } from '@/types';
import { getAllConversations, getConversationById, putConversation, removeConversation } from './db';

export { putConversation };

export async function getAllConversationsService(): Promise<Conversation[]> {
  return getAllConversations();
}

export async function getConversationsByUser(userId: string): Promise<Conversation[]> {
  const conversations = await getAllConversations();
  return conversations.filter((c) => c.userId === userId);
}

export async function getConversationByIdService(id: string): Promise<Conversation | undefined> {
  return getConversationById(id);
}

export async function addMessage(conversationId: string, message: ConversationMessage): Promise<void> {
  const conversation = await getConversationById(conversationId);
  if (conversation) {
    conversation.messages.push(message);
    conversation.updatedAt = new Date().toISOString();
    await putConversation(conversation);
  }
}

export async function createConversation(userId: string, userName: string): Promise<Conversation> {
  const conversation: Conversation = {
    id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    userName,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await putConversation(conversation);
  return conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  return removeConversation(id);
}
