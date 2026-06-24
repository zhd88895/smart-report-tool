/**
 * 对话数据仓储
 *
 * 提供对话表的增删改查。
 *
 * @module db/repositories/conversationRepository
 */

import { getAsync, allAsync, runAsync } from '../database';

export interface ConversationRecord {
  id: string;
  userId: string;
  userName: string;
  messages: any[];
  createdAt: string;
  updatedAt: string;
}

function rowToConversation(row: any): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || '',
    messages: safeJsonParse<any[]>(row.messages, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

export const conversationRepository = {
  async findAll(filter?: { userId?: string }): Promise<ConversationRecord[]> {
    const where = filter?.userId ? 'WHERE user_id = ?' : '';
    const params = filter?.userId ? [filter.userId] : [];
    const rows = await allAsync(`SELECT * FROM conversations ${where} ORDER BY updated_at DESC`, params);
    return rows.map(rowToConversation);
  },

  async findById(id: string): Promise<ConversationRecord | null> {
    const row = await getAsync('SELECT * FROM conversations WHERE id = ?', [id]);
    return row ? rowToConversation(row) : null;
  },

  async create(conversation: ConversationRecord): Promise<ConversationRecord> {
    await runAsync(
      `INSERT INTO conversations (id, user_id, user_name, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        conversation.id,
        conversation.userId,
        conversation.userName || '',
        JSON.stringify(conversation.messages || []),
        conversation.createdAt,
        conversation.updatedAt,
      ]
    );
    return conversation;
  },

  async update(id: string, data: Partial<ConversationRecord>): Promise<ConversationRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.messages !== undefined) {
      fields.push('messages = ?');
      values.push(JSON.stringify(data.messages));
    }
    if (data.userName !== undefined) {
      fields.push('user_name = ?');
      values.push(data.userName);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await runAsync(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    await runAsync('DELETE FROM conversations WHERE id = ?', [id]);
  },
};
