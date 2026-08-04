import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Download, Trash2, Check, AlertCircle } from 'lucide-react';
import { apiGet, apiDelete, getApiUrl, fetchWithAuth } from '@/services/api';
import { toast } from 'sonner';

interface PythonVersion {
  version: string;
  majorVersion: string;
  downloadUrl: string;
  isInstalled: boolean;
  installPath?: string;
  installedAt?: string;
  fileSize?: number;
  installStatus: 'not_installed' | 'installed' | 'partial' | 'error';
  pipAvailable: boolean;
  virtualenvAvailable: boolean;
  error?: string;
}

interface PythonVersionSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function PythonVersionSelector({ value, onChange, disabled }: PythonVersionSelectorProps) {
  const [versions, setVersions] = useState<PythonVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showManage, setShowManage] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ stage: string; progress: number; message: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  /** 获取版本列表 */
  const fetchVersions = async () => {
    try {
      setLoading(true);
      const res = await apiGet('/python-versions/available');
      // API 返回 { code: 200, data: { versions: [...] }, message: '...' }
      const versionsList = res?.data?.versions || res?.versions || [];
      setVersions(Array.isArray(versionsList) ? versionsList : []);
    } catch (err) {
      toast.error('获取 Python 版本列表失败');
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, []);

  /** 下载 Python 版本（SSE） */
  const handleDownload = async (version: string) => {
    setDownloading(version);
    setDownloadProgress({ stage: 'starting', progress: 0, message: '正在准备下载...' });

    try {
      const url = getApiUrl(`/python-versions/${version}/download`);
      const res = await fetchWithAuth(url, { method: 'POST' });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '网络错误' }));
        throw new Error(err.error || '下载失败');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              if (data.stage) {
                setDownloadProgress({
                  stage: data.stage,
                  progress: data.progress,
                  message: data.message,
                });
              }
              if (data.success) {
                toast.success(data.message);
                await fetchVersions();
              } else if (data.stage === 'error') {
                toast.error(data.message);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      toast.error(`下载失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(null);
      setDownloadProgress(null);
    }
  };

  /** 删除 Python 版本 */
  const handleDelete = async (version: string) => {
    setDeleting(version);
    try {
      const res = await apiDelete(`/python-versions/${version}`);
      // apiDelete 返回完整的 API 响应 { code, data, message }
      const result = res?.data || res;
      if (result?.success) {
        toast.success(result.message || '删除成功');
        await fetchVersions();
      } else {
        toast.error(result?.message || '删除失败');
      }
    } catch (err) {
      toast.error('删除失败');
    } finally {
      setDeleting(null);
    }
  };

  /** 格式化文件大小 */
  const formatSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  /** 格式化日期 */
  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Python 版本</label>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowManage(true)}
        >
          管理版本
        </Button>
      </div>

      <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
        <SelectTrigger>
          <SelectValue placeholder={loading ? '加载中...' : '选择 Python 版本'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="embedded">
            <div className="flex items-center gap-2">
              <span>内置 Python</span>
              <Badge variant="secondary" className="text-xs">默认</Badge>
            </div>
          </SelectItem>
          {(versions || []).filter(v => v.installStatus === 'installed').map(v => (
            <SelectItem key={v.version} value={v.version}>
              <div className="flex items-center gap-2">
                <span>Python {v.version}</span>
                <Badge variant="outline" className="text-xs">{v.majorVersion}</Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 版本管理对话框 */}
      <Dialog open={showManage} onOpenChange={setShowManage}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>管理 Python 版本</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 下载进度 */}
            {downloading && downloadProgress && (
              <div className="p-3 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <LoadingSpinner className="inline-flex py-0" />
                  <span className="text-sm font-medium">正在下载 Python {downloading}</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2 mb-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress.progress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{downloadProgress.message}</p>
              </div>
            )}

            {/* 版本列表 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">可用版本</h4>
              {(versions || []).map(v => (
                <div
                  key={v.version}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Python {v.version}</span>
                      {v.installStatus === 'installed' && (
                        <Badge variant="default" className="text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          已安装
                        </Badge>
                      )}
                      {v.installStatus === 'partial' && (
                        <Badge variant="secondary" className="text-xs">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          部分安装
                        </Badge>
                      )}
                      {v.installStatus === 'error' && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          安装异常
                        </Badge>
                      )}
                    </div>
                    {v.isInstalled && v.fileSize && (
                      <p className="text-xs text-muted-foreground mt-1">
                        大小: {formatSize(v.fileSize)} · 发布日期: {formatDate(v.installedAt)}
                      </p>
                    )}
                    {v.isInstalled && v.installStatus !== 'installed' && (
                      <div className="mt-1">
                        <p className="text-xs text-muted-foreground">
                          pip: {v.pipAvailable ? '✓' : '✗'} · virtualenv: {v.virtualenvAvailable ? '✓' : '✗'}
                        </p>
                        {v.error && (
                          <p className="text-xs text-destructive mt-1">{v.error}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {v.isInstalled ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(v.version)}
                        disabled={deleting === v.version}
                        title="删除版本"
                      >
                        {deleting === v.version ? (
                          <LoadingSpinner className="inline-flex py-0" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => handleDownload(v.version)}
                        disabled={downloading !== null}
                      >
                        {downloading === v.version ? (
                          <LoadingSpinner className="inline-flex py-0" />
                        ) : (
                          <Download className="h-4 w-4 mr-1" />
                        )}
                        下载
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 说明 */}
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <AlertCircle className="h-3 w-3 inline-block mr-1" />
                支持下载 Python 3.4 至 3.14 版本。Python 3.6+ 使用嵌入式包，3.5 及更早使用完整安装包。
                下载需要从 python.org 获取，首次下载可能需要几分钟。
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManage(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}