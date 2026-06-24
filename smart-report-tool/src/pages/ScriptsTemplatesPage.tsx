import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { apiPost, getApiUrl, fetchWithAuth, downloadFile } from '@/services/api';
import { canAccess } from '@/utils/permissions';
import { Script, ScriptType, ScriptRegion, DocTemplate, DocTemplateType, AuxFile, LogCategory } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { FileUploader, getFilePath } from '@/components/common/FileUploader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchFilter } from '@/components/common/SearchFilter';
import { EmptyState } from '@/components/common/EmptyState';
import { toast } from 'sonner';
import { Trash2, Plus, Pencil, File, Upload, PackageOpen, Download, Search, Check, X as XIcon, Loader2, PackageCheck, AlertCircle } from 'lucide-react';
import { ScriptEditor } from '@/components/script/ScriptEditor';
import { ScriptFileCard } from '@/components/script/ScriptFileCard';
import { AuxFileList } from '@/components/script/AuxFileList';
import { InstallDepsDialog } from '@/components/script/InstallDepsDialog';
import { TemplatePicker } from '@/components/template/TemplatePicker';

type SCRIPT_TYPE_LABELS = Record<ScriptType, string>;
const SCRIPT_TYPE_LABELS: SCRIPT_TYPE_LABELS = { python: 'Python', bat: 'BAT', ps1: 'PowerShell', sh: 'Shell', powershell: 'PowerShell 7' };
const LOG_CATEGORY_LABELS: Record<LogCategory, string> = { host: '主机', storage: '存储', database: '数据库', virtualization: '虚拟化', network: '网络' };
const REGION_LIST: ScriptRegion[] = ['全部', '华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];
const INPUT_FORMAT_SUGGESTIONS = ['doc', 'docx', 'xlsx', 'txt', 'log', 'html'];

const emptyMeta = () => ({ name: '', description: '', scriptType: 'python' as ScriptType, region: '全部' as ScriptRegion, inputFormats: '', inputFormatManual: false, version: '1.0.0', category: 'host' as LogCategory, templateRequired: false, templateIds: [] as string[], auxiliaryFiles: [] as AuxFile[], requirements: [] as string[] });

/** 判断依赖是否已就绪（兼容后端旧数据 'success' 和新数据 'done'） */
function isDepsStatusDone(status?: string): boolean {
  return status === 'done' || status === 'success';
}

export default function ScriptsTemplatesPage() {
  const { user } = useAuthStore();
  const { scripts, fetchScripts, updateScript, removeScript } = useScriptStore();
  const { docTemplates, fetchDocTemplates, removeDocTemplate, updateDocTemplateWithFile } = useDocTemplateStore();
  const canManage = canAccess(user?.role, 'scripts');
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('全部');

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

  // Dialogs
  const [showScriptUpload, setShowScriptUpload] = useState(false);
  const [showTplUpload, setShowTplUpload] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<Script | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);
  const [deleteTplTarget, setDeleteTplTarget] = useState<DocTemplate | null>(null);
  const [showTplEdit, setShowTplEdit] = useState(false);
  const [editTplTarget, setEditTplTarget] = useState<DocTemplate | null>(null);
  const [tplReuploadFile, setTplReuploadFile] = useState<File[]>([]);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  // Script editor
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [editorTarget, setEditorTarget] = useState<{ id: string; fileName: string } | null>(null);
  const [selectedAuxKeys, setSelectedAuxKeys] = useState<Set<string>>(new Set());
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // 隐藏的脚本文件 input ref，替换按钮直接触发
  const scriptFileInputRef = useRef<HTMLInputElement>(null);

  // 依赖安装状态
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'done' | 'failed'>('idle');
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [installingScriptId, setInstallingScriptId] = useState<string | null>(null);
  const installAbortRef = useRef<AbortController | null>(null);

  // 依赖管理弹窗
  const [showDepsManager, setShowDepsManager] = useState(false);
  const [depsEditList, setDepsEditList] = useState<string[]>([]);
  const [depsNewPkg, setDepsNewPkg] = useState('');

  /** 打开依赖管理弹窗 */
  const openDepsManager = () => {
    setDepsEditList([...parseRequirements()]);
    setDepsNewPkg('');
    setShowDepsManager(true);
  };

  /** 保存依赖管理 */
  const saveDepsManager = () => {
    setRequirementsText(depsEditList.filter((d) => d.trim()).join('\n'));
    setShowDepsManager(false);
  };

  /** 辅助文件稳定唯一 key：优先 hash，其次 name */
  const auxKey = (af: AuxFile) => (af as AuxFile & { hash?: string }).hash || af.name;
  /** 去重辅助文件：按 key 保留最后一次出现 */
  const dedupeAux = (list: AuxFile[]): AuxFile[] => {
    const seen = new Set<string>();
    return list.filter((af) => {
      const k = auxKey(af);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  // Form state
  const [meta, setMeta] = useState(emptyMeta());
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [auxFiles, setAuxFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [requirementsText, setRequirementsText] = useState('');
  const [isManualInput, setIsManualInput] = useState(false);

  // 从 meta.inputFormatManual 还原手动输入开关状态（从后端数据或默认值）
  useEffect(() => {
    setIsManualInput(meta.inputFormatManual || false);
  }, [meta.inputFormatManual]);

  // Template form
  const [tplMeta, setTplMeta] = useState({ name: '', description: '' });
  const [tplFiles, setTplFiles] = useState<File[]>([]);
  const [tplUploading, setTplUploading] = useState(false);

  // Version selector state
  const [versionSelections, setVersionSelections] = useState<Record<string, string>>({});

  useEffect(() => { fetchScripts(); fetchDocTemplates(); }, [fetchScripts, fetchDocTemplates]);

  // Group scripts by name, sort versions — normalize old data
  const scriptGroups = useMemo(() => {
    const map = new Map<string, Script[]>();
    for (const raw of scripts) {
      // Normalize old records: migrate templateId→templateIds, ensure auxiliaryFiles
      const s: Script = {
        ...raw,
        templateIds: raw.templateIds || ((raw as unknown as { templateId?: string }).templateId ? [(raw as unknown as { templateId: string }).templateId] : []),
        auxiliaryFiles: raw.auxiliaryFiles || [],
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

  // ── Open dialogs ──
  const openUpload = () => { setMeta(emptyMeta()); setUploadFiles([]); setAuxFiles([]); setRequirementsText(''); setShowScriptUpload(true); };
  const openEdit = (script: Script) => {
    setEditTarget(script);
    setMeta({ name: script.name, description: script.description, scriptType: script.scriptType, region: script.region || '全部', inputFormats: script.inputFormats || '', inputFormatManual: script.inputFormatManual || false, version: script.version, category: script.category, templateRequired: script.templateRequired, templateIds: [...script.templateIds], auxiliaryFiles: dedupeAux([...script.auxiliaryFiles]), requirements: script.requirements || [] });
    setRequirementsText((script.requirements || []).join('\n'));
    setUploadFiles([]);
    setAuxFiles([]);
    setSelectedAuxKeys(new Set());
    setShowEdit(true);
  };

  const openScriptEditor = (scriptId: string, fileName: string) => {
    setEditorTarget({ id: scriptId, fileName });
    setShowScriptEditor(true);
  };

  // ── Helpers ──

  /** 解析 requirements 文本为包名数组 */
  const parseRequirements = (): string[] => {
    return requirementsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));
  };

  /** 从 requirements.txt 文件导入依赖包 */
  const handleImportRequirements = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRequirementsText(text);
      // 同步刷新弹窗内列表，使导入后立即可见
      const imported = text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('#'));
      setDepsEditList(imported);
      toast.success(`已从 ${file.name} 导入依赖配置`);
    } catch {
      toast.error('读取文件失败');
    }
    e.target.value = '';
  };

  // ── Upload script ──
  /** 校验巡检数据格式 — 前后端双重校验 */
  const validateInputFormats = (value: string): string | null => {
    if (!value || !value.trim()) return null;
    if (value.trim().length > 200) return '巡检数据格式不能超过200个字符';
    const parts = value.trim().split(/[,\s]+/).filter(Boolean);
    for (const part of parts) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(part)) {
        return `无效的格式名: "${part}"，仅支持字母、数字和连字符`;
      }
    }
    return null;
  };

  const handleUpload = async () => {
    if (!meta.name.trim()) { toast.error('请填写脚本名称'); return; }
    if (uploadFiles.length === 0) { toast.error('请选择脚本文件'); return; }
    if (meta.templateRequired && meta.templateIds.length === 0) { toast.error('已勾选"需要关联模板"，请至少选择一个模板文件'); return; }
    const fmtError = validateInputFormats(meta.inputFormats);
    if (fmtError) { toast.error(fmtError); return; }
    setUploading(true);
    try {
      const file = uploadFiles[0];
      const formData = new FormData();
      formData.append('name', meta.name.trim());
      formData.append('description', meta.description);
      formData.append('scriptType', meta.scriptType);
      formData.append('region', meta.region);
      formData.append('inputFormats', meta.inputFormats);
      formData.append('inputFormatManual', String(isManualInput));
      formData.append('version', meta.version);
      formData.append('category', meta.category);
      formData.append('templateRequired', String(meta.templateRequired));
      formData.append('templateIds', JSON.stringify(meta.templateRequired ? meta.templateIds : []));
      formData.append('uploadedBy', user?.id || '');
      formData.append('requirements', JSON.stringify(parseRequirements()));
      formData.append('scriptFile', file);
      auxFiles.forEach((af, idx) => {
        formData.append(`auxFile${idx}`, af);
        const relPath = getFilePath(af);
        if (relPath !== af.name) formData.append(`auxPath${idx}`, relPath);
      });
      await apiPost('/scripts', formData);
      setShowScriptUpload(false);
      setMeta(emptyMeta());
      setUploadFiles([]);
      setAuxFiles([]);
      await fetchScripts();
      toast.success('上传成功');
    } catch (e) {
      toast.error(`上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    finally { setUploading(false); }
  };

  // ── Edit script ──
  const handleEdit = async () => {
    if (!editTarget || !meta.name.trim()) { toast.error('请填写脚本名称'); return; }
    if (meta.templateRequired && meta.templateIds.length === 0) { toast.error('已勾选"需要关联模板"，请至少选择一个模板文件'); return; }
    const fmtError = validateInputFormats(meta.inputFormats);
    if (fmtError) { toast.error(fmtError); return; }
    setUploading(true);
    try {
      const hasNewScriptFile = uploadFiles.length > 0;
      const hasNewAuxFiles = auxFiles.length > 0;

      // 如果有新脚本文件或新辅助文件，使用 FormData 上传（含 multer 文件字段）
      if (hasNewScriptFile || hasNewAuxFiles) {
        const formData = new FormData();
        formData.append('name', meta.name.trim());
        formData.append('description', meta.description);
        formData.append('scriptType', meta.scriptType);
        formData.append('version', meta.version);
        formData.append('category', meta.category);
        formData.append('region', meta.region);
        formData.append('inputFormats', meta.inputFormats);
        formData.append('inputFormatManual', String(isManualInput));
        formData.append('templateRequired', String(meta.templateRequired));
        formData.append('templateIds', JSON.stringify(meta.templateRequired ? meta.templateIds : []));
        formData.append('requirements', JSON.stringify(parseRequirements()));
        formData.append('existingAux', JSON.stringify(meta.auxiliaryFiles));

        // 新脚本文件（替换）
        if (hasNewScriptFile) {
          formData.append('scriptFile', uploadFiles[0]);
        }

        // 新辅助文件
        auxFiles.forEach((af, idx) => {
          formData.append(`auxFile${idx}`, af);
          const relPath = getFilePath(af);
          if (relPath !== af.name) formData.append(`auxPath${idx}`, relPath);
        });

        const { updateScriptWithAuxFiles } = useScriptStore.getState();
        await updateScriptWithAuxFiles(editTarget.id, formData);
        setAuxFiles([]);
        setUploadFiles([]);
      } else {
        await updateScript(editTarget.id, {
          name: meta.name.trim(),
          description: meta.description,
          scriptType: meta.scriptType,
          region: meta.region,
          inputFormats: meta.inputFormats,
          inputFormatManual: isManualInput,
          version: meta.version,
          category: meta.category,
          templateRequired: meta.templateRequired,
          templateIds: meta.templateRequired ? meta.templateIds : [],
          requirements: parseRequirements(),
          auxiliaryFiles: meta.auxiliaryFiles,
        });
      }
      setShowEdit(false);
      toast.success('保存成功');
    } catch { toast.error('保存失败'); }
    finally { setUploading(false); }
  };

  // ── Upload template ──
  const handleTplUpload = async () => {
    if (!tplMeta.name.trim()) { toast.error('请填写模板名称'); return; }
    if (tplFiles.length === 0) { toast.error('请选择模板文件'); return; }
    setTplUploading(true);
    try {
      for (const file of tplFiles) {
        const ext = file.name.split('.').pop()?.toLowerCase() as DocTemplateType;
        const formData = new FormData();
        formData.append('name', tplMeta.name.trim());
        formData.append('description', tplMeta.description);
        formData.append('fileType', ext || 'docx');
        formData.append('uploadedBy', user?.id || '');
        formData.append('templateFile', file);
        await apiPost('/templates', formData);
      }
      setShowTplUpload(false);
      setTplMeta({ name: '', description: '' });
      setTplFiles([]);
      await fetchDocTemplates();
      toast.success(`模板上传成功（${tplFiles.length} 个文件）`);
    } catch (e) {
      toast.error(`上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    finally { setTplUploading(false); }
  };

  const handleDelete = async () => {
    if (deleteTarget) { await removeScript(deleteTarget.id); setDeleteTarget(null); toast.success('已删除'); }
  };
  const handleDeleteTpl = async () => {
    if (deleteTplTarget) { await removeDocTemplate(deleteTplTarget.id); setDeleteTplTarget(null); toast.success('已删除'); }
  };

  // ── Template edit ──
  const openTplEdit = (tpl: DocTemplate) => {
    setEditTplTarget(tpl);
    setTplMeta({ name: tpl.name, description: tpl.description || '' });
    setTplReuploadFile([]);
    setShowTplEdit(true);
  };

  const handleTplEdit = async () => {
    if (!editTplTarget || !tplMeta.name.trim()) { toast.error('请填写模板名称'); return; }
    if (tplReuploadFile.length > 0) {
      // 有文件需要覆盖 — 显示确认弹窗
      setShowOverwriteConfirm(true);
      return;
    }
    await saveTplEdit();
  };

  const saveTplEdit = async () => {
    if (!editTplTarget) return;
    try {
      if (tplReuploadFile.length > 0) {
        const formData = new FormData();
        formData.append('name', tplMeta.name.trim());
        formData.append('description', tplMeta.description);
        const file = tplReuploadFile[0];
        const ext = file.name.split('.').pop()?.toLowerCase();
        formData.append('fileType', ext || 'docx');
        formData.append('templateFile', file);
        await updateDocTemplateWithFile(editTplTarget.id, formData);
      } else {
        const { updateDocTemplate } = useDocTemplateStore.getState();
        await updateDocTemplate(editTplTarget.id, { name: tplMeta.name.trim(), description: tplMeta.description });
      }
      setShowTplEdit(false);
      setShowOverwriteConfirm(false);
      toast.success('模板已更新');
    } catch { toast.error('更新失败'); }
  };

  const handleTplDownload = (tpl: DocTemplate) => {
    downloadFile(`/templates/${tpl.id}/download`, tpl.fileName);
  };

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

  // ── Render ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">脚本及模板管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setTplMeta({ name: '', description: '' }); setTplFiles([]); setShowTplUpload(true); }}>
            <Plus className="mr-2 h-4 w-4" />上传模板
          </Button>
          <Button onClick={openUpload}>
            <Plus className="mr-2 h-4 w-4" />上传脚本
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scripts">
        <TabsList>
          <TabsTrigger value="scripts">脚本列表（{scriptGroups.length}）</TabsTrigger>
          <TabsTrigger value="templates">模板列表（{docTemplates.length}）</TabsTrigger>
        </TabsList>

        <TabsContent value="scripts" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <SearchFilter value={searchQuery} onChange={setSearchQuery} placeholder="搜索脚本名称..." />
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="w-32 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{REGION_LIST.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          {filteredGroups.length === 0 ? (
            <EmptyState title="暂无脚本" description="点击右上角「上传脚本」开始使用" />
          ) : (
            <div className="space-y-3">
              {filteredGroups.map((group) => {
                const sel = getSelectedScript(group);
                if (!sel) return null;
                const linkedTpls = docTemplates.filter((t) => sel.templateIds.includes(t.id));
                return (
                  <Card key={group.name}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-lg">{group.name}</span>
                            <Badge variant="secondary">{SCRIPT_TYPE_LABELS[sel.scriptType]}</Badge>
                            <Badge variant="outline">{LOG_CATEGORY_LABELS[sel.category]}</Badge>
                            {sel.region && sel.region !== '全部' && <Badge variant="outline" className="text-xs">{sel.region}</Badge>}
                            {sel.scriptType === 'python' && (
                              (() => {
                                // 当前卡片正在安装依赖
                                if (installingScriptId === sel.id) {
                                  return <Badge className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 cursor-pointer" onClick={() => setShowInstallDialog(true)}><Loader2 className="h-3 w-3 mr-1 animate-spin" />正在安装依赖</Badge>;
                                }
                                const ds = sel.depsStatus;
                                if (!ds || ds.status === 'none') {
                                  return sel.requirements?.length > 0 ? (
                                    <Badge variant="outline" className="text-xs text-muted-foreground cursor-pointer hover:bg-accent" onClick={() => handleInstallDeps(sel.id)}>
                                      <PackageCheck className="h-3 w-3 mr-1" />安装依赖
                                    </Badge>
                                  ) : null;
                                }
                                if (ds.status === 'installing') return <Badge className="text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 cursor-pointer" onClick={() => setShowInstallDialog(true)}><Loader2 className="h-3 w-3 mr-1 animate-spin" />正在安装依赖</Badge>;
                                if (isDepsStatusDone(ds.status)) return <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-200"><Check className="h-3 w-3 mr-1" />已就绪</Badge>;
                                if (ds.status === 'failed') return <Badge variant="destructive" className="text-xs cursor-pointer" onClick={() => handleInstallDeps(sel.id)}><AlertCircle className="h-3 w-3 mr-1" />安装失败</Badge>;
                                return null;
                              })()
                            )}
                            {sel.templateRequired && linkedTpls.length > 0 && linkedTpls.map((t) => (
                              <Badge key={t.id} variant="secondary" className="text-xs">模板：{t.name}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {sel.description || sel.fileName} · {formatFileSize(sel.fileSize)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          {group.items.length > 1 && (
                            <Select value={sel.id} onValueChange={(v) => setVersionSelections({ ...versionSelections, [group.name]: v })}>
                              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {group.items.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>v{s.version}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {group.items.length === 1 && (
                            <Badge variant="secondary" className="text-xs">v{sel.version}</Badge>
                          )}
                          {canEditScript(sel) && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => openEdit(sel)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(sel)}><Trash2 className="h-4 w-4" /></Button>
                            </>
                          )}
                        </div>
                      </div>
                      {/* Aux files display */}
                      {sel.auxiliaryFiles.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <AuxFileList files={sel.auxiliaryFiles} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates" className="space-y-4 mt-4">
          {docTemplates.length === 0 ? (
            <div className="text-center py-12">
              <EmptyState title="暂无模板" description="点击右上角「上传模板」开始使用" />
            </div>
          ) : (
            <div className="space-y-3">
              {docTemplates.map((tpl) => (
                <Card key={tpl.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{tpl.name}</span>
                        <Badge variant="outline">{tpl.fileType.toUpperCase()}</Badge>
                        <span className="text-xs text-muted-foreground">{formatFileSize(tpl.fileSize)}</span>
                      </div>
                      {tpl.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate" title={tpl.description}>{tpl.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button variant="ghost" size="icon" onClick={() => handleTplDownload(tpl)} title="下载模板文件">
                        <Download className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => openTplEdit(tpl)} title="编辑模板">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTplTarget(tpl)} title="删除模板">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ═════ Script Upload Dialog ═════ */}
      <Dialog open={showScriptUpload} onOpenChange={setShowScriptUpload}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>上传脚本</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本名称</Label><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="必填" /></div>
              <div className="space-y-2"><Label>版本号</Label><Input value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} placeholder="如 v1.0.0" /></div>
            </div>
            <div className="space-y-2"><Label>备注（{meta.description.length}/100）</Label><Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="选填，最多100字" rows={2} maxLength={100} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>适用区域</Label>
                <Select value={meta.region} onValueChange={(v) => setMeta({ ...meta, region: v as ScriptRegion })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REGION_LIST.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>分类</Label>
                <Select value={meta.category} onValueChange={(v) => setMeta({ ...meta, category: v as LogCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LOG_CATEGORY_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本类型</Label>
                <Select value={meta.scriptType} onValueChange={(v) => setMeta({ ...meta, scriptType: v as ScriptType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SCRIPT_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>巡检数据格式</Label>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground cursor-pointer" onClick={() => setIsManualInput(!isManualInput)}>手动输入</Label>
                    <Switch checked={isManualInput} onCheckedChange={setIsManualInput} />
                  </div>
                </div>
                {isManualInput ? (
                  <Input value={meta.inputFormats} onChange={(e) => setMeta({ ...meta, inputFormats: e.target.value })} placeholder="多个用,或空格分隔" />
                ) : (
                  <Select value={meta.inputFormats} onValueChange={(v) => setMeta({ ...meta, inputFormats: v })}>
                    <SelectTrigger><SelectValue placeholder="选择格式" /></SelectTrigger>
                    <SelectContent>
                      {INPUT_FORMAT_SUGGESTIONS.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="space-y-2"><Label>脚本文件</Label>
              {uploadFiles.length === 0 ? (
                <FileUploader files={uploadFiles} onFilesChange={setUploadFiles} triggerMode="manual" acceptedTypes=".sh,.py,.ps1,.bat,.txt" maxSizeMB={5} multiple={false} />
              ) : (
                <ScriptFileCard
                  fileName={uploadFiles[0].name}
                  fileSize={uploadFiles[0].size}
                  scriptType={meta.scriptType}
                  onReupload={() => setUploadFiles([])}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={meta.templateRequired} onCheckedChange={(v) => setMeta({ ...meta, templateRequired: v })} />
              <Label className="cursor-pointer">需要关联模板生成报告</Label>
            </div>
            {meta.templateRequired && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>关联模板（已选 {meta.templateIds.length} 个）</Label>
                  <Button variant="outline" size="sm" className="h-7 text-xs" type="button" onClick={() => setShowTemplatePicker(true)}>
                    <Search className="h-3 w-3 mr-1" />选择模板
                  </Button>
                </div>
                {meta.templateIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {meta.templateIds.map((tid) => {
                      const t = docTemplates.find((dt) => dt.id === tid);
                      return t ? (
                        <Badge key={tid} variant="secondary" className="gap-1 pr-0.5">
                          {t.name}
                          <button className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5" onClick={() => setMeta({ ...meta, templateIds: meta.templateIds.filter((id) => id !== tid) })}>
                            <XIcon className="h-3 w-3" />
                          </button>
                        </Badge>
                      ) : null;
                    })}
                  </div>
                ) : docTemplates.length > 0 ? (
                  <p className="text-xs text-muted-foreground">点击「选择模板」从已有模板中选择</p>
                ) : (
                  <p className="text-xs text-muted-foreground">暂无模板，请先上传模板</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>辅助文件（txt/xlsx/md/html等，选填）</Label>
              <FileUploader files={auxFiles} onFilesChange={setAuxFiles} triggerMode="manual" acceptedTypes=".py,.txt,.xlsx,.md,.html,.csv,.json,.yaml,.yml,.cfg,.conf,.ini" maxSizeMB={10} preserveDir />
            </div>
            {meta.scriptType === 'python' && (
              <div className="space-y-2 border rounded-lg p-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5"><PackageOpen className="h-3.5 w-3.5" />Python 环境配置</Label>
                  <div className="flex items-center gap-2">
                    {parseRequirements().length > 0 && (
                      <span className="text-xs text-muted-foreground">{parseRequirements().length} 个依赖</span>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs" type="button" onClick={openDepsManager}>
                      <Pencil className="h-3 w-3 mr-1" />管理依赖
                    </Button>
                  </div>
                </div>
                {(() => {
                  const pkgs = parseRequirements();
                  if (pkgs.length === 0) {
                    return <p className="text-xs text-muted-foreground">暂未配置依赖包，点击「管理依赖」添加</p>;
                  }
                  const ds = (editTarget as any)?.depsStatus;
                  const installedSet = new Set<string>();
                  if (isDepsStatusDone(ds?.status) && ds.packages) {
                    ds.packages.forEach((p: string) => installedSet.add(p.replace(/[<>=!~;].*$/, '').trim().toLowerCase().replace(/_/g, '-')));
                  }
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {pkgs.map((pkg, i) => {
                        const pkgName = pkg.replace(/[<>=!~;].*$/, '').trim().toLowerCase().replace(/_/g, '-');
                        const installed = installedSet.has(pkgName) || (isDepsStatusDone(ds?.status) && !ds.packages);
                        const failed = ds?.status === 'failed';
                        const icon = installed ? <Check className="h-3 w-3" /> : failed ? <AlertCircle className="h-3 w-3" /> : <XIcon className="h-3 w-3" />;
                        const cls = installed ? 'bg-green-100 text-green-700 border-green-300' : failed ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : 'bg-red-50 text-red-600 border-red-200';
                        return (
                          <Badge key={i} variant="outline" className={`gap-1 text-xs ${cls}`}>
                            {icon}{pkg}
                          </Badge>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScriptUpload(false)}>取消</Button>
            <Button onClick={handleUpload} disabled={uploading}>{uploading ? '上传中...' : '确认上传'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>编辑脚本</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本名称</Label><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>版本号</Label><Input value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} placeholder="如 v1.0.0" /></div>
            </div>
            <div className="space-y-2"><Label>备注（{meta.description.length}/100）</Label><Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} rows={2} maxLength={100} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>适用区域</Label>
                <Select value={meta.region} onValueChange={(v) => setMeta({ ...meta, region: v as ScriptRegion })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REGION_LIST.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>分类</Label>
                <Select value={meta.category} onValueChange={(v) => setMeta({ ...meta, category: v as LogCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LOG_CATEGORY_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本类型</Label>
                <Select value={meta.scriptType} onValueChange={(v) => setMeta({ ...meta, scriptType: v as ScriptType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SCRIPT_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>巡检数据格式</Label>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground cursor-pointer" onClick={() => setIsManualInput(!isManualInput)}>手动输入</Label>
                    <Switch checked={isManualInput} onCheckedChange={setIsManualInput} />
                  </div>
                </div>
                {isManualInput ? (
                  <Input value={meta.inputFormats} onChange={(e) => setMeta({ ...meta, inputFormats: e.target.value })} placeholder="多个用,或空格分隔" />
                ) : (
                  <Select value={meta.inputFormats} onValueChange={(v) => setMeta({ ...meta, inputFormats: v })}>
                    <SelectTrigger><SelectValue placeholder="选择格式" /></SelectTrigger>
                    <SelectContent>
                      {INPUT_FORMAT_SUGGESTIONS.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>脚本文件</Label>
              {uploadFiles.length > 0 ? (
                <ScriptFileCard
                  fileName={uploadFiles[0].name}
                  fileSize={uploadFiles[0].size}
                  scriptType={meta.scriptType}
                  onReupload={() => setUploadFiles([])}
                />
              ) : editTarget ? (
                <ScriptFileCard
                  fileName={editTarget.fileName}
                  fileSize={editTarget.fileSize}
                  scriptType={editTarget.scriptType}
                  scriptId={editTarget.id}
                  onDownload={() => downloadFile(`/scripts/${editTarget.id}/download`, editTarget.fileName)}
                  onEdit={() => openScriptEditor(editTarget.id, editTarget.fileName)}
                  onReupload={() => scriptFileInputRef.current?.click()}
                  showActions
                />
              ) : null}
              {/* 隐藏的文件选择器 — 替换按钮直接触发 */}
              <input
                ref={scriptFileInputRef}
                type="file"
                className="hidden"
                accept=".sh,.py,.ps1,.bat,.txt"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) setUploadFiles(files.slice(0, 1));
                  // 重置 input 以便再次选择同一文件
                  e.target.value = '';
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={meta.templateRequired} onCheckedChange={(v) => setMeta({ ...meta, templateRequired: v })} />
              <Label className="cursor-pointer">需要关联模板生成报告</Label>
            </div>
            {meta.templateRequired && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>关联模板（已选 {meta.templateIds.length} 个）</Label>
                  <Button variant="outline" size="sm" className="h-7 text-xs" type="button" onClick={() => setShowTemplatePicker(true)}>
                    <Search className="h-3 w-3 mr-1" />选择模板
                  </Button>
                </div>
                {meta.templateIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {meta.templateIds.map((tid) => {
                      const t = docTemplates.find((dt) => dt.id === tid);
                      return t ? (
                        <Badge key={tid} variant="secondary" className="gap-1 pr-0.5">
                          {t.name}
                          <button className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5" onClick={() => setMeta({ ...meta, templateIds: meta.templateIds.filter((id) => id !== tid) })}>
                            <XIcon className="h-3 w-3" />
                          </button>
                        </Badge>
                      ) : null;
                    })}
                  </div>
                ) : docTemplates.length > 0 ? (
                  <p className="text-xs text-muted-foreground">点击「选择模板」从已有模板中选择</p>
                ) : (
                  <p className="text-xs text-muted-foreground">暂无模板，请先上传模板</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>辅助文件</Label>
                {meta.auxiliaryFiles.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedAuxKeys(new Set(meta.auxiliaryFiles.map(auxKey)))}>全选</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                      const next = new Set(selectedAuxKeys);
                      meta.auxiliaryFiles.forEach((af) => next.has(auxKey(af)) ? next.delete(auxKey(af)) : next.add(auxKey(af)));
                      setSelectedAuxKeys(next);
                    }}>反选</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedAuxKeys(new Set())}>取消选择</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" disabled={selectedAuxKeys.size === 0}
                      onClick={() => {
                        setMeta({ ...meta, auxiliaryFiles: dedupeAux(meta.auxiliaryFiles.filter((af) => !selectedAuxKeys.has(auxKey(af)))) });
                        setSelectedAuxKeys(new Set());
                      }}
                    >删除选中{selectedAuxKeys.size > 0 ? `(${selectedAuxKeys.size})` : ''}</Button>
                  </div>
                )}
              </div>
              {meta.auxiliaryFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {meta.auxiliaryFiles.map((af) => {
                    const key = auxKey(af);
                    const isSel = selectedAuxKeys.has(key);
                    return (
                      <Badge key={key} variant={isSel ? 'default' : 'secondary'} className="gap-1 cursor-pointer select-none"
                        onClick={() => {
                          const next = new Set(selectedAuxKeys);
                          isSel ? next.delete(key) : next.add(key);
                          setSelectedAuxKeys(next);
                        }}
                      >
                        <File className="h-3 w-3" />{af.name}
                      </Badge>
                    );
                  })}
                </div>
              )}
              <FileUploader files={auxFiles} onFilesChange={setAuxFiles} triggerMode="manual" acceptedTypes=".py,.txt,.xlsx,.md,.html,.csv,.json,.yaml,.yml,.cfg,.conf,.ini" maxSizeMB={10} preserveDir />
            </div>
            {meta.scriptType === 'python' && (
              <div className="space-y-2 border rounded-lg p-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5"><PackageOpen className="h-3.5 w-3.5" />Python 环境配置</Label>
                  <div className="flex items-center gap-2">
                    {parseRequirements().length > 0 && (
                      <span className="text-xs text-muted-foreground">{parseRequirements().length} 个依赖</span>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs" type="button" onClick={openDepsManager}>
                      <Pencil className="h-3 w-3 mr-1" />管理依赖
                    </Button>
                  </div>
                </div>
                {(() => {
                  const pkgs = parseRequirements();
                  if (pkgs.length === 0) {
                    return <p className="text-xs text-muted-foreground">暂未配置依赖包，点击「管理依赖」添加</p>;
                  }
                  const ds = (editTarget as any)?.depsStatus;
                  const installedSet = new Set<string>();
                  if (isDepsStatusDone(ds?.status) && ds.packages) {
                    ds.packages.forEach((p: string) => installedSet.add(p.replace(/[<>=!~;].*$/, '').trim().toLowerCase().replace(/_/g, '-')));
                  }
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {pkgs.map((pkg, i) => {
                        const pkgName = pkg.replace(/[<>=!~;].*$/, '').trim().toLowerCase().replace(/_/g, '-');
                        const installed = installedSet.has(pkgName) || (isDepsStatusDone(ds?.status) && !ds.packages);
                        const failed = ds?.status === 'failed';
                        const icon = installed ? <Check className="h-3 w-3" /> : failed ? <AlertCircle className="h-3 w-3" /> : <XIcon className="h-3 w-3" />;
                        const cls = installed ? 'bg-green-100 text-green-700 border-green-300' : failed ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : 'bg-red-50 text-red-600 border-red-200';
                        return (
                          <Badge key={i} variant="outline" className={`gap-1 text-xs ${cls}`}>
                            {icon}{pkg}
                          </Badge>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>取消</Button>
            <Button onClick={handleEdit} disabled={uploading}>{uploading ? '保存中...' : '保存修改'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════ Template Upload Dialog ═════ */}
      <Dialog open={showTplUpload} onOpenChange={setShowTplUpload}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>上传模板</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>模板名称</Label><Input value={tplMeta.name} onChange={(e) => setTplMeta({ ...tplMeta, name: e.target.value })} placeholder="必填" /></div>
            <div className="space-y-2"><Label>备注（{tplMeta.description.length}/100）</Label><Textarea value={tplMeta.description} onChange={(e) => setTplMeta({ ...tplMeta, description: e.target.value })} rows={2} maxLength={100} placeholder="选填，最多100字" /></div>
            <FileUploader files={tplFiles} onFilesChange={setTplFiles} triggerMode="manual" acceptedTypes=".docx,.xlsx,.md,.pdf" maxSizeMB={20} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTplUpload(false)}>取消</Button>
            <Button onClick={handleTplUpload} disabled={tplUploading}>{tplUploading ? '上传中...' : '确认上传'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════ Template Edit Dialog ═════ */}
      <Dialog open={showTplEdit} onOpenChange={setShowTplEdit}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>编辑模板</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>模板名称</Label><Input value={tplMeta.name} onChange={(e) => setTplMeta({ ...tplMeta, name: e.target.value })} placeholder="必填" /></div>
            <div className="space-y-2"><Label>备注（{tplMeta.description.length}/100）</Label><Textarea value={tplMeta.description} onChange={(e) => setTplMeta({ ...tplMeta, description: e.target.value })} rows={2} maxLength={100} placeholder="选填，最多100字" /></div>
            <div className="space-y-2">
              <Label>重新上传模板文件（选填，将覆盖原文件）</Label>
              <FileUploader files={tplReuploadFile} onFilesChange={(files) => setTplReuploadFile(files.slice(-1))} triggerMode="manual" acceptedTypes=".docx,.xlsx,.md,.pdf" maxSizeMB={20} />
              {editTplTarget && !tplReuploadFile.length && (
                <p className="text-sm font-medium mt-1">当前文件：{editTplTarget.fileName} ({formatFileSize(editTplTarget.fileSize)})</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowTplEdit(false); setShowOverwriteConfirm(false); }}>取消</Button>
            <Button onClick={handleTplEdit}>保存修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} onConfirm={handleDelete} title="删除脚本" description={`确定要删除「${deleteTarget?.name}」v${deleteTarget?.version} 吗？`} />
      <ConfirmDialog open={!!deleteTplTarget} onOpenChange={() => setDeleteTplTarget(null)} onConfirm={handleDeleteTpl} title="删除模板" description={`确定要删除「${deleteTplTarget?.name}」吗？`} />
      <ConfirmDialog open={showOverwriteConfirm} onOpenChange={() => setShowOverwriteConfirm(false)} onConfirm={saveTplEdit} title="确认覆盖模板文件" description={`将使用「${tplReuploadFile[0]?.name || ''}」替换原有模板文件「${editTplTarget?.fileName || ''}」，此操作不可撤销。确定继续吗？`} />

      {/* ═════ Template Picker ═════ */}
      <TemplatePicker
        open={showTemplatePicker}
        onOpenChange={setShowTemplatePicker}
        docTemplates={docTemplates}
        selectedTemplateIds={meta.templateIds}
        onSelectionChange={(ids) => setMeta({ ...meta, templateIds: ids })}
        onOpenUpload={() => { setTplMeta({ name: '', description: '' }); setTplFiles([]); setShowTplUpload(true); }}
      />

      {/* ═════ Script Editor Dialog ═════ */}
      {editorTarget && (
        <ScriptEditor
          open={showScriptEditor}
          onOpenChange={setShowScriptEditor}
          scriptId={editorTarget.id}
          fileName={editorTarget.fileName}
        />
      )}

      {/* ═════ 依赖安装进度弹窗 ═════ */}
      <InstallDepsDialog
        open={showInstallDialog}
        onOpenChange={(open) => { setShowInstallDialog(open); if (!open) { setInstallStatus('idle'); setInstallLogs([]); } }}
        installStatus={installStatus}
        installLogs={installLogs}
      />

      {/* ═════ 依赖管理弹窗 ═════ */}
      <Dialog open={showDepsManager} onOpenChange={setShowDepsManager}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><PackageOpen className="h-5 w-5" />管理依赖</DialogTitle></DialogHeader>
          <div className="space-y-4 flex-1 min-h-0">
            {/* 导入 requirements.txt */}
            <div className="flex items-center gap-2">
              <label className="cursor-pointer text-xs text-primary hover:underline flex items-center gap-1">
                <Upload className="h-3.5 w-3.5" />导入 requirements.txt
                <input type="file" accept=".txt" className="hidden" onChange={handleImportRequirements} />
              </label>
              <span className="text-xs text-muted-foreground">从文件批量导入</span>
            </div>

            {/* 添加新依赖 */}
            <div className="flex gap-2">
              <Input
                value={depsNewPkg}
                onChange={(e) => setDepsNewPkg(e.target.value)}
                placeholder="包名，如 pandas>=1.0"
                className="h-9 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && depsNewPkg.trim()) {
                    setDepsEditList([...depsEditList, depsNewPkg.trim()]);
                    setDepsNewPkg('');
                  }
                }}
              />
              <Button size="sm" className="h-9 text-xs shrink-0" disabled={!depsNewPkg.trim()}
                onClick={() => { setDepsEditList([...depsEditList, depsNewPkg.trim()]); setDepsNewPkg(''); }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />添加
              </Button>
            </div>

            {/* 依赖列表 */}
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg">
              {depsEditList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">暂无依赖，请添加或导入</p>
              ) : (
                <div className="divide-y">
                  {depsEditList.map((pkg, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5">
                      <Input
                        value={pkg}
                        onChange={(e) => {
                          const next = [...depsEditList];
                          next[i] = e.target.value;
                          setDepsEditList(next);
                        }}
                        className="h-8 text-xs flex-1 mr-2 font-mono"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDepsEditList(depsEditList.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 底部统计 */}
            <p className="text-xs text-muted-foreground">共 {depsEditList.length} 个依赖包</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDepsManager(false)}>取消</Button>
            <Button onClick={saveDepsManager}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
