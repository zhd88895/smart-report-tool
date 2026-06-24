/**
 * 脚本数据仓储
 *
 * 提供脚本及辅助文件的增删改查。
 *
 * @module db/repositories/scriptRepository
 */

import { getAsync, allAsync, runAsync, withTransaction } from '../database';
import type { Script, AuxiliaryFile } from '../../services/scriptService';

function rowToScript(row: any): Script {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    scriptType: row.script_type,
    region: row.region || '全部',
    inputFormats: row.input_formats || '',
    inputFormatManual: Boolean(row.input_format_manual),
    version: row.version || '1.0',
    category: row.category || 'host',
    fileName: row.file_name,
    filePath: row.file_path,
    fileHash: row.file_hash || '',
    fileSize: row.file_size || 0,
    templateRequired: Boolean(row.template_required),
    templateIds: safeJsonParse<string[]>(row.template_ids, []),
    auxiliaryFiles: [],
    requirements: safeJsonParse<string[]>(row.requirements, []),
    depsStatus: safeJsonParse(row.deps_status, {
      status: 'none',
      log: '',
      packages: [],
    }),
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by || 'unknown',
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

function scriptToRow(script: Script): any[] {
  return [
    script.id,
    script.name,
    script.description || '',
    script.scriptType,
    script.region || '全部',
    script.inputFormats || '',
    script.inputFormatManual ? 1 : 0,
    script.version || '1.0',
    script.category || 'host',
    script.fileName,
    script.filePath,
    script.fileHash || '',
    script.fileSize || 0,
    script.templateRequired ? 1 : 0,
    JSON.stringify(script.templateIds || []),
    JSON.stringify(script.requirements || []),
    JSON.stringify(script.depsStatus || { status: 'none', log: '', packages: [] }),
    script.uploadedAt,
    script.uploadedBy || 'unknown',
  ];
}

export const scriptRepository = {
  async findAll(filter?: { region?: string; category?: string; scriptType?: string }): Promise<Script[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.region) {
      conditions.push('region = ?');
      params.push(filter.region);
    }
    if (filter?.category) {
      conditions.push('category = ?');
      params.push(filter.category);
    }
    if (filter?.scriptType) {
      conditions.push('script_type = ?');
      params.push(filter.scriptType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await allAsync(`SELECT * FROM scripts ${where} ORDER BY uploaded_at DESC`, params);

    const scripts = rows.map(rowToScript);
    for (const script of scripts) {
      script.auxiliaryFiles = await this.findAuxiliaryFiles(script.id);
    }
    return scripts;
  },

  async findById(id: string): Promise<Script | null> {
    const row = await getAsync('SELECT * FROM scripts WHERE id = ?', [id]);
    if (!row) return null;
    const script = rowToScript(row);
    script.auxiliaryFiles = await this.findAuxiliaryFiles(id);
    return script;
  },

  async create(script: Script): Promise<Script> {
    await runAsync(
      `INSERT INTO scripts (
        id, name, description, script_type, region, input_formats, input_format_manual,
        version, category, file_name, file_path, file_hash, file_size, template_required,
        template_ids, requirements, deps_status, uploaded_at, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scriptToRow(script)
    );

    if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
      for (const aux of script.auxiliaryFiles) {
        await this.createAuxiliaryFile(script.id, aux);
      }
    }
    return script;
  },

  async update(id: string, data: Partial<Script>): Promise<Script | null> {
    const allowedMapping: Record<string, string> = {
      name: 'name',
      description: 'description',
      scriptType: 'script_type',
      region: 'region',
      inputFormats: 'input_formats',
      inputFormatManual: 'input_format_manual',
      version: 'version',
      category: 'category',
      templateRequired: 'template_required',
      templateIds: 'template_ids',
      requirements: 'requirements',
      depsStatus: 'deps_status',
    };

    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, dbKey] of Object.entries(allowedMapping)) {
      if (key in data && (data as any)[key] !== undefined) {
        let value = (data as any)[key];
        if (key === 'inputFormatManual' || key === 'templateRequired') {
          value = value ? 1 : 0;
        } else if (key === 'templateIds' || key === 'requirements' || key === 'depsStatus') {
          value = JSON.stringify(value || []);
        }
        fields.push(`${dbKey} = ?`);
        values.push(value);
      }
    }

    if (fields.length > 0) {
      values.push(id);
      await runAsync(`UPDATE scripts SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    return this.findById(id);
  },

  async updateContent(id: string, fileHash: string, fileSize: number): Promise<void> {
    await runAsync('UPDATE scripts SET file_hash = ?, file_size = ? WHERE id = ?', [fileHash, fileSize, id]);
  },

  async updateFileInfo(id: string, data: { fileName: string; filePath: string; fileHash: string; fileSize: number }): Promise<void> {
    await runAsync(
      'UPDATE scripts SET file_name = ?, file_path = ?, file_hash = ?, file_size = ? WHERE id = ?',
      [data.fileName, data.filePath, data.fileHash, data.fileSize, id]
    );
  },

  async delete(id: string): Promise<void> {
    await runAsync('DELETE FROM scripts WHERE id = ?', [id]);
  },

  async findAuxiliaryFiles(scriptId: string): Promise<AuxiliaryFile[]> {
    const rows = await allAsync('SELECT * FROM script_auxiliary_files WHERE script_id = ?', [scriptId]);
    return rows.map((row) => ({
      name: row.name,
      size: row.size,
      path: row.path,
      hash: row.hash || '',
    }));
  },

  async createAuxiliaryFile(scriptId: string, aux: AuxiliaryFile): Promise<void> {
    await runAsync(
      'INSERT INTO script_auxiliary_files (script_id, name, size, path, hash) VALUES (?, ?, ?, ?, ?)',
      [scriptId, aux.name, aux.size, aux.path, aux.hash || '']
    );
  },

  async clearAuxiliaryFiles(scriptId: string): Promise<void> {
    await runAsync('DELETE FROM script_auxiliary_files WHERE script_id = ?', [scriptId]);
  },
};
