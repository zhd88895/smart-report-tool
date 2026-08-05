import { Download, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Report } from '@/types';
import { getApiUrl, fetchWithAuth } from '@/services/api';
import { parseContentDispositionFilename } from '@/utils/download';

export interface ReportFileInfo { index: number; name: string; size: number; }

// 报告文件白名单扩展名
const REPORT_FILE_EXTS = ['.html', '.docx', '.xlsx', '.md', '.pdf', '.json'];
// 常见脚本/辅助文件黑名单
const EXCLUDED_FILE_NAMES = new Set([
  'alias.json', 'alias.py', 'analysis.py', 'config.py', 'excel_io.py', 'logger.py',
  'main.py', 'config.ini', 'config.json', 'requirements.txt', 'setup.py', 'run.py',
  'utils.py', 'common.py', 'helpers.py', 'constants.py', 'settings.py',
]);

/** 判断文件名是否为报告产物（供页面侧文件列表接口回退过滤复用） */
export function isReportOutputFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  if (EXCLUDED_FILE_NAMES.has(lower)) return false;
  if (['.py', '.js', '.ts', '.jsx', '.tsx', '.ps1', '.bat', '.sh', '.cmd', '.ini', '.cfg', '.yaml', '.yml', '.toml'].includes(ext)) return false;
  return REPORT_FILE_EXTS.includes(ext);
}

function downloadFile(reportId: string, fileIndex: number, fileName: string) {
  const url = getApiUrl(`/reports/${reportId}/download?fileIndex=${fileIndex}`);
  fetchWithAuth(url).then(async (res) => {
    if (!res.ok) { toast.error('文件不存在或已被清理'); return; }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = fileName;
    document.body.appendChild(a);  // Firefox 下必须挂载到文档才能触发下载
    a.click();
    document.body.removeChild(a);
    // 延迟回收 blob URL，避免浏览器尚未开始异步下载就被释放
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  }).catch(() => {
    toast.error('下载失败，请确认后端服务已启动');
  });
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ReportPreviewDialogProps {
  /** 执行日志弹窗状态（为 null 时不显示） */
  logReport: Report | null;
  logContent: string[];
  logLoading: boolean;
  onCloseLog: () => void;
  /** 报告文件弹窗状态（为 null 时不显示） */
  filesReport: Report | null;
  reportFiles: ReportFileInfo[];
  filesLoading: boolean;
  onCloseFiles: () => void;
}

/** 报告预览弹窗组：执行日志弹窗 + 报告文件弹窗（含单个/批量/打包下载） */
export function ReportPreviewDialog({
  logReport,
  logContent,
  logLoading,
  onCloseLog,
  filesReport,
  reportFiles,
  filesLoading,
  onCloseFiles,
}: ReportPreviewDialogProps) {
  return (
    <>
      {/* 执行日志弹窗 */}
      <Dialog open={!!logReport} onOpenChange={(open) => { if (!open) { onCloseLog(); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>执行日志 - {logReport?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto bg-black text-green-400 font-mono text-sm p-4 rounded-md">
            {logLoading ? (
              <LoadingSpinner text="加载中..." className="justify-start py-2" />
            ) : logContent.length === 0 ? (
              <div className="text-muted-foreground">暂无日志</div>
            ) : (
              logContent.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 报告文件列表弹窗 */}
      <Dialog open={!!filesReport} onOpenChange={(open) => { if (!open) { onCloseFiles(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>报告文件 - {filesReport?.name}</DialogTitle>
            {filesReport?.reportNo && (
              <p className="text-xs text-muted-foreground font-mono">编号：{filesReport.reportNo}</p>
            )}
          </DialogHeader>
          {!filesLoading && (
            <div className="flex gap-2 pb-1">
              <Button size="sm" onClick={() => {
                for (let i = 0; i < reportFiles.length; i++) {
                  setTimeout(() => downloadFile(filesReport!.id, reportFiles[i].index, reportFiles[i].name), i * 300);
                }
              }}>
                <Download className="mr-1 h-3 w-3" />一键下载全部{reportFiles.length > 0 ? ` (${reportFiles.length})` : ''}
              </Button>
              <Button size="sm" variant="secondary" onClick={async () => {
                // 立即捕获当前报告信息，防止 dialog 关闭后状态变化
                const currentReport = filesReport;
                if (!currentReport) {
                  toast.error('报告ID为空');
                  return;
                }
                try {
                  const res = await fetchWithAuth(getApiUrl(`/reports/${currentReport.id}/download-all`));
                  if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    toast.error(errData.error || errData.message || `打包下载失败 (${res.status})`);
                    return;
                  }
                  const blob = await res.blob();
                  const objUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = objUrl;
                  const cd = res.headers.get('Content-Disposition');
                  const parsedName = parseContentDispositionFilename(cd);
                  a.download = parsedName || `${currentReport.name}_全部文件.tar.gz`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
                } catch (err: any) {
                  toast.error(`打包下载失败: ${err.message || '网络错误'}`);
                  console.error('[打包下载] 捕获异常:', err);
                }
              }}>
                <Package className="mr-1 h-3 w-3" />打包下载 (.tar.gz)
              </Button>
            </div>
          )}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filesLoading ? (
              <LoadingSpinner text="加载中..." className="py-4" />
            ) : reportFiles.length === 0 ? (
              <EmptyState title="暂无可下载的报告文件" description="" />
            ) : (
              reportFiles.map((f) => (
                <div key={f.index} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="min-w-0 flex-1 mr-3">
                    <Tooltip content={f.name}>
                      <p className="text-sm font-medium truncate">{f.name}</p>
                    </Tooltip>
                    <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => downloadFile(filesReport!.id, f.index, f.name)}>
                    <Download className="mr-1 h-3 w-3" />下载
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
