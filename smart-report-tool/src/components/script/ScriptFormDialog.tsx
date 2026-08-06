import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { apiPost, apiDelete, downloadFile } from '@/services/api';
import { Script, ScriptType, ScriptRegion, LogCategory, AuxFile } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { FileUploader, getFilePath } from '@/components/common/FileUploader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Pencil, File, Upload, PackageOpen, Search, Check, X as XIcon, Trash2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { ScriptEditor } from './ScriptEditor';
import { ScriptFileCard } from './ScriptFileCard';
import { PythonVersionSelector } from './PythonVersionSelector';
import { TemplatePicker } from '@/components/template/TemplatePicker';
import { SCRIPT_TYPE_LABELS, LOG_CATEGORY_LABELS, REGION_LIST, INPUT_FORMAT_SUGGESTIONS, emptyMeta, isDepsStatusDone } from './constants';

/** 辅助文件稳定唯一 key：优先 hash，其次 name */
const auxKey = (af: AuxFile) => (af as AuxFile & { hash?: string }).hash || af.name;
/** 去重辅助文件：按 key 保留最后一次出现 */
function dedupeAux(list: AuxFile[]): AuxFile[] {
  const seen = new Set<string>();
  return list.filter((af) => {
    const k = auxKey(af);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface ScriptFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑目标；为 null 时是上传模式 */
  editTarget: Script | null;
  /** 清空文件后需要同步页面侧 editTarget */
  onEditTargetChange: (script: Script) => void;
  /** 模板选择器内「上传模板」入口 */
  onOpenTemplateUpload: () => void;
}

/** 上传 / 编辑脚本共用的表单对话框（editTarget 为空即上传模式） */
export function ScriptFormDialog({ open, onOpenChange, editTarget, onEditTargetChange, onOpenTemplateUpload }: ScriptFormDialogProps) {
  const { user } = useAuthStore();
  const { fetchScripts, updateScript } = useScriptStore();
  const { docTemplates } = useDocTemplateStore();

  // Form state
  const [meta, setMeta] = useState(emptyMeta());
  const [auxFiles, setAuxFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [requirementsText, setRequirementsText] = useState('');
  const [isManualInput, setIsManualInput] = useState(false);
  const [entryFileIdx, setEntryFileIdx] = useState<number | null>(null);
  const [selectedEntryName, setSelectedEntryName] = useState<string | null>(null);
  // 两种模式各自的待上传文件，互不影响
  const [singleUploadFiles, setSingleUploadFiles] = useState<File[]>([]);
  const [multiUploadFiles, setMultiUploadFiles] = useState<File[]>([]);
  // 实际使用的文件选择器，根据 isMultiFile 决定
  const uploadFiles = meta.isMultiFile ? multiUploadFiles : singleUploadFiles;
  const setUploadFiles = meta.isMultiFile ? setMultiUploadFiles : setSingleUploadFiles;

  // Script editor
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [editorTarget, setEditorTarget] = useState<{ id: string; fileName: string } | null>(null);
  const [selectedAuxKeys, setSelectedAuxKeys] = useState<Set<string>>(new Set());
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // 隐藏的脚本文件 input ref，替换按钮直接触发
  const scriptFileInputRef = useRef<HTMLInputElement>(null);

  // 版本切换确认弹窗
  const [showVersionConfirm, setShowVersionConfirm] = useState(false);

  // 依赖管理弹窗
  const [showDepsManager, setShowDepsManager] = useState(false);
  const [depsEditList, setDepsEditList] = useState<string[]>([]);
  const [depsNewPkg, setDepsNewPkg] = useState('');

  // 清空脚本文件确认弹窗
  const [showClearFilesDialog, setShowClearFilesDialog] = useState(false);

  // 折叠区块：高级设置 / 模板与依赖（默认收起，每次打开对话框重置）
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDeps, setShowDeps] = useState(false);

  // 打开对话框时初始化表单（render 期间派生状态，避免旧数据闪现）：
  // 上传模式 = 重置为空表单；编辑模式 = 从 editTarget 回填
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setShowAdvanced(false);
      setShowDeps(false);
      if (editTarget) {
        setMeta({ name: editTarget.name, description: editTarget.description, reportNameTemplate: editTarget.reportNameTemplate || '', scriptType: editTarget.scriptType, region: editTarget.region || '全部', inputFormats: editTarget.inputFormats || '', inputFormatManual: editTarget.inputFormatManual || false, version: editTarget.version, category: editTarget.category, templateRequired: editTarget.templateRequired, templateIds: [...editTarget.templateIds], auxiliaryFiles: dedupeAux([...editTarget.auxiliaryFiles]), extraFiles: dedupeAux([...(editTarget.extraFiles || [])]), requirements: editTarget.requirements || [], pythonVersion: editTarget.pythonVersion || 'embedded', isMultiFile: editTarget.isMultiFile || false });
        setRequirementsText((editTarget.requirements || []).join('\n'));
        setSingleUploadFiles([]);
        setMultiUploadFiles([]);
        setEntryFileIdx(null);
        setSelectedEntryName(editTarget.fileName);
        setAuxFiles([]);
        setSelectedAuxKeys(new Set());
      } else {
        setMeta(emptyMeta());
        setSingleUploadFiles([]);
        setMultiUploadFiles([]);
        setAuxFiles([]);
        setRequirementsText('');
        setEntryFileIdx(null);
        setSelectedEntryName(null);
      }
    }
  }

  // 从 meta.inputFormatManual 还原手动输入开关状态（从后端数据或默认值）
  useEffect(() => {
    setIsManualInput(meta.inputFormatManual || false);
  }, [meta.inputFormatManual]);

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

  /** 自动检测主入口：文件名（忽略大小写、忽略下划线/连字符）严格等于 main.py */
  const detectEntryIdx = (files: File[]): number | null => {
    for (let i = 0; i < files.length; i++) {
      const base = files[i].name.toLowerCase().replace(/[._-]/g, '');
      if (base === 'mainpy') {
        return i;
      }
    }
    return null;
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
    if (meta.isMultiFile && entryFileIdx === null) { toast.error('请选择主入口脚本'); return; }
    if (meta.templateRequired && meta.templateIds.length === 0) { toast.error('已勾选"需要关联模板"，请至少选择一个模板文件'); return; }
    const fmtError = validateInputFormats(meta.inputFormats);
    if (fmtError) { toast.error(fmtError); return; }
    setUploading(true);
    try {
      const file = uploadFiles[0];
      const formData = new FormData();
      formData.append('name', meta.name.trim());
      formData.append('description', meta.description);
      formData.append('reportNameTemplate', meta.reportNameTemplate);
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
      formData.append('pythonVersion', meta.pythonVersion);
      formData.append('isMultiFile', String(meta.isMultiFile));

      // 多文件模式：entryFileIdx 指定的文件作为 scriptFile（主入口），其余作为 scriptFile{N}
      if (meta.isMultiFile && uploadFiles.length > 1) {
        const entryIdx = entryFileIdx ?? 0;
        formData.append('scriptFile', uploadFiles[entryIdx]);
        let extraIdx = 1;
        for (let i = 0; i < uploadFiles.length; i++) {
          if (i === entryIdx) continue;
          formData.append(`scriptFile${extraIdx}`, uploadFiles[i]);
          extraIdx++;
        }
      } else {
        formData.append('scriptFile', file);
      }
      auxFiles.forEach((af, idx) => {
        formData.append(`auxFile${idx}`, af);
        const relPath = getFilePath(af);
        if (relPath !== af.name) formData.append(`auxPath${idx}`, relPath);
      });
      await apiPost('/scripts', formData);
      onOpenChange(false);
      setMeta(emptyMeta());
      setSingleUploadFiles([]);
      setMultiUploadFiles([]);
      setAuxFiles([]);
      await fetchScripts();
      toast.success('上传成功');
    } catch (e) {
      toast.error(`上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    finally { setUploading(false); }
  };

  // ── Edit script ──
  const doSaveEdit = async () => {
    if (!editTarget || !meta.name.trim()) { toast.error('请填写脚本名称'); return; }
    if (meta.isMultiFile && uploadFiles.length > 0 && entryFileIdx === null && !editTarget?.fileName) { toast.error('请选择主入口脚本'); return; }
    if (meta.templateRequired && meta.templateIds.length === 0) { toast.error('已勾选"需要关联模板"，请至少选择一个模板文件'); return; }
    const fmtError = validateInputFormats(meta.inputFormats);
    if (fmtError) { toast.error(fmtError); return; }
    setUploading(true);
    try {
      const hasNewScriptFile = uploadFiles.length > 0;
      const hasNewAuxFiles = auxFiles.length > 0;

      if (hasNewScriptFile || hasNewAuxFiles) {
        const formData = new FormData();
        formData.append('name', meta.name.trim());
        formData.append('description', meta.description);
        formData.append('reportNameTemplate', meta.reportNameTemplate);
        formData.append('scriptType', meta.scriptType);
        formData.append('version', meta.version);
        formData.append('category', meta.category);
        formData.append('region', meta.region);
        formData.append('inputFormats', meta.inputFormats);
        formData.append('inputFormatManual', String(isManualInput));
        formData.append('templateRequired', String(meta.templateRequired));
        formData.append('templateIds', JSON.stringify(meta.templateRequired ? meta.templateIds : []));
        formData.append('requirements', JSON.stringify(parseRequirements()));
        formData.append('pythonVersion', meta.pythonVersion);
        formData.append('isMultiFile', String(meta.isMultiFile));
        formData.append('existingAux', JSON.stringify(meta.auxiliaryFiles));
        formData.append('existingExtra', JSON.stringify(meta.extraFiles || []));

        // 如果用户选择了已保存的额外文件作为新主入口，通知后端 swap
        if (selectedEntryName && selectedEntryName !== editTarget?.fileName) {
          formData.append('entryName', selectedEntryName);
        }

        if (hasNewScriptFile) {
          if (meta.isMultiFile) {
            // 多文件模式：
            // - entryFileIdx !== null 表示选择新上传文件作为主入口
            // - entryFileIdx === null 表示保留旧主入口，所有新上传文件都作为额外文件
            if (entryFileIdx !== null) {
              formData.append('scriptFile', uploadFiles[entryFileIdx]);
            }
            let extraIdx = 1;
            for (let i = 0; i < uploadFiles.length; i++) {
              if (entryFileIdx === i) continue;
              formData.append(`scriptFile${extraIdx}`, uploadFiles[i]);
              extraIdx++;
            }
          } else {
            formData.append('scriptFile', uploadFiles[0]);
          }
        }

        auxFiles.forEach((af, idx) => {
          formData.append(`auxFile${idx}`, af);
          const relPath = getFilePath(af);
          if (relPath !== af.name) formData.append(`auxPath${idx}`, relPath);
        });

        const { updateScriptWithAuxFiles } = useScriptStore.getState();
        await updateScriptWithAuxFiles(editTarget.id, formData);
        setAuxFiles([]);
        setSingleUploadFiles([]);
        setMultiUploadFiles([]);
        setEntryFileIdx(null);
        setSelectedEntryName(null);
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
          pythonVersion: meta.pythonVersion,
          isMultiFile: meta.isMultiFile,
        });
      }
      onOpenChange(false);
      toast.success('保存成功');
    } catch { toast.error('保存失败'); }
    finally { setUploading(false); }
  };

  const handleEdit = async () => {
    if (!editTarget || !meta.name.trim()) { toast.error('请填写脚本名称'); return; }
    if (meta.templateRequired && meta.templateIds.length === 0) { toast.error('已勾选"需要关联模板"，请至少选择一个模板文件'); return; }
    const fmtError = validateInputFormats(meta.inputFormats);
    if (fmtError) { toast.error(fmtError); return; }

    // 检测 Python 版本变更，弹出确认窗
    if (editTarget.pythonVersion && meta.pythonVersion !== editTarget.pythonVersion) {
      setShowVersionConfirm(true);
      return;
    }

    await doSaveEdit();
  };

  /** 清空多文件模式下的所有脚本文件 */
  const handleClearFiles = async () => {
    if (!editTarget) return;
    try {
      await apiDelete(`/scripts/${editTarget.id}/files`);
      // 本地状态同步：清空上传队列、入口选择、已保存的 extraFiles
      setUploadFiles([]);
      setEntryFileIdx(null);
      setSelectedEntryName(null);
      setMeta({ ...meta, extraFiles: [] });
      // 同步 editTarget，否则界面仍显示旧主入口
      onEditTargetChange({
        ...editTarget,
        fileName: '',
        filePath: '',
        fileSize: 0,
        extraFiles: [],
      });
      // 刷新脚本列表，确保列表页数据最新
      await fetchScripts();
      toast.success('脚本文件已清空');
    } catch (err: any) {
      toast.error(err.message || '清空脚本文件失败');
    } finally {
      setShowClearFilesDialog(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader><DialogTitle>{editTarget ? '编辑脚本' : '上传脚本'}</DialogTitle></DialogHeader>
          {/* 可滚动的表单区域；p-1 给焦点环留出显示空间，-m-1 补偿 padding 不影响布局 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-1 -m-1">
          <div className="space-y-4 pb-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本名称</Label><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder={editTarget ? undefined : '必填'} /></div>
              <div className="space-y-2"><Label>版本号</Label><Input value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} placeholder="如 v1.0.0" /></div>
            </div>
            <div className="space-y-2"><Label>备注（{meta.description.length}/100）</Label><Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder={editTarget ? undefined : '选填，最多100字'} rows={2} maxLength={100} /></div>
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
            {/* 高级设置（默认收起）：报告命名规则、脚本类型、巡检数据格式 */}
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              高级设置 {showAdvanced ? '（点击收起）' : '（点击展开）'}
            </button>
            {showAdvanced && (
            <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2">
              <Label>报告命名规则</Label>
              <Input value={meta.reportNameTemplate} onChange={(e) => setMeta({ ...meta, reportNameTemplate: e.target.value })} placeholder="留空使用默认命名" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                可用通配符：<code className="font-mono">{'{date}'}</code>=YYYYMMDD，<code className="font-mono">{'{date_dash}'}</code>=YYYY-MM-DD，<code className="font-mono">{'{time}'}</code>=HHMM，<code className="font-mono">{'{datetime}'}</code>=YYYYMMDD-HHMM，<code className="font-mono">{'{user_name}'}</code>=用户名，<code className="font-mono">{'{script_name}'}</code>=脚本名称
              </p>
              {meta.reportNameTemplate.trim() && (
                <p className="text-xs text-muted-foreground">
                  预览：<span className="font-mono">{(() => {
                    const now = new Date();
                    const p = (n: number) => String(n).padStart(2, '0');
                    const d = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
                    const t = `${p(now.getHours())}${p(now.getMinutes())}`;
                    return meta.reportNameTemplate
                      .replace(/\{date_dash\}/g, `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`)
                      .replace(/\{datetime\}/g, `${d}-${t}`)
                      .replace(/\{date\}/g, d)
                      .replace(/\{time\}/g, t)
                      .replace(/\{user_name\}/g, user?.displayName || user?.username || '用户名')
                      .replace(/\{script_name\}/g, meta.name || '脚本名称');
                  })()}</span>
                </p>
              )}
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
            </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Label>脚本文件</Label>
                {meta.scriptType === 'python' && (
                  <div className="flex items-center gap-2">
                    <Switch checked={meta.isMultiFile} onCheckedChange={(v) => setMeta({ ...meta, isMultiFile: v })} />
                    <Label className="cursor-pointer">多文件脚本模式（支持上传多个 .py 文件）</Label>
                  </div>
                )}
              </div>
              {meta.isMultiFile && meta.scriptType === 'python' ? (
                editTarget ? (
                <FileUploader
                  files={uploadFiles}
                  onFilesChange={(files) => {
                    setUploadFiles(files);
                    const detected = detectEntryIdx(files);
                    if (detected !== null) {
                      setEntryFileIdx(detected);
                    } else if (files.length > 0) {
                      // 编辑模式默认保留旧入口；上传模式默认选第一个新文件
                      setEntryFileIdx(editTarget ? null : 0);
                    } else {
                      setEntryFileIdx(null);
                    }
                  }}
                  triggerMode="manual"
                  acceptedTypes=".py"
                  maxSizeMB={5}
                  multiple
                  hideFileList
                  renderFileList={({ files, removeFile }) => {
                    // 合并显示：刚上传的 + 后端已保存的
                    // entryName 优先级：新上传入口 > selectedEntryName（已保存额外文件） > 旧入口
                    const entryName = files.length > 0 && entryFileIdx !== null && files[entryFileIdx]
                      ? files[entryFileIdx].name
                      : selectedEntryName || editTarget?.fileName;
                    const entrySize = files.length > 0 && entryFileIdx !== null && files[entryFileIdx]
                      ? files[entryFileIdx].size
                      : selectedEntryName && selectedEntryName !== editTarget?.fileName
                        ? (meta.extraFiles || []).find((e) => e.name === selectedEntryName)?.size || 0
                        : editTarget?.fileSize;
                    // 已保存的额外文件列表（不过滤当前入口，下面分别处理）
                    const savedExtras = (meta.extraFiles || []).map((e) => e.name);
                    const allItems: Array<{ name: string; size: number; isSaved: boolean }> = [];
                    const seen = new Set<string>();
                    files.forEach((f) => { if (seen.has(f.name)) return; seen.add(f.name); allItems.push({ name: f.name, size: f.size, isSaved: false }); });
                    savedExtras.forEach((n) => { if (seen.has(n)) return; seen.add(n); const ef = (meta.extraFiles || []).find((e) => e.name === n); allItems.push({ name: n, size: ef?.size || 0, isSaved: true }); });
                    // 如果旧入口不再是当前入口，把它加到文件列表里（swap 后它会变成 extra）
                    if (editTarget?.fileName && editTarget.fileName !== entryName && !seen.has(editTarget.fileName)) {
                      seen.add(editTarget.fileName);
                      allItems.push({ name: editTarget.fileName, size: editTarget.fileSize || 0, isSaved: true });
                    }
                    // 入口选择下拉框选项：新上传文件 + 已保存额外文件 + 旧入口（所有文件）
                    const entryOptions: Array<{ name: string; size: number }> = [];
                    const entrySeen = new Set<string>();
                    files.forEach((f) => { if (!entrySeen.has(f.name)) { entrySeen.add(f.name); entryOptions.push(f); } });
                    savedExtras.forEach((n) => { if (!entrySeen.has(n)) { entrySeen.add(n); const ef = (meta.extraFiles || []).find((e) => e.name === n); entryOptions.push({ name: n, size: ef?.size || 0 }); } });
                    if (editTarget?.fileName && !entrySeen.has(editTarget.fileName)) {
                      entryOptions.push({ name: editTarget.fileName, size: editTarget.fileSize || 0 });
                    }
                    return (
                      <div className="space-y-3">
                        {entryName && (
                          <div className="rounded-md border-2 border-primary bg-primary/5 p-3 flex items-center gap-3">
                            <File className="h-4 w-4 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-primary truncate">{entryName}</div>
                              <div className="text-xs text-muted-foreground">{formatFileSize(entrySize || 0)} · 脚本主入口</div>
                            </div>
                            <Badge className="bg-primary text-primary-foreground shrink-0">主入口</Badge>
                          </div>
                        )}
                        <div className="border rounded-md p-3 space-y-1.5">
                          {allItems.map((item) => {
                            if (item.name === entryName) return null;
                            return (
                              <div key={item.name} className="flex items-center gap-2 text-sm">
                                <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate flex-1">{item.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">({formatFileSize(item.size)})</span>
                                <button onClick={() => {
                                  if (item.isSaved) {
                                    setMeta({ ...meta, extraFiles: meta.extraFiles.filter((e) => e.name !== item.name) });
                                  } else {
                                    const idx = files.findIndex((f) => f.name === item.name);
                                    if (idx >= 0) {
                                      removeFile(idx);
                                      if (idx === entryFileIdx) setEntryFileIdx(null);
                                      else if (entryFileIdx !== null && idx < entryFileIdx) setEntryFileIdx(entryFileIdx - 1);
                                    }
                                  }
                                }} className="rounded-md p-0.5 hover:bg-accent shrink-0">
                                  <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-muted-foreground">脚本主入口：</span>
                          <Select value={entryName || ''} onValueChange={(v) => {
                            const idx = files.findIndex((f) => f.name === v);
                            if (idx >= 0) {
                              // 选中新上传的文件作为主入口
                              setEntryFileIdx(idx);
                              setSelectedEntryName(null);
                            } else if (v === editTarget?.fileName) {
                              // 选中旧入口 → 保持原样
                              setEntryFileIdx(null);
                              setSelectedEntryName(null);
                            } else {
                              // 选中已保存的额外文件 → 需要后端 swap
                              setEntryFileIdx(null);
                              setSelectedEntryName(v);
                            }
                          }}>
                            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="请选择主入口" /></SelectTrigger>
                            <SelectContent>
                              {entryOptions.map((f) => (
                                <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowClearFilesDialog(true)}>清空文件</Button>
                        </div>
                      </div>
                    );
                  }}
                />
                ) : (
                <div className="space-y-3">
                  {(uploadFiles.length > 0 && uploadFiles[entryFileIdx ?? 0]?.name) && (
                    <div className="rounded-md border-2 border-primary bg-primary/5 p-3 flex items-center gap-3">
                      <File className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-primary truncate">
                          {uploadFiles[entryFileIdx ?? 0]?.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatFileSize(uploadFiles[entryFileIdx ?? 0]?.size || 0)} · 脚本主入口
                        </div>
                      </div>
                      <Badge className="bg-primary text-primary-foreground shrink-0">主入口</Badge>
                    </div>
                  )}
                <FileUploader
                  files={uploadFiles}
                  onFilesChange={(files) => {
                    setUploadFiles(files);
                    const detected = detectEntryIdx(files);
                    if (detected !== null) {
                      setEntryFileIdx(detected);
                    } else if (files.length > 0) {
                      // 编辑模式默认保留旧入口；上传模式默认选第一个新文件
                      setEntryFileIdx(editTarget ? null : 0);
                    } else {
                      setEntryFileIdx(null);
                    }
                  }}
                  triggerMode="manual"
                  acceptedTypes=".py"
                  maxSizeMB={5}
                  multiple
                  hideFileList
                  renderFileList={({ files }) => {
                    // 合并显示：刚上传的 + 后端已保存的
                    const entryName = files.length > 0 ? files[entryFileIdx ?? 0]?.name : undefined;
                    const savedExtras = (meta.extraFiles || []).map((e) => e.name).filter((n) => n !== entryName);
                    const allItems: Array<{ name: string; size: number }> = [];
                    const seen = new Set<string>();
                    files.forEach((f) => { if (seen.has(f.name)) return; seen.add(f.name); allItems.push({ name: f.name, size: f.size }); });
                    savedExtras.forEach((n) => { if (seen.has(n)) return; seen.add(n); const ef = (meta.extraFiles || []).find((e) => e.name === n); allItems.push({ name: n, size: ef?.size || 0 }); });
                    return (
                      <div className="border rounded-md p-3 space-y-1.5">
                        {allItems.map((item) => {
                          if (item.name === entryName) return null;
                          return (
                            <div key={item.name} className="flex items-center gap-2 text-sm">
                              <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate flex-1">{item.name}</span>
                              <span className="text-xs text-muted-foreground shrink-0">({formatFileSize(item.size)})</span>
                              <button onClick={() => {
                                const idx = files.findIndex((f) => f.name === item.name);
                                if (idx >= 0) {
                                  files.splice(idx, 1);
                                  setUploadFiles([...files]);
                                  if (idx === entryFileIdx) setEntryFileIdx(null);
                                  else if (entryFileIdx !== null && idx < entryFileIdx) setEntryFileIdx(entryFileIdx - 1);
                                } else {
                                  setMeta({ ...meta, extraFiles: meta.extraFiles.filter((e) => e.name !== item.name) });
                                }
                              }} className="rounded-md p-0.5 hover:bg-accent shrink-0">
                                <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                {uploadFiles.length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-muted-foreground">脚本主入口：</span>
                    <Select value={String(entryFileIdx ?? 0)} onValueChange={(v) => setEntryFileIdx(parseInt(v, 10))}>
                      <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="请选择主入口" /></SelectTrigger>
                      <SelectContent>
                        {uploadFiles.map((f, i) => (
                          <SelectItem key={i} value={String(i)}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setUploadFiles([]); setEntryFileIdx(null); }}>清空重新选择</Button>
                  </div>
                )}
                </div>
                )
              ) : uploadFiles.length > 0 ? (
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
              ) : (
                <FileUploader files={uploadFiles} onFilesChange={setUploadFiles} triggerMode="manual" acceptedTypes=".sh,.py,.ps1,.bat,.txt" maxSizeMB={5} multiple={false} />
              )}
              {/* 隐藏的文件选择器 — 替换按钮直接触发. 多文件模式下接受多个文件 */}
              {editTarget && (
                <input
                  ref={scriptFileInputRef}
                  type="file"
                  className="hidden"
                  accept={meta.isMultiFile ? '.py' : '.sh,.py,.ps1,.bat,.txt'}
                  multiple={meta.isMultiFile}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      setUploadFiles(files);
                      const detected = detectEntryIdx(files);
                      setEntryFileIdx(detected);
                    }
                    e.target.value = '';
                  }}
                />
              )}
            </div>
            {/* 模板与依赖（默认收起）：关联模板、辅助文件、Python 环境配置 */}
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              onClick={() => setShowDeps(!showDeps)}
            >
              {showDeps ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              模板与依赖 {showDeps ? '（点击收起）' : '（点击展开）'}
            </button>
            {showDeps && (
            <div className="space-y-4 rounded-md border p-3">
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
              {editTarget ? (
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
              ) : (
                <Label>辅助文件（txt/xlsx/md/html等，选填）</Label>
              )}
              {editTarget && meta.auxiliaryFiles.length > 0 && (
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
                <PythonVersionSelector
                  value={meta.pythonVersion}
                  onChange={(v) => setMeta({ ...meta, pythonVersion: v })}
                />
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
            )}
          </div>
          </div>
          {/* 固定在底部的按钮栏（不随表单滚动） */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            {editTarget ? (
              <Button onClick={handleEdit} disabled={uploading}>{uploading ? '保存中...' : '保存修改'}</Button>
            ) : (
              <Button onClick={handleUpload} disabled={uploading}>{uploading ? '上传中...' : '确认上传'}</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showClearFilesDialog}
        onOpenChange={setShowClearFilesDialog}
        onConfirm={handleClearFiles}
        title="清空脚本文件"
        description={`确定要清空「${editTarget?.name || ''}」的所有脚本文件吗？此操作将删除多文件模式下的全部 .py 文件，且不可撤销。`}
        destructive
      />

      {/* ═════ Template Picker ═════ */}
      <TemplatePicker
        open={showTemplatePicker}
        onOpenChange={setShowTemplatePicker}
        docTemplates={docTemplates}
        selectedTemplateIds={meta.templateIds}
        onSelectionChange={(ids) => setMeta({ ...meta, templateIds: ids })}
        onOpenUpload={onOpenTemplateUpload}
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

      {/* ═════ Python 版本切换确认弹窗 ═════ */}
      <Dialog open={showVersionConfirm} onOpenChange={(open) => { if (!open) setShowVersionConfirm(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />确认切换 Python 版本
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            您正在将 Python 版本从 <strong className="text-foreground">{editTarget?.pythonVersion === 'embedded' ? 'embedded（默认）' : `Python ${editTarget?.pythonVersion}`}</strong> 变更为 <strong className="text-foreground">{meta.pythonVersion === 'embedded' ? 'embedded（默认）' : `Python ${meta.pythonVersion}`}</strong>，脚本运行环境及依赖需要重新安装，请确认是否继续。
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowVersionConfirm(false);
                if (editTarget) setMeta({ ...meta, pythonVersion: editTarget.pythonVersion || 'embedded' });
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowVersionConfirm(false);
                doSaveEdit();
              }}
            >
              继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <EmptyState title="暂无依赖" description="请添加或导入" />
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
    </>
  );
}
