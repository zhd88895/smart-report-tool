import { RefObject } from 'react';
import { Report } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Download, Package, RefreshCw, Terminal } from 'lucide-react';
import { getApiUrl, fetchWithAuth } from '@/services/api';
import { parseContentDispositionFilename } from '@/utils/download';

type ResultStatus = 'generating' | 'success' | 'failed';

interface GeneratingResultCardProps {
  status: ResultStatus;
  logs: string[];
  isRestored: boolean;
  logsEndRef: RefObject<HTMLDivElement>;
  onClearLogs: () => void;
  /** 最近一次生成的报告（用于成功后的文件下载） */
  report: Report | null;
  reportId: string;
  /** 生成新报告（重置向导与日志） */
  onReset: () => void;
  /** 失败后返回步骤5修改 */
  onBackToEdit: () => void;
  /** 失败后重新生成 */
  onRetry: () => void;
}

/** 报告生成中 / 成功 / 失败 的日志与结果卡片 */
export function GeneratingResultCard({
  status,
  logs,
  isRestored,
  logsEndRef,
  onClearLogs,
  report,
  reportId,
  onReset,
  onBackToEdit,
  onRetry,
}: GeneratingResultCardProps) {
  const filePaths = report?.filePaths || [];

  const handleDownload = async (fileIndex: number) => {
    if (!reportId) {
      toast.error('报告ID为空');
      return;
    }
    const url = getApiUrl(`/reports/${reportId}/download?fileIndex=${fileIndex}`);
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || errData.message || `下载失败 (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      const cd = res.headers.get('Content-Disposition');
      const parsedName = parseContentDispositionFilename(cd);
      a.download = parsedName || (filePaths[fileIndex]?.split(/[/\\]/).pop() || `report`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
    } catch (err: any) {
      toast.error(`下载失败: ${err.message || '网络错误'}`);
    }
  };

  const handleDownloadAll = () => {
    for (let i = 0; i < filePaths.length; i++) {
      // 逐个触发下载（浏览器会分别处理）
      setTimeout(() => handleDownload(i), i * 300);
    }
  };

  const handleDownloadPackage = async () => {
    const currentReportId = reportId;
    if (!currentReportId) {
      toast.error('报告ID为空，请重新生成报告');
      return;
    }
    const url = getApiUrl(`/reports/${currentReportId}/download-all`);
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        try { toast.error(errData.error || errData.message || `打包下载失败 (${res.status})`); } catch (e) { console.error('[打包下载] toast.error failed:', e); }
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      const cd = res.headers.get('Content-Disposition');
      const parsedName = parseContentDispositionFilename(cd);
      a.download = parsedName || `${report?.name || '报告'}_全部文件.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延迟释放 blob URL，给浏览器足够时间启动异步下载
      setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
    } catch (err: any) {
      try { toast.error(`打包下载失败: ${err.message || '网络错误'}`); } catch (e) { console.error('[打包下载] toast.error failed:', e); }
      console.error('[打包下载] 捕获异常:', err);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          {status === 'generating' ? '正在生成报告...' :
           status === 'success' ? '报告生成成功' : '报告生成失败'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Log panel header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isRestored && (
              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                <RefreshCw className="h-3 w-3 mr-1" />
                已恢复历史日志
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              共 {logs.length} 条日志
            </span>
          </div>
          {logs.length > 0 && status !== 'generating' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onClearLogs();
                toast.success('日志已清空');
              }}
            >
              清空日志
            </Button>
          )}
        </div>

        {/* Log panel */}
        <div className="rounded-lg bg-gray-950 p-4 max-h-80 overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-gray-500">等待执行...</p>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={`leading-relaxed ${line.includes('[ERR]') ? 'text-red-400' : line.includes('[OUT]') ? 'text-green-400' : line.includes('[判断]') ? 'text-yellow-400' : line.includes('[结果]') ? 'text-cyan-400' : 'text-gray-300'}`}>
                {line}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>

        {/* 查看生成的文件 (on success) */}
        {status === 'success' && (
          <div className="space-y-3 pt-2">
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="outline" onClick={onReset}>
                生成新报告
              </Button>
              {filePaths.length > 1 && (
                <>
                  <Button size="sm" onClick={handleDownloadAll}>
                    <Download className="mr-1 h-3 w-3" />一键下载全部 ({filePaths.length})
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleDownloadPackage}>
                    <Package className="mr-1 h-3 w-3" />打包下载 (.tar.gz)
                  </Button>
                </>
              )}
            </div>
            {filePaths.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">报告已生成，可在「报告管理」页面查看和下载</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  脚本生成了 {filePaths.length} 个报告文件：
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                  {filePaths.map((fp, idx) => {
                    const fileName = fp.split(/[/\\]/).pop() || `file_${idx + 1}`;
                    return (
                      <div key={idx} className="flex items-center justify-between rounded border p-2">
                        <span className="text-sm truncate mr-2 flex-1" title={fileName}>{fileName}</span>
                        <Button size="sm" variant="outline" onClick={() => handleDownload(idx)}>
                          <Download className="mr-1 h-3 w-3" />下载
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {status === 'failed' && (
          <div className="flex gap-3 justify-center pt-2">
            <Button variant="outline" onClick={onBackToEdit}>
              返回修改
            </Button>
            <Button onClick={onRetry}>
              重新生成
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
