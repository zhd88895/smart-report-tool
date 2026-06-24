/**
 * 模板数据仓储
 *
 * 提供模板表的增删改查。
 *
 * @module db/repositories/templateRepository
 */

import { getAsync, allAsync, runAsync } from '../database';

export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  fileType: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  compatibleScriptType: string;
  uploadedAt: string;
  uploadedBy: string;
}

function rowToTemplate(row: any): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    fileType: row.file_type || '',
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: row.file_size || 0,
    compatibleScriptType: row.compatible_script_type || 'python',
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by || 'unknown',
  };
}

export const templateRepository = {
  async findAll(): Promise<TemplateRecord[]> {
    const rows = await allAsync('SELECT * FROM templates ORDER BY uploaded_at DESC');
    return rows.map(rowToTemplate);
  },

  async findById(id: string): Promise<TemplateRecord | null> {
    const row = await getAsync('SELECT * FROM templates WHERE id = ?', [id]);
    return row ? rowToTemplate(row) : null;
  },

  async create(template: TemplateRecord): Promise<TemplateRecord> {
    await runAsync(
      `INSERT INTO templates (id, name, description, file_type, file_name, file_path, file_size, compatible_script_type, uploaded_at, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        template.id,
        template.name,
        template.description || '',
        template.fileType,
        template.fileName,
        template.filePath,
        template.fileSize || 0,
        template.compatibleScriptType || 'python',
        template.uploadedAt,
        template.uploadedBy || 'unknown',
      ]
    );
    return template;
  },

  async update(id: string, data: Partial<TemplateRecord>): Promise<TemplateRecord | null> {
    const mapping: Record<string, string> = {
      name: 'name',
      description: 'description',
      compatibleScriptType: 'compatible_script_type',
    };

    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, dbKey] of Object.entries(mapping)) {
      if (key in data && (data as any)[key] !== undefined) {
        fields.push(`${dbKey} = ?`);
        values.push((data as any)[key]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await runAsync(`UPDATE templates SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    await runAsync('DELETE FROM templates WHERE id = ?', [id]);
  },
};
