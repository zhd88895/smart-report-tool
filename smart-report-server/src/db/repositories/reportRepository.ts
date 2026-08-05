/**
 * 报告数据仓储
 *
 * 提供报告表的增删改查。
 *
 * @module db/repositories/reportRepository
 */

import { getAsync, allAsync, runAsync } from '../database';
import type { Report } from '../../services/reportService';
import { toAbsolutePath, toRelativePath } from '../../config';
import { safeJsonParse } from '../../utils/json';

function rowToReport(row: any): Report {
  const filePaths: string[] = safeJsonParse<string[]>(row.file_paths, []);
  return {
    id: row.id,
    name: row.name,
    reportNo: row.report_no || undefined,
    description: row.description || '',
    scriptId: row.script_id,
    scriptName: row.script_name || '',
    templateId: row.template_id,
    templateName: row.template_name,
    outputFormat: row.output_format || '',
    workspaceDir: toAbsolutePath(row.workspace_dir),
    generatedAt: row.generated_at,
    generatedBy: row.generated_by || 'unknown',
    status: row.status,
    error: row.error,
    logs: safeJsonParse<string[]>(row.logs, []),
    // filePaths 是 workspace 内相对路径，不是 DATA_DIR 相对路径，保持原样
    filePaths,
    type: row.type || row.category || '',
    region: row.region || '',
    date: row.date || row.generated_at,
    author: row.author || row.generated_by || 'unknown',
    createdAt: row.created_at || row.generated_at,
    reportSource: row.report_source || 'script',
  };
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
    toRelativePath(report.workspaceDir),
    report.generatedAt,
    report.generatedBy || 'unknown',
    report.status,
    report.error || null,
    JSON.stringify(report.logs || []),
    // filePaths 是 workspace 内相对路径，直接存储不转换
    JSON.stringify(report.filePaths || []),
    report.type || null,
    report.region || null,
    report.date || null,
    report.author || null,
    report.createdAt || null,
    report.reportSource || 'script',
    report.reportNo || null,
  ];
}

export const reportRepository = {
  async findAll(filter?: { status?: string; generatedBy?: string; reportSource?: string }): Promise<Report[]> {
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
    if (filter?.reportSource) {
      conditions.push('report_source = ?');
      params.push(filter.reportSource);
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
        type, region, date, author, created_at, report_source, report_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reportToRow(report)
    );
    return report;
  },

  /** 统计指定时间范围内生成的报告数（用于报告编号的当日序列） */
  async countByDateRange(start: string, end: string): Promise<number> {
    const row = await getAsync(
      'SELECT COUNT(*) as cnt FROM reports WHERE generated_at >= ? AND generated_at <= ?',
      [start, end]
    );
    return (row as any)?.cnt ?? 0;
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
  async finalize(id: string, data: {
    status: string;
    logs: string[];
    filePaths: string[];
    error?: string;
    type?: string;
    region?: string;
    date?: string;
    author?: string;
    createdAt?: string;
  }): Promise<void> {
    await runAsync(
      `UPDATE reports SET status = ?, logs = ?, file_paths = ?, error = ?,
       type = COALESCE(?, type), region = COALESCE(?, region),
       date = COALESCE(?, date), author = COALESCE(?, author), created_at = COALESCE(?, created_at)
       WHERE id = ?`,
      [
        data.status,
        JSON.stringify(data.logs),
        // filePaths 是 workspace 内相对路径，直接存储不转换
        JSON.stringify(data.filePaths),
        data.error || null,
        data.type || null,
        data.region || null,
        data.date || null,
        data.author || null,
        data.createdAt || null,
        id,
      ]
    );
  },

  /** 仅更新报告文件路径（失败恢复流程使用） */
  async updateFilePaths(id: string, filePaths: string[]): Promise<void> {
    await runAsync('UPDATE reports SET file_paths = ? WHERE id = ?', [
      JSON.stringify(filePaths),
      id,
    ]);
  },

  async delete(id: string): Promise<void> {
    await runAsync('DELETE FROM reports WHERE id = ?', [id]);
  },
};
