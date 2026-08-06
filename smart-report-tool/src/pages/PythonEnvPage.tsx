import { useState, useEffect, useCallback } from 'react';
import {
  Terminal, RefreshCw, Download, Trash2, Check, AlertCircle,
  Save, RotateCcw, Box, Globe, Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  apiGetPythonVersions, apiDownloadPythonVersion, apiDeletePythonVersion,
  apiGetPythonEnvironment, PythonEnvironmentInfo, PythonEnvProbe,
} from '@/services/api';
import { fetchAllSettings, updateSettings } from '@/services/settingsService';
import { useAuthStore } from '@/stores/authStore';
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

/** 格式化文件大小 */
function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 单个 Python 环境状态卡片 */
function EnvCard({
  title, description, icon: Icon, probe,
}: {
  title: string;
  description: string;
  icon: typeof Box;
  probe: PythonEnvProbe | undefined;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
          {probe?.available ? (
            <Badge variant="default" className="text-xs">
              <Check className="h-3 w-3 mr-1" />可用
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              <AlertCircle className="h-3 w-3 mr-1" />不可用
            </Badge>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">版本：</span>
          <span className="font-medium">{probe?.version ?? '—'}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground shrink-0">路径：</span>
          <span className="text-xs font-mono break-all">{probe?.path ?? '未找到'}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PythonEnvPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [envInfo, setEnvInfo] = useState<PythonEnvironmentInfo | null>(null);
  const [envLoading, setEnvLoading] = useState(true);

  const [versions, setVersions] = useState<PythonVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ stage: string; progress: number; message: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [pipValue, setPipValue] = useState('');
  const [pipSavedValue, setPipSavedValue] = useState('');
  const [pipSaving, setPipSaving] = useState(false);

  /** 获取脚本运行环境信息 */
  const fetchEnvironment = useCallback(async () => {
    try {
      setEnvLoading(true);
      const info = await apiGetPythonEnvironment();
      setEnvInfo(info);
      return info;
    } catch (err) {
      toast.error('获取 Python 环境信息失败');
      return null;
    } finally {
      setEnvLoading(false);
    }
  }, []);

  /** 获取版本列表 */
  const fetchVersions = useCallback(async () => {
    try {
      setVersionsLoading(true);
      const res = await apiGetPythonVersions();
      setVersions(Array.isArray(res.versions) ? res.versions : []);
    } catch (err) {
      toast.error('获取 Python 版本列表失败');
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  /** 加载 pip 镜像源设置（admin 可编辑，其余角色回落到环境信息中的生效值） */
  const loadPipSetting = useCallback(async (effectiveValue?: string) => {
    try {
      const d = await fetchAllSettings();
      const item = d.settings.find((s) => s.key === 'python.pipIndexUrl');
      if (item) {
        setPipValue(item.value);
        setPipSavedValue(item.value);
        return;
      }
    } catch {
      // member 角色无法读取系统设置，静默回落
    }
    if (effectiveValue) {
      setPipValue(effectiveValue);
      setPipSavedValue(effectiveValue);
    }
  }, []);

  const loadAll = useCallback(async () => {
    const info = await fetchEnvironment();
    await Promise.all([fetchVersions(), loadPipSetting(info?.pipIndexUrl)]);
  }, [fetchEnvironment, fetchVersions, loadPipSetting]);

  useEffect(() => { loadAll(); }, [loadAll]);

  /** 下载 Python 版本（SSE 流式进度） */
  const handleDownload = async (version: string) => {
    setDownloading(version);
    setDownloadProgress({ stage: 'starting', progress: 0, message: '正在准备下载...' });
    try {
      const result = await apiDownloadPythonVersion(version, (p) => setDownloadProgress(p));
      if (result.success) {
        toast.success(result.message || `Python ${version} 安装完成`);
        await fetchVersions();
        await fetchEnvironment();
      } else {
        toast.error(result.message || '下载失败');
      }
    } catch (err) {
      toast.error(`下载失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(null);
      setDownloadProgress(null);
    }
  };

  /** 确认删除 Python 版本 */
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const version = deleteTarget;
    setDeleteTarget(null);
    setDeleting(version);
    try {
      const res = await apiDeletePythonVersion(version);
      const result = (res as any)?.data || res;
      if (result?.success) {
        toast.success(result.message || `Python ${version} 已删除`);
        await fetchVersions();
      } else {
        toast.error(result?.message || '删除失败');
      }
    } catch (err) {
      toast.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(null);
    }
  };

  /** 保存 pip 镜像源设置 */
  const handleSavePip = async () => {
    if (!pipValue.trim()) {
      toast.error('镜像源地址不能为空');
      return;
    }
    setPipSaving(true);
    try {
      await updateSettings([{ key: 'python.pipIndexUrl', value: pipValue.trim() }]);
      toast.success('pip 镜像源已保存，即时生效');
      setPipSavedValue(pipValue.trim());
      await fetchEnvironment();
    } catch (err: any) {
      toast.error(err.message || '保存 pip 镜像源失败');
    } finally {
      setPipSaving(false);
    }
  };

  const installedVersions = versions.filter((v) => v.isInstalled);
  const downloadableVersions = versions.filter((v) => !v.isInstalled);
  const pipChanged = pipValue.trim() !== pipSavedValue;

  /** 渲染版本行操作按钮 */
  const renderVersionAction = (v: PythonVersion) => {
    if (!isAdmin) {
      return (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          仅管理员可操作
        </Badge>
      );
    }
    if (v.isInstalled) {
      return (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => setDeleteTarget(v.version)}
          disabled={deleting === v.version || downloading !== null}
          title="删除版本"
        >
          {deleting === v.version ? (
            <LoadingSpinner className="inline-flex py-0" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      );
    }
    return (
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
    );
  };

  /** 渲染版本状态 Badge */
  const renderStatusBadge = (v: PythonVersion) => {
    switch (v.installStatus) {
      case 'installed':
        return (
          <Badge variant="default" className="text-xs">
            <Check className="h-3 w-3 mr-1" />可用
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="secondary" className="text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />部分安装
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />安装异常
          </Badge>
        );
      default:
        return downloading === v.version ? (
          <Badge variant="secondary" className="text-xs">下载中</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">未安装</Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Terminal className="h-6 w-6" />脚本运行环境
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={loadAll}
          disabled={envLoading || versionsLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${envLoading || versionsLoading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">环境概览</TabsTrigger>
          <TabsTrigger value="versions">版本管理</TabsTrigger>
          <TabsTrigger value="pip">pip 镜像源</TabsTrigger>
        </TabsList>

        {/* ── 环境概览 ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {envLoading && !envInfo ? (
            <LoadingSpinner text="探测 Python 环境中..." className="py-16" />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <EnvCard
                  title="内嵌 Python"
                  description="应用自带的嵌入式 Python，无需安装即可运行脚本"
                  icon={Box}
                  probe={envInfo?.embedded}
                />
                <EnvCard
                  title="系统 Python"
                  description="操作系统 PATH 中的 Python，作为最后的备选运行时"
                  icon={Globe}
                  probe={envInfo?.system}
                />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Link2 className="h-4 w-4" />运行时解析顺序
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>脚本实际运行时按以下优先级选择 Python 解释器：</p>
                  <p className="font-mono text-xs bg-muted/50 rounded-md px-3 py-2">
                    脚本专属 venv → 内嵌 Python → 系统 Python
                  </p>
                  <p>
                    当前 pip 镜像源：
                    <span className="font-mono text-xs ml-1">{envInfo?.pipIndexUrl ?? '—'}</span>
                    （可在「pip 镜像源」页签中修改）
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── 版本管理 ── */}
        <TabsContent value="versions" className="mt-4 space-y-4">
          {/* 下载进度 */}
          {downloading && downloadProgress && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <LoadingSpinner className="inline-flex py-0" />
                  <span className="text-sm font-medium">正在下载 Python {downloading}</span>
                </div>
                <Progress value={downloadProgress.progress} className="h-2 mb-2" />
                <p className="text-xs text-muted-foreground">{downloadProgress.message}</p>
              </CardContent>
            </Card>
          )}

          {/* 已安装版本 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">已安装版本</CardTitle>
              <CardDescription>已下载到本机、可被脚本使用的 Python 版本</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {versionsLoading ? (
                <LoadingSpinner text="加载中..." className="py-8" />
              ) : installedVersions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  暂无已安装版本，可在下方「可下载版本」中下载
                </p>
              ) : (
                installedVersions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">Python {v.version}</span>
                        <Badge variant="outline" className="text-xs">{v.majorVersion}</Badge>
                        {renderStatusBadge(v)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {v.fileSize ? `大小: ${formatSize(v.fileSize)}` : ''}
                        {v.installedAt ? ` · 安装日期: ${new Date(v.installedAt).toLocaleDateString('zh-CN')}` : ''}
                        {` · pip: ${v.pipAvailable ? '✓' : '✗'} · virtualenv: ${v.virtualenvAvailable ? '✓' : '✗'}`}
                      </p>
                      {v.error && <p className="text-xs text-destructive mt-1">{v.error}</p>}
                    </div>
                    {renderVersionAction(v)}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* 可下载版本 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">可下载版本</CardTitle>
              <CardDescription>
                支持 Python 3.6 至 3.14，下载自 python.org，首次下载可能需要几分钟
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {versionsLoading ? (
                <LoadingSpinner text="加载中..." className="py-8" />
              ) : downloadableVersions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">所有可用版本均已安装</p>
              ) : (
                downloadableVersions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">Python {v.version}</span>
                      <Badge variant="outline" className="text-xs">{v.majorVersion}</Badge>
                      {renderStatusBadge(v)}
                    </div>
                    {renderVersionAction(v)}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── pip 镜像源 ── */}
        <TabsContent value="pip" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4" />pip 镜像源配置
              </CardTitle>
              <CardDescription>
                pip install 使用的 PyPI 镜像源地址，影响依赖安装与 Python 版本下载时的 pip 初始化，保存后即时生效
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pip-index-url">镜像源地址</Label>
                <Input
                  id="pip-index-url"
                  value={pipValue}
                  onChange={(e) => setPipValue(e.target.value)}
                  placeholder="https://pypi.tuna.tsinghua.edu.cn/simple"
                  disabled={!isAdmin}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  当前生效值：<span className="font-mono">{envInfo?.pipIndexUrl ?? '—'}</span>
                  {!isAdmin && '（仅管理员可修改）'}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSavePip} disabled={!pipChanged || pipSaving}>
                    <Save className="h-4 w-4 mr-1" />
                    {pipSaving ? '保存中...' : '保存'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPipValue(pipSavedValue)}
                    disabled={!pipChanged || pipSaving}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />重置
                  </Button>
                </div>
              )}
              <div className="p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  <AlertCircle className="h-3 w-3 inline-block mr-1" />
                  常用镜像源：清华 https://pypi.tuna.tsinghua.edu.cn/simple ；
                  阿里云 https://mirrors.aliyun.com/pypi/simple/ ；
                  官方 https://pypi.org/simple
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`删除 Python ${deleteTarget ?? ''}`}
        description={`确定要删除 Python ${deleteTarget ?? ''} 吗？删除后使用该版本的脚本将回退到内嵌 Python 运行，此操作不可撤销。`}
        onConfirm={handleDeleteConfirm}
        confirmText="删除"
        destructive
      />
    </div>
  );
}
