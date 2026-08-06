import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Plus, Pencil, Trash2, Star, Download, Server, Zap, Loader2, ScrollText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ProviderDialog } from '@/components/ai/settings/ProviderDialog';
import { ModelDialog } from '@/components/ai/settings/ModelDialog';
import { FetchModelsDialog } from '@/components/ai/settings/FetchModelsDialog';
import { UsagePanel } from '@/components/ai/settings/UsagePanel';
import { CallLogsDialog } from '@/components/ai/settings/CallLogsDialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  listProviders, deleteProvider, toggleProvider,
  listModels, deleteModel, toggleModel, setDefaultModel, testModel,
  fetchUsage, migrateLegacyConfig,
  type AIProvider, type AIModel, type UsageStats,
} from '@/services/aiConfigService';
import { useAIConfigStore } from '@/stores/aiConfigStore';

/** 配置变更后同步全局 AI 配置缓存，使其他页面切回时即为最新状态 */
const syncAIConfigStore = () => {
  useAIConfigStore.getState().refreshResolved().catch(() => {});
};

export default function AISettingsPage() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [models, setModels] = useState<AIModel[]>([]);
  const [allModels, setAllModels] = useState<AIModel[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);

  // 弹窗开关与编辑目标
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [fetchDialogOpen, setFetchDialogOpen] = useState(false);
  const [callLogsOpen, setCallLogsOpen] = useState(false);

  // 删除确认
  const [deleteProviderTarget, setDeleteProviderTarget] = useState<AIProvider | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<AIModel | null>(null);

  // 模型可用性测试进行中的模型 ID
  const [testingModelId, setTestingModelId] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  /** 用量统计中 model_id（数据库 ID）→ 显示名 */
  const modelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of allModels) map.set(m.id, m.displayName || m.modelId);
    return map;
  }, [allModels]);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await fetchUsage());
    } catch (err: any) {
      toast.error(err.message || '获取用量统计失败');
    }
  }, []);

  const loadModels = useCallback(async (providerId: string) => {
    setModelsLoading(true);
    try {
      setModels(await listModels(providerId));
    } catch (err: any) {
      toast.error(err.message || '获取模型列表失败');
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async (keepSelection = true) => {
    try {
      const list = await listProviders();
      setProviders(list);
      // 拉取全部厂商模型，用于用量统计的模型名映射
      const modelGroups = await Promise.all(
        list.map((p) => listModels(p.id).catch(() => [] as AIModel[]))
      );
      setAllModels(modelGroups.flat());
      setSelectedProviderId((prev) => {
        if (keepSelection && prev && list.some((p) => p.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
      syncAIConfigStore();
    } catch (err: any) {
      toast.error(err.message || '获取厂商列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 用户可能直接打开 AI 设置页（不经过助手/分析页），这里也触发一次旧
    // localStorage 配置迁移，迁移完成（如有）后再拉取厂商列表
    (async () => {
      await migrateLegacyConfig().catch(() => false);
      loadProviders();
      loadUsage();
    })();
  }, [loadProviders, loadUsage]);

  useEffect(() => {
    if (selectedProviderId) loadModels(selectedProviderId);
    else setModels([]);
  }, [selectedProviderId, loadModels]);

  /** 模型变更后刷新：重载当前厂商模型 + 厂商列表（模型计数/映射） */
  const reloadModelsAndProviders = useCallback(async () => {
    if (selectedProviderId) await loadModels(selectedProviderId);
    await loadProviders();
  }, [selectedProviderId, loadModels, loadProviders]);

  // ═══════════════════════════════════════════════════════
  //  厂商操作
  // ═══════════════════════════════════════════════════════

  const openAddProvider = () => {
    setEditingProvider(null);
    setProviderDialogOpen(true);
  };

  const openEditProvider = (p: AIProvider) => {
    setEditingProvider(p);
    setProviderDialogOpen(true);
  };

  const handleToggleProvider = async (p: AIProvider, enabled: boolean) => {
    try {
      await toggleProvider(p.id, enabled);
      toast.success(enabled ? `已启用「${p.name}」` : `已停用「${p.name}」`);
      await loadProviders();
    } catch (err: any) {
      toast.error(err.message || '厂商状态切换失败');
    }
  };

  const handleDeleteProvider = async () => {
    if (!deleteProviderTarget) return;
    try {
      await deleteProvider(deleteProviderTarget.id);
      toast.success(`已删除厂商「${deleteProviderTarget.name}」`);
      setDeleteProviderTarget(null);
      await loadProviders(false);
    } catch (err: any) {
      toast.error(err.message || '删除厂商失败');
    }
  };

  // ═══════════════════════════════════════════════════════
  //  模型操作
  // ═══════════════════════════════════════════════════════

  const openAddModel = () => {
    setEditingModel(null);
    setModelDialogOpen(true);
  };

  const openEditModel = (m: AIModel) => {
    setEditingModel(m);
    setModelDialogOpen(true);
  };

  const handleToggleModel = async (m: AIModel, enabled: boolean) => {
    try {
      await toggleModel(m.id, enabled);
      toast.success(enabled ? `已启用「${m.displayName}」` : `已停用「${m.displayName}」`);
      if (selectedProviderId) await loadModels(selectedProviderId);
      syncAIConfigStore();
    } catch (err: any) {
      toast.error(err.message || '模型状态切换失败');
    }
  };

  const handleSetDefault = async (m: AIModel) => {
    try {
      await setDefaultModel(m.id);
      toast.success(`已将「${m.displayName}」设为默认模型`);
      if (selectedProviderId) await loadModels(selectedProviderId);
      syncAIConfigStore();
    } catch (err: any) {
      toast.error(err.message || '设置默认模型失败');
    }
  };

  const handleDeleteModel = async () => {
    if (!deleteModelTarget) return;
    try {
      await deleteModel(deleteModelTarget.id);
      toast.success(`已删除模型「${deleteModelTarget.displayName}」`);
      setDeleteModelTarget(null);
      await reloadModelsAndProviders();
    } catch (err: any) {
      toast.error(err.message || '删除模型失败');
    }
  };

  /** 测试模型可用性：发送最小对话请求，toast 展示耗时与回复摘要 */
  const handleTestModel = async (m: AIModel) => {
    setTestingModelId(m.id);
    try {
      const result = await testModel(m.id);
      if (result.ok) {
        toast.success(`「${m.displayName}」测试通过`, {
          description: `耗时 ${((result.latencyMs ?? 0) / 1000).toFixed(1)}s${result.reply ? ` · 回复：${result.reply}` : ''}`,
          duration: 6000,
        });
      } else {
        toast.error(`「${m.displayName}」测试失败`, {
          description: `${result.error || '未知错误'}${result.latencyMs != null ? `（耗时 ${(result.latencyMs / 1000).toFixed(1)}s）` : ''}`,
          duration: 8000,
        });
      }
    } catch (err: any) {
      toast.error(`「${m.displayName}」测试失败`, { description: err.message || '请求失败', duration: 8000 });
    } finally {
      setTestingModelId(null);
    }
  };

  // ═══════════════════════════════════════════════════════
  //  渲染
  // ═══════════════════════════════════════════════════════

  if (loading) {
    return <LoadingSpinner text="加载中..." className="py-16" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6" />AI设置
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline">管理你的 AI 厂商、模型与用量</Badge>
          <Button variant="outline" size="sm" onClick={() => setCallLogsOpen(true)}>
            <ScrollText className="h-4 w-4 mr-1" />调用记录
          </Button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        {/* 左列：厂商卡片列表 */}
        <div className="w-72 shrink-0 space-y-3">
          <Button className="w-full" onClick={openAddProvider}>
            <Plus className="h-4 w-4 mr-1" />添加厂商
          </Button>

          {providers.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                还没有配置厂商，点击上方按钮添加
              </CardContent>
            </Card>
          )}

          {providers.map((p) => (
            <Card
              key={p.id}
              onClick={() => setSelectedProviderId(p.id)}
              className={cn(
                'cursor-pointer transition-colors',
                selectedProviderId === p.id
                  ? 'border-primary ring-1 ring-primary'
                  : 'hover:border-primary/50',
                !p.enabled && 'opacity-60'
              )}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate" title={p.name}>{p.name}</span>
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(v) => handleToggleProvider(p, v)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{p.vendorName}</Badge>
                  <span className="text-xs text-muted-foreground">{p.modelCount ?? 0} 个模型</span>
                </div>
                <p className="text-xs text-muted-foreground truncate" title={p.baseUrl}>
                  {p.baseUrl || '（默认地址）'}
                </p>
                <p className="text-xs text-muted-foreground font-mono">Key: {p.apiKeyMasked}</p>
                <div className="flex justify-end gap-1 pt-1">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); openEditProvider(p); }}
                    title="编辑厂商"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeleteProviderTarget(p); }}
                    title="删除厂商"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 右列：模型管理 + 用量统计 */}
        <div className="flex-1 min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="h-5 w-5" />
                模型管理{selectedProvider ? `（${selectedProvider.name}）` : ''}
              </CardTitle>
              {selectedProvider && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setFetchDialogOpen(true)}>
                    <Download className="h-4 w-4 mr-1" />拉取模型列表
                  </Button>
                  <Button size="sm" onClick={openAddModel}>
                    <Plus className="h-4 w-4 mr-1" />手动添加
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!selectedProvider ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  请先在左侧选择或添加一个厂商
                </p>
              ) : modelsLoading ? (
                <LoadingSpinner text="模型加载中..." />
              ) : models.length === 0 ? (
                <EmptyState
                  title="该厂商下暂无模型"
                  description="点击「拉取模型列表」或「手动添加」"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>显示名</TableHead>
                      <TableHead>模型 ID</TableHead>
                      <TableHead>温度</TableHead>
                      <TableHead>输入上限</TableHead>
                      <TableHead>输出上限</TableHead>
                      <TableHead>默认</TableHead>
                      <TableHead>启用</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {models.map((m) => (
                      <TableRow key={m.id} className={cn(!m.enabled && 'opacity-60')}>
                        <TableCell className="font-medium">{m.displayName}</TableCell>
                        <TableCell className="font-mono text-xs">{m.modelId}</TableCell>
                        <TableCell>{m.temperature}</TableCell>
                        <TableCell>{m.maxInputTokens.toLocaleString()}</TableCell>
                        <TableCell>{m.maxOutputTokens.toLocaleString()}</TableCell>
                        <TableCell>
                          {m.isDefault ? (
                            <Badge className="gap-1"><Star className="h-3 w-3" />默认</Badge>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleSetDefault(m)}>
                              设为默认
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch checked={m.enabled} onCheckedChange={(v) => handleToggleModel(m, v)} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => handleTestModel(m)}
                            disabled={testingModelId !== null}
                            title="测试模型可用性"
                          >
                            {testingModelId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Zap className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditModel(m)} title="编辑模型">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteModelTarget(m)} title="删除模型"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* 用量统计 */}
          <UsagePanel
            usage={usage}
            modelNameMap={modelNameMap}
            providerModelIds={models.map((m) => m.id)}
            providerName={selectedProvider?.name ?? null}
            onRefresh={loadUsage}
          />
        </div>
      </div>

      {/* 弹窗 1：添加/编辑厂商 */}
      <ProviderDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        editingProvider={editingProvider}
        onSaved={() => loadProviders()}
      />

      {/* 弹窗 2：添加/编辑模型 */}
      <ModelDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        providerId={selectedProviderId}
        editingModel={editingModel}
        onSaved={reloadModelsAndProviders}
      />

      {/* 弹窗 3：拉取模型列表（勾选导入） */}
      <FetchModelsDialog
        open={fetchDialogOpen}
        onOpenChange={setFetchDialogOpen}
        providerId={selectedProviderId}
        onImported={reloadModelsAndProviders}
      />

      {/* 弹窗 4：调用记录（请求体查看 + 报告消耗） */}
      <CallLogsDialog
        open={callLogsOpen}
        onOpenChange={setCallLogsOpen}
        modelNameMap={modelNameMap}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteProviderTarget}
        onOpenChange={(open) => { if (!open) setDeleteProviderTarget(null); }}
        title="删除厂商"
        description={`确定删除厂商「${deleteProviderTarget?.name}」吗？其下所有模型将一并删除，此操作不可恢复。`}
        onConfirm={handleDeleteProvider}
        confirmText="删除"
        destructive
      />
      <ConfirmDialog
        open={!!deleteModelTarget}
        onOpenChange={(open) => { if (!open) setDeleteModelTarget(null); }}
        title="删除模型"
        description={`确定删除模型「${deleteModelTarget?.displayName}」吗？`}
        onConfirm={handleDeleteModel}
        confirmText="删除"
        destructive
      />
    </div>
  );
}
