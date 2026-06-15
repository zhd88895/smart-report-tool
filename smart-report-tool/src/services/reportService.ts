import { Report, ReportTemplate } from '@/types';
import { getAllReports, putReport, removeReport } from './db';

export async function getAllReportsService(): Promise<Report[]> {
  return getAllReports();
}

export async function getReportsByUser(userId: string): Promise<Report[]> {
  const reports = await getAllReports();
  return reports.filter((r) => r.authorId === userId);
}

export async function getReportsByType(type: Report['type']): Promise<Report[]> {
  const reports = await getAllReports();
  return reports.filter((r) => r.type === type);
}

export async function createReport(report: Report): Promise<string> {
  return putReport(report);
}

export async function updateReportStatus(id: string, status: Report['status'], fileUrl?: string): Promise<void> {
  const reports = await getAllReports();
  const report = reports.find((r) => r.id === id);
  if (report) {
    report.status = status;
    if (fileUrl) report.fileUrl = fileUrl;
    await putReport(report);
  }
}

export async function deleteReport(id: string): Promise<void> {
  return removeReport(id);
}

export function generateReportHTML(report: Report, template: ReportTemplate, logs: string[]): string {
  const logContent = logs.map((log) => `<li>${log}</li>`).join('');
  const html = template.htmlContent
    .replace(/{{reportName}}/g, report.name)
    .replace(/{{reportDate}}/g, report.date)
    .replace(/{{author}}/g, report.author)
    .replace(/{{reportType}}/g, report.type)
    .replace(/{{logs}}/g, logContent)
    .replace(/{{generatedAt}}/g, new Date().toLocaleString('zh-CN'));
  return html;
}
