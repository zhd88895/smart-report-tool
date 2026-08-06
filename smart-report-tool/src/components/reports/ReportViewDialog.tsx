/**
 * AI 报告在线查看弹窗
 *
 * 直接在网页中渲染 AI 生成的 Markdown 报告，并提供：
 *  - 一键导出为独立 HTML 网页（内联样式，可直接分发/存档）
 *  - 下载原始 .md 文件
 */

import { useEffect, useState, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Download, FileCode2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer';
import { Report } from '@/types';
import { getApiUrl, fetchWithAuth } from '@/services/api';
import { isReportOutputFile } from '@/components/reports/ReportPreviewDialog';
import { LOG_CATEGORY_LABELS } from '@/constants/categories';
import { formatDateShort } from '@/utils/formatters';

const AI_EXTRA_TYPE_LABELS: Record<string, string> = { support: '整机支持包', other: '其他' };

export interface ReportViewDialogProps {
  /** 要查看的报告（为 null 时不显示） */
  report: Report | null;
  onClose: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 触发浏览器下载一个 Blob */
function saveBlob(blob: Blob, fileName: string) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
}

/** 将 Markdown 报告导出为独立 HTML 网页（样式全部内联，脱离系统也能正常显示） */
function exportAsHtml(report: Report, markdown: string) {
  const bodyHtml = renderToStaticMarkup(createElement(MarkdownRenderer, { content: markdown }));
  const typeLabel = LOG_CATEGORY_LABELS[report.type] || AI_EXTRA_TYPE_LABELS[report.type] || report.type || '-';
  const dateText = report.date ? formatDateShort(report.date) : formatDateShort(report.createdAt);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(report.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px; background: #f4f6f9; color: #1f2937;
         font-family: "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", sans-serif;
         font-size: 15px; line-height: 1.75; }
  .page { max-width: 880px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0;
          border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(15, 23, 42, .06); }
  .report-header { background: #16335b; color: #ffffff; padding: 28px 36px; }
  .report-header h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.4; word-break: break-all; }
  .report-meta { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 13px; color: #c7d4ea; }
  .report-meta span { white-space: nowrap; }
  .content { padding: 28px 36px 36px; }
  .content h1, .content h2, .content h3, .content h4 { color: #16335b; line-height: 1.4; margin: 1.4em 0 .6em; }
  .content h1 { font-size: 20px; border-bottom: 2px solid #16335b; padding-bottom: 8px; }
  .content h2 { font-size: 18px; border-bottom: 1px solid #dbe3ef; padding-bottom: 6px; }
  .content h3 { font-size: 16px; }
  .content h4 { font-size: 15px; }
  .content p { margin: .7em 0; }
  .content a { color: #1d5fb8; text-decoration: none; }
  .content a:hover { text-decoration: underline; }
  .content ul, .content ol { padding-left: 1.6em; margin: .7em 0; }
  .content li { margin: .25em 0; }
  .content blockquote { margin: 1em 0; padding: 10px 16px; border-left: 4px solid #16335b;
                        background: #f0f4fa; color: #475569; border-radius: 0 6px 6px 0; }
  .content blockquote p { margin: 0; }
  .content code { background: #eef2f7; color: #b03a5b; padding: 2px 6px; border-radius: 4px;
                  font-family: Consolas, "Courier New", monospace; font-size: 13px; }
  .content pre { background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 8px;
                 overflow-x: auto; font-size: 13px; line-height: 1.6; }
  .content pre code { background: none; color: inherit; padding: 0; }
  .content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
  .content th, .content td { border: 1px solid #d5dde8; padding: 8px 12px; text-align: left; }
  .content th { background: #eef2f8; color: #16335b; font-weight: 600; }
  .content tr:nth-child(even) td { background: #f8fafc; }
  .content img { max-width: 100%; }
  .content hr { border: none; border-top: 1px solid #dbe3ef; margin: 1.6em 0; }
  .report-footer { padding: 16px 36px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;
                   display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; }
</style>
</head>
<body>
<div class="page">
  <div class="report-header">
    <h1>${escapeHtml(report.name)}</h1>
    <div class="report-meta">
      ${report.reportNo ? `<span>编号：${escapeHtml(report.reportNo)}</span>` : ''}
      <span>类型：${escapeHtml(typeLabel)}</span>
      <span>作者：${escapeHtml(report.author || '-')}</span>
      <span>日期：${escapeHtml(dateText)}</span>
    </div>
  </div>
  <div class="content">
${bodyHtml}
  </div>
  <div class="report-footer">
    <span>由 APL 智能报告工具 · AI 智能分析生成</span>
    <span>${escapeHtml(dateText)}</span>
  </div>
</div>
</body>
</html>`;

  const safeName = report.name.replace(/[\\/:*?"<>|]/g, '_');
  saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeName}.html`);
  toast.success('HTML 网页已导出');
}

export function ReportViewDialog({ report, onClose }: ReportViewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileIndex, setFileIndex] = useState(0);

  useEffect(() => {
    if (!report) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setContent('');
      try {
        // 1. 找到报告产物中第一个 Markdown 文件的索引（与下载接口的索引规则一致）
        let mdIndex = -1;
        let mdName = '';
        try {
          const res = await fetchWithAuth(getApiUrl(`/reports/${report.id}/files`));
          if (res.ok) {
            const payload = await res.json();
            const files = (payload.data?.files || payload.files || [])
              .filter((f: any) => isReportOutputFile(f.name || ''));
            mdIndex = files.findIndex((f: any) => (f.name || '').toLowerCase().endsWith('.md'));
            if (mdIndex >= 0) mdName = (files[mdIndex].name || '').split(/[/\\]/).pop() || '';
          }
        } catch { /* 接口不可用时走本地兜底 */ }

        if (mdIndex < 0) {
          // 本地兜底：用报告记录里的 filePaths
          const localPaths = (report.filePaths && report.filePaths.length > 0
            ? report.filePaths
            : (report.filePath ? [report.filePath] : [])
          ).filter((fp) => isReportOutputFile(fp));
          mdIndex = localPaths.findIndex((fp) => fp.toLowerCase().endsWith('.md'));
          if (mdIndex >= 0) mdName = localPaths[mdIndex].split(/[/\\]/).pop() || '';
        }

        if (mdIndex < 0) throw new Error('报告中没有可在线查看的 Markdown 文件');

        // 2. 读取文件内容
        const res = await fetchWithAuth(
          getApiUrl(`/reports/${report.id}/file-content?fileIndex=${mdIndex}`)
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || `读取失败 (${res.status})`);
        }
        const payload = await res.json();
        const data = payload.data || payload;
        if (cancelled) return;
        setContent(data.content || '');
        setFileName(data.fileName || mdName);
        setFileIndex(mdIndex);
      } catch (err: any) {
        if (!cancelled) toast.error(err.message || '加载报告内容失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [report]);

  const downloadMarkdown = async () => {
    if (!report) return;
    try {
      const res = await fetchWithAuth(getApiUrl(`/reports/${report.id}/download?fileIndex=${fileIndex}`));
      if (!res.ok) { toast.error('文件不存在或已被清理'); return; }
      saveBlob(await res.blob(), fileName || `${report.name}.md`);
    } catch {
      toast.error('下载失败，请确认后端服务已启动');
    }
  };

  return (
    <Dialog open={!!report} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="pr-8 break-all">{report?.name}</DialogTitle>
          {report && (
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {report.reportNo && <span className="font-mono mr-3">编号：{report.reportNo}</span>}
                <span className="mr-3">作者：{report.author || '-'}</span>
                <span>日期：{report.date ? formatDateShort(report.date) : formatDateShort(report.createdAt)}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline"
                  disabled={loading || !content}
                  onClick={() => report && exportAsHtml(report, content)}
                >
                  <FileCode2 className="mr-1 h-3.5 w-3.5" />导出 HTML 网页
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={loading || !content}
                  onClick={downloadMarkdown}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />下载 Markdown
                </Button>
              </div>
            </div>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto rounded-md border bg-muted/20 p-5">
          {loading ? (
            <LoadingSpinner text="加载报告内容..." className="py-8" />
          ) : content ? (
            <MarkdownRenderer content={content} className="prose-base" />
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">暂无可显示的内容</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
