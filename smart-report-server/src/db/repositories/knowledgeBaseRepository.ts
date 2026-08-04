/**
 * 知识库仓储模块
 *
 * 提供知识库分类和文件的 CRUD 操作
 *
 * @module db/repositories/knowledgeBaseRepository
 */

import { allAsync, getAsync, runAsync } from '../database';
import { getLogger } from '../../utils/logger';

const log = getLogger('KnowledgeBaseRepository', 'other');

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

export interface KBCategory {
  id: string;
  name: string;
  description?: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface KBFile {
  id: string;
  category_id?: string;
  title: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  file_ext: string;
  content?: string;
  content_length: number;
  status: string;
  error_message?: string;
  uploaded_by?: string;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════
//  分类操作
// ═══════════════════════════════════════════════════════

export const knowledgeBaseRepository = {
  // ── 分类 ──

  async findAllCategories(): Promise<KBCategory[]> {
    const rows = await allAsync(
      `SELECT * FROM kb_categories ORDER BY sort_order ASC, created_at ASC`
    );
    return rows as KBCategory[];
  },

  async findCategoryById(id: string): Promise<KBCategory | null> {
    const row = await getAsync(`SELECT * FROM kb_categories WHERE id = ?`, [id]);
    return (row as KBCategory) || null;
  },

  async createCategory(cat: Omit<KBCategory, 'id' | 'created_at' | 'updated_at'>): Promise<KBCategory> {
    const now = new Date().toISOString();
    const id = `kbcat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await runAsync(
      `INSERT INTO kb_categories (id, name, description, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, cat.name, cat.description || '', cat.color || 'blue', cat.sort_order || 0, now, now]
    );
    return { ...cat, id, created_at: now, updated_at: now } as KBCategory;
  },

  async updateCategory(id: string, updates: Partial<KBCategory>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
    fields.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(id);
    await runAsync(`UPDATE kb_categories SET ${fields.join(', ')} WHERE id = ?`, values);
  },

  async deleteCategory(id: string): Promise<void> {
    await runAsync(`DELETE FROM kb_categories WHERE id = ?`, [id]);
  },

  // ── 文件 ──

  async findAllFiles(categoryId?: string): Promise<KBFile[]> {
    if (categoryId) {
      return await allAsync(
        `SELECT * FROM kb_files WHERE category_id = ? ORDER BY created_at DESC`,
        [categoryId]
      ) as KBFile[];
    }
    return await allAsync(
      `SELECT * FROM kb_files ORDER BY created_at DESC`
    ) as KBFile[];
  },

  async findFileById(id: string): Promise<KBFile | null> {
    const row = await getAsync(`SELECT * FROM kb_files WHERE id = ?`, [id]);
    return (row as KBFile) || null;
  },

  async findFilesByIds(ids: string[]): Promise<KBFile[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return await allAsync(
      `SELECT * FROM kb_files WHERE id IN (${placeholders})`,
      ids
    ) as KBFile[];
  },

  async searchFiles(query: string): Promise<KBFile[]> {
    const pattern = `%${query}%`;
    return await allAsync(
      `SELECT * FROM kb_files WHERE title LIKE ? OR content LIKE ? OR file_name LIKE ? ORDER BY created_at DESC LIMIT 50`,
      [pattern, pattern, pattern]
    ) as KBFile[];
  },

  async createFile(file: Omit<KBFile, 'id' | 'created_at' | 'updated_at'>): Promise<KBFile> {
    const now = new Date().toISOString();
    const id = `kbfile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await runAsync(
      `INSERT INTO kb_files (id, category_id, title, file_name, file_path, file_size, file_type, file_ext, content, content_length, status, error_message, uploaded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, file.category_id || null, file.title, file.file_name, file.file_path, file.file_size, file.file_type, file.file_ext, file.content || '', file.content_length || 0, file.status || 'ready', file.error_message || null, file.uploaded_by || null, now, now]
    );
    return { ...file, id, created_at: now, updated_at: now } as KBFile;
  },

  async updateFile(id: string, updates: Partial<KBFile>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.category_id !== undefined) { fields.push('category_id = ?'); values.push(updates.category_id); }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.content_length !== undefined) { fields.push('content_length = ?'); values.push(updates.content_length); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.error_message !== undefined) { fields.push('error_message = ?'); values.push(updates.error_message); }
    fields.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(id);
    await runAsync(`UPDATE kb_files SET ${fields.join(', ')} WHERE id = ?`, values);
  },

  async deleteFile(id: string): Promise<void> {
    await runAsync(`DELETE FROM kb_files WHERE id = ?`, [id]);
  },

  async countFilesByCategory(categoryId: string): Promise<number> {
    const row = await getAsync(
      `SELECT COUNT(*) as count FROM kb_files WHERE category_id = ?`,
      [categoryId]
    );
    return (row as any)?.count || 0;
  },
};
