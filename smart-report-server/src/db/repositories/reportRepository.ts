/**
 * 报告数据仓储
 *
 * 提供报告表的增删改查。
 *
 * @module db/repositories/reportRepository
 */

import { getAsync, allAsync, runAsync } from '../database';
import type { Report } from '../../services/reportService';

function rowToReport(row: any): Report {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    scriptId: row.script_id,
    scriptName: row.script_name || '',
    templateId: row.template_id,
    templateName: row.template_name,
    outputFormat: row.output_format || '',
    workspaceDir: row.workspace_dir,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by || 'unknown',
    status: row.status,
    error: row.error,
    logs: safeJsonParse<string[]>(row.logs, []),
    filePaths: safeJsonParse<string[]>(row.file_paths, []),
    // 前端兼容字段
    type: row.type || row.category || '',
    region: row.region || '',
    date: row.date || row.generated_at,
    author: row.author || row.generated_by || 'unknown',
    createdAt: row.created_at || row.generated_at,
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

function reportToRow(report: Report): any[] {
  return [
    report.id,
    report.name,
    report.description || '',
    report.scriptId,
    report.scriptName || '',
    report.templateId || null,
    report.templateName || null,
    report.outputFormat || '',
    report.workspaceDir,
    report.generatedAt,
    report.generatedBy || 'unknown',
    report.status,
    report.error || null,
    JSON.stringify(report.logs || []),
    JSON.stringify(report.filePaths || []),
    report.type || null,      // NEW
    report.region || null,    // NEW
    report.date || null,      // NEW
    report.author || null,    // NEW
    report.createdAt || null, // NEW
  ];
}

export const reportRepository = {
  async findAll(filter?: { status?: string; generatedBy?: string }): Promise<Report[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.generatedBy) {
      conditions.push('generated_by = ?');
      params.push(filter.generatedBy);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await allAsync(`SELECT * FROM reports ${where} ORDER BY generated_at DESC`, params);
    return rows.map(rowToReport);
  },

  async findById(id: string): Promise<Report | null> {
    const row = await getAsync('SELECT * FROM reports WHERE id = ?', [id]);
    return row ? rowToReport(row) : null;
  },

  async create(report: Report): Promise<Report> {
    await runAsync(
      `INSERT INTO reports (id, name, description, script_id, script_name, template_id, template_name,
        output_format, workspace_dir, generated_at, generated_by, status, error, logs, file_paths,
        type, region, date, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reportToRow(report)
    );
    return report;
  },

  /** 追加日志到现有报告的 logs 数组末尾 */
  async appendLogs(id: string, newLogs: string[]): Promise<void> {
    const report = await this.findById(id);
    if (!report) return;
    const existing = report.logs || [];
    existing.push(...newLogs);
    await runAsync('UPDATE reports SET logs = ? WHERE id = ?', [JSON.stringify(existing), id]);
  },

  /** 更新报告状态和错误信息 */
  async updateStatus(id: string, status: string, error?: string): Promise<void> {
    await runAsync('UPDATE reports SET status = ?, error = ? WHERE id = ?', [
      status, error || null, id
    ]);
  },

  /** 完整更新报告记录（文件路径、日志等所有字段） */
  async finalize(id: string, data: { status: string; logs: string[]; filePaths: string[]; error?: string }): Promise<void> {
    await runAsync(
      'UPDATE reports SET status = ?, logs = ?, file_paths = ?, error = ? WHERE id = ?',
      [data.status, JSON.stringify(data.logs), JSON.stringify(data.filePaths), data.error || null, id]
    );
  },

  async delete(id: string): Promise<void> {
    await runAsync('DELETE FROM reports WHERE id = ?', [id]);
  },
};
