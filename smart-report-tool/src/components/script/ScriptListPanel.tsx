import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { getApiUrl, fetchWithAuth, downloadFile } from '@/services/api';
import { canAccess } from '@/utils/permissions';
import { Script } from '@/types';
import { formatFileSize, formatDateShort } from '@/utils/formatters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchFilter } from '@/components/common/SearchFilter';
import { EmptyState } from '@/components/common/EmptyState';
import { toast } from 'sonner';
import { Loader2, Check, PackageCheck, AlertCircle, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { AuxFileList } from './AuxFileList';
import { InstallDepsDialog } from './InstallDepsDialog';
import { SCRIPT_TYPE_LABELS, LOG_CATEGORY_LABELS, REGION_LIST, isDepsStatusDone } from './constants';

export interface ScriptListPanelProps {
  /** 点击编辑脚本（由页面打开编辑对话框） */
  onEditScript: (script: Script) => void;
}

export function ScriptListPanel({ onEditScript }: ScriptListPanelProps) {
  const { user } = useAuthStore();
  const { scripts, fetchScripts } = useScriptStore();
  const { docTemplates } = useDocTemplateStore();
  const canManage = canAccess(user?.role, 'scripts');
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('全部');
  const [categoryFilter, setCategoryFilter] = useState<string>('全部');
  // 辅助文件展开状态（按脚本 id）
  const [expandedAux, setExpandedAux] = useState<Record<string, boolean>>({});

  // 判断当前用户是否能编辑/删除指定脚本（senior 只能操作自己区域的）
  const canEditScript = (script: Script): boolean => {
    if (!canManage) return false;
    if (user?.role === 'admin') return true;
    // senior: 只能编辑自己区域的脚本
    if (user?.role === 'senior') {
      const userRegion = user.region || '全部';
      const scriptRegion = script.region || '全部';
      return userRegion === '全部' || scriptRegion === '全部' || scriptRegion === userRegion;
    }
    return false;
  };

  // 依赖安装状态
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'done' | 'failed'>('idle');
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [installingScriptId, setInstallingScriptId] = useState<string | null>(null);
  const installAbortRef = useRef<AbortController | null>(null);

  // Version selector state
  const [versionSelections, setVersionSelections] = useState<Record<string, string>>({});

  // 巡检工具打包下载中的脚本 id
  const [downloadingToolsId, setDownloadingToolsId] = useState<string | null>(null);

  /** 一键下载巡检工具（tar.gz），注意阻止卡片点击进入编辑 */
  const handleDownloadTools = async (e: React.MouseEvent, sel: Script) => {
    e.stopPropagation();
    if (downloadingToolsId) return;
    setDownloadingToolsId(sel.id);
    try {
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
      const safeName = (sel.name || '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').trim() || 'script';
      await downloadFile(`/scripts/${sel.id}/tools-download`, `${safeName}_巡检工具_${dateStr}.tar.gz`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载巡检工具失败');
    } finally {
      setDownloadingToolsId(null);
    }
  };

  // Group scripts by name, sort versions — normalize old data
  const scriptGroups = useMemo(() => {
    const map = new Map<string, Script[]>();
    for (const raw of scripts) {
      // Normalize old records: migrate templateId→templateIds, ensure auxiliaryFiles
      const s: Script = {
        ...raw,
        isMultiFile: raw.isMultiFile || false,
        templateIds: raw.templateIds || ((raw as unknown as { templateId?: string }).templateId ? [(raw as unknown as { templateId: string }).templateId] : []),
        auxiliaryFiles: raw.auxiliaryFiles || [],
        toolFiles: raw.toolFiles || [],
      };
      const existing = map.get(s.name) || [];
      existing.push(s);
      map.set(s.name, existing);
    }
    // Sort each group by version desc, and overall by latest uploadedAt
    const groups = Array.from(map.entries()).map(([name, items]) => {
      items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      return { name, items };
    });
    groups.sort((a, b) => b.items[0].uploadedAt.localeCompare(a.items[0].uploadedAt));
    return groups;
  }, [scripts]);

  // Init version selections
  useEffect(() => {
    const sel: Record<string, string> = {};
    for (const g of scriptGroups) {
      if (!versionSelections[g.name]) sel[g.name] = g.items[0].id;
    }
    if (Object.keys(sel).length > 0) setVersionSelections((prev) => ({ ...prev, ...sel }));
  }, [scriptGroups]);

  const getSelectedScript = (group: { name: string; items: Script[] }): Script | undefined => {
    const selId = versionSelections[group.name];
    return group.items.find((s) => s.id === selId) || group.items[0];
  };

  const filteredGroups = (() => {
    let result = scriptGroups.filter((g) => {
      if (searchQuery && !g.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (categoryFilter !== '全部') {
        const sel = getSelectedScript(g);
        if (!sel || sel.category !== categoryFilter) return false;
      }
      if (regionFilter !== '全部') {
        const sel = getSelectedScript(g);
        if (!sel || (sel.region || '全部') !== regionFilter) return false;
      }
      return true;
    });

    // 区域排序：匹配用户区域的排最前
    if (user?.role && user.role !== 'admin') {
      const userRegion = user.region || '全部';
      result = [...result].sort((a, b) => {
        const sa = getSelectedScript(a);
        const sb = getSelectedScript(b);
        const ra = sa?.region || '全部';
        const rb = sb?.region || '全部';
        const aMatch = userRegion === '全部' || ra === '全部' || ra === userRegion;
        const bMatch = userRegion === '全部' || rb === '全部' || rb === userRegion;
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    }

    return result;
  })();

  /** 启动依赖安装（SSE 流式） */
  const handleInstallDeps = (scriptId: string) => {
    // Abort previous install
    installAbortRef.current?.abort();
    const controller = new AbortController();
    installAbortRef.current = controller;

    setInstallingScriptId(scriptId);
    setInstallLogs([]);
    setInstallStatus('installing');
    setShowInstallDialog(true);

    const url = getApiUrl(`/scripts/${scriptId}/install-deps`);

    // 标记是否从 SSE 收到了最终状态
    let receivedFinalStatus = false;

    // 用 fetchWithAuth + 读取流来实现 SSE（支持 POST 方法并自动注入 token）
    fetchWithAuth(url, { method: 'POST', signal: controller.signal }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '网络错误' }));
        setInstallLogs((prev) => [...prev, `❌ 请求失败: ${(err as any).error}`]);
        setInstallStatus('failed');
        receivedFinalStatus = true;
        return;
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
              if (data.status === 'done' || data.status === 'failed') {
                receivedFinalStatus = true;
              }
              if (data.status) setInstallStatus(data.status);
              if (data.message) setInstallLogs((prev) => [...prev, data.message]);
              if (data.error && data.status === 'failed') {
                setInstallLogs((prev) => [...prev, `❌ ${data.error}`]);
              }
            } catch {}
          }
        }
      }
      // flush
      if (buffer.startsWith('data:')) {
        try {
          const data = JSON.parse(buffer.slice(5).trim());
          if (data.status === 'done' || data.status === 'failed') {
            receivedFinalStatus = true;
          }
          if (data.status) setInstallStatus(data.status);
        } catch {}
      }
    }).catch((err) => {
      if (err.name === 'AbortError') return;
      setInstallLogs((prev) => [...prev, `❌ 连接失败: ${err.message}`]);
      setInstallStatus('failed');
      receivedFinalStatus = true;
    }).finally(() => {
      setInstallingScriptId(null);
      // 兜底：如果 SSE 没有传递最终状态，从服务端查询最新 depsStatus
      if (!receivedFinalStatus) {
        fetchWithAuth(getApiUrl(`/scripts/${scriptId}`))
          .then((r) => r.json())
          .then((res) => {
            if (res.code === 200 && res.data?.depsStatus?.status) {
              setInstallStatus(res.data.depsStatus.status);
            }
          })
          .catch(() => {});
      }
      fetchScripts();
    });
  };

  /** 渲染依赖状态 Badge（5 种状态分支） */
  const renderDepsBadge = (sel: Script) => {
    if (sel.scriptType !== 'python') return null;
    // 当前卡片正在安装依赖
    if (installingScriptId === sel.id) {
      return <Badge className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 cursor-pointer" onClick={(e) => { e.stopPropagation(); setShowInstallDialog(true); }}><Loader2 className="h-3 w-3 mr-1 animate-spin" />正在安装依赖</Badge>;
    }
    const ds = sel.depsStatus;
    const hasReqs = (sel.requirements?.length || 0) > 0;
    // 无依赖时：venv 存在即认为已就绪
    if (!hasReqs) {
      if (ds?.status === 'done' || ds?.status === 'env_ready') {
        return <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-200"><Check className="h-3 w-3 mr-1" />已就绪</Badge>;
      }
      return null;
    }
    if (!ds || ds.status === 'none') {
      return <Badge variant="outline" className="text-xs text-muted-foreground cursor-pointer hover:bg-accent" onClick={(e) => { e.stopPropagation(); handleInstallDeps(sel.id); }}><PackageCheck className="h-3 w-3 mr-1" />环境及依赖未就绪</Badge>;
    }
    if (ds.status === 'env_ready') {
      return <Badge variant="outline" className="text-xs text-orange-600 border-orange-200 bg-orange-50 cursor-pointer hover:bg-orange-100" onClick={(e) => { e.stopPropagation(); handleInstallDeps(sel.id); }}><PackageCheck className="h-3 w-3 mr-1" />依赖未就绪</Badge>;
    }
    if (ds.status === 'installing') return <Badge className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 cursor-pointer" onClick={(e) => { e.stopPropagation(); setShowInstallDialog(true); }}><Loader2 className="h-3 w-3 mr-1 animate-spin" />正在安装依赖</Badge>;
    if (isDepsStatusDone(ds.status)) return <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-200"><Check className="h-3 w-3 mr-1" />已就绪</Badge>;
    if (ds.status === 'failed') return <Badge variant="destructive" className="text-xs cursor-pointer" onClick={(e) => { e.stopPropagation(); handleInstallDeps(sel.id); }}><AlertCircle className="h-3 w-3 mr-1" />安装失败</Badge>;
    return null;
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <SearchFilter value={searchQuery} onChange={setSearchQuery} placeholder="搜索脚本名称..." className="flex-1 max-w-sm" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-28 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="全部">全部分类</SelectItem>
            {Object.entries(LOG_CATEGORY_LABELS).map(([k, label]) => (<SelectItem key={k} value={k}>{label}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-32 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{REGION_LIST.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      {filteredGroups.length === 0 ? (
        <EmptyState title="暂无脚本" description="点击右上角「上传脚本」开始使用" />
      ) : (
        <div className="space-y-2">
          {filteredGroups.map((group) => {
            const sel = getSelectedScript(group);
            if (!sel) return null;
            const linkedTpls = docTemplates.filter((t) => sel.templateIds.includes(t.id));
            // 元信息行：Python 版本 · 入口文件+大小 · 上传日期 · 上传者
            const metaItems: string[] = [];
            if (sel.scriptType === 'python' && sel.pythonVersion && sel.pythonVersion !== 'embedded') {
              metaItems.push(`Python ${sel.pythonVersion}`);
            }
            metaItems.push(`${sel.fileName}（${formatFileSize(sel.fileSize)}）`);
            metaItems.push(formatDateShort(sel.uploadedAt));
            if (sel.uploaderName && sel.uploaderName !== 'unknown') metaItems.push(sel.uploaderName);
            return (
              <Card key={group.name} className={canEditScript(sel) ? 'cursor-pointer hover:shadow-md hover:border-primary/30 transition-all' : ''} onClick={() => { if (canEditScript(sel)) onEditScript(sel); }}>
                <CardContent className="p-3">
                  {/* 头部行：名称+版本 | 类型/分类/区域/依赖状态 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-base truncate">{group.name}</span>
                      {group.items.length > 1 ? (
                        <Select value={sel.id} onValueChange={(v) => setVersionSelections({ ...versionSelections, [group.name]: v })}>
                          <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground shadow-none" onClick={(e) => e.stopPropagation()}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {group.items.map((s) => (
                              <SelectItem key={s.id} value={s.id}>v{s.version}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm text-muted-foreground shrink-0">v{sel.version}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary">{SCRIPT_TYPE_LABELS[sel.scriptType]}</Badge>
                      <Badge variant="outline">{LOG_CATEGORY_LABELS[sel.category]}</Badge>
                      {sel.region && sel.region !== '全部' && <Badge variant="outline" className="text-xs">{sel.region}</Badge>}
                      {renderDepsBadge(sel)}
                      {/* 一键下载巡检工具（有工具文件时显示，阻止冒泡避免触发卡片编辑） */}
                      {sel.toolFiles.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={downloadingToolsId === sel.id}
                          onClick={(e) => handleDownloadTools(e, sel)}
                        >
                          {downloadingToolsId === sel.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3 mr-1" />
                          )}
                          {downloadingToolsId === sel.id ? '打包中...' : `巡检工具（${sel.toolFiles.length}）`}
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* 描述行（可选，一行截断） */}
                  {sel.description && (
                    <p className="text-sm text-muted-foreground truncate mt-1">{sel.description}</p>
                  )}
                  {/* 元信息行 */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap mt-1">
                    {metaItems.map((item, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="text-muted-foreground/50">·</span>}
                        <span>{item}</span>
                      </Fragment>
                    ))}
                  </div>
                  {/* 关联模板 Badge 行（可选） */}
                  {sel.templateRequired && linkedTpls.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1.5">
                      {linkedTpls.map((t) => (
                        <Badge key={t.id} variant="secondary" className="text-xs">模板：{t.name}</Badge>
                      ))}
                    </div>
                  )}
                  {/* 辅助文件（折叠式，默认收起） */}
                  {sel.auxiliaryFiles.length > 0 && (
                    <div className="mt-2">
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); setExpandedAux((prev) => ({ ...prev, [sel.id]: !prev[sel.id] })); }}
                      >
                        {expandedAux[sel.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        辅助文件（{sel.auxiliaryFiles.length}）
                      </button>
                      {expandedAux[sel.id] && (
                        <div className="mt-2">
                          <AuxFileList files={sel.auxiliaryFiles} />
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ═════ 依赖安装进度弹窗 ═════ */}
      <InstallDepsDialog
        open={showInstallDialog}
        onOpenChange={(open) => { setShowInstallDialog(open); if (!open) { setInstallStatus('idle'); setInstallLogs([]); } }}
        installStatus={installStatus}
        installLogs={installLogs}
      />
    </>
  );
}
