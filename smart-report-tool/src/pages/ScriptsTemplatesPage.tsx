import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { apiPost } from '@/services/api';
import { canAccess } from '@/utils/permissions';
import { Script, ScriptType, DocTemplate, DocTemplateType, AuxFile, AuxFileType, LogCategory } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { FileUploader } from '@/components/common/FileUploader';
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
import { Trash2, Plus, Pencil, File, X, Upload, PackageOpen } from 'lucide-react';

type SCRIPT_TYPE_LABELS = Record<ScriptType, string>;
const SCRIPT_TYPE_LABELS: SCRIPT_TYPE_LABELS = { python: 'Python', bat: 'BAT', ps1: 'PowerShell', sh: 'Shell', powershell: 'PowerShell 7' };
const LOG_CATEGORY_LABELS: Record<LogCategory, string> = { host: '主机', storage: '存储', database: '数据库', virtualization: '虚拟化', network: '网络' };

const emptyMeta = () => ({ name: '', description: '', scriptType: 'python' as ScriptType, version: '1.0.0', category: 'host' as LogCategory, templateRequired: false, templateIds: [] as string[], auxiliaryFiles: [] as AuxFile[], requirements: [] as string[] });

export default function ScriptsTemplatesPage() {
  const { user } = useAuthStore();
  const { scripts, fetchScripts, addScript, removeScript } = useScriptStore();
  const { docTemplates, fetchDocTemplates, removeDocTemplate } = useDocTemplateStore();
  const canManage = canAccess(user?.role, 'scripts');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialogs
  const [showScriptUpload, setShowScriptUpload] = useState(false);
  const [showTplUpload, setShowTplUpload] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<Script | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);
  const [deleteTplTarget, setDeleteTplTarget] = useState<DocTemplate | null>(null);

  // Form state
  const [meta, setMeta] = useState(emptyMeta());
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [auxFiles, setAuxFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [requirementsText, setRequirementsText] = useState('');

  // Template form
  const [tplMeta, setTplMeta] = useState({ name: '', description: '', compatibleScriptType: 'python' as ScriptType });
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

  const filteredGroups = scriptGroups.filter((g) =>
    !searchQuery || g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSelectedScript = (group: { name: string; items: Script[] }): Script | undefined => {
    const selId = versionSelections[group.name];
    return group.items.find((s) => s.id === selId) || group.items[0];
  };

  // ── Open dialogs ──
  const openUpload = () => { setMeta(emptyMeta()); setUploadFiles([]); setAuxFiles([]); setRequirementsText(''); setShowScriptUpload(true); };
  const openEdit = (script: Script) => {
    setEditTarget(script);
    setMeta({ name: script.name, description: script.description, scriptType: script.scriptType, version: script.version, category: script.category, templateRequired: script.templateRequired, templateIds: [...script.templateIds], auxiliaryFiles: [...script.auxiliaryFiles], requirements: script.requirements || [] });
    setRequirementsText((script.requirements || []).join('\n'));
    setUploadFiles([]);
    setAuxFiles([]);
    setShowEdit(true);
  };

  // ── Helpers ──
  const readAuxFiles = async (files: File[]): Promise<AuxFile[]> => {
    return Promise.all(files.map(async (f) => {
      const ext = (f.name.split('.').pop()?.toLowerCase() || 'txt') as AuxFileType;
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] || reader.result as string);
        reader.readAsDataURL(f);
      });
      return { name: f.name, size: f.size, type: ext, content };
    }));
  };

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
      toast.success(`已从 ${file.name} 导入依赖配置`);
    } catch {
      toast.error('读取文件失败');
    }
    e.target.value = '';
  };

  // ── Upload script ──
  const handleUpload = async () => {
    if (!meta.name.trim()) { toast.error('请填写脚本名称'); return; }
    if (uploadFiles.length === 0) { toast.error('请选择脚本文件'); return; }
    setUploading(true);
    try {
      for (const file of uploadFiles) {
        const formData = new FormData();
        formData.append('name', meta.name.trim());
        formData.append('description', meta.description);
        formData.append('scriptType', meta.scriptType);
        formData.append('version', meta.version);
        formData.append('category', meta.category);
        formData.append('templateRequired', String(meta.templateRequired));
        formData.append('templateIds', JSON.stringify(meta.templateRequired ? meta.templateIds : []));
        formData.append('uploadedBy', user?.id || '');
        formData.append('requirements', JSON.stringify(parseRequirements()));
        formData.append('scriptFile', file);
        // Auxiliary files
        auxFiles.forEach((af, idx) => {
          formData.append(`auxFile${idx}`, af);
        });
        await apiPost('/scripts', formData);
      }
      setShowScriptUpload(false);
      setMeta(emptyMeta());
      setUploadFiles([]);
      setAuxFiles([]);
      await fetchScripts();
      toast.success(`上传成功（${uploadFiles.length} 个文件）`);
    } catch (e) {
      toast.error(`上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    finally { setUploading(false); }
  };

  // ── Edit script ──
  const handleEdit = async () => {
    if (!editTarget || !meta.name.trim()) { toast.error('请填写脚本名称'); return; }
    setUploading(true);
    try {
      const parsedAux = meta.auxiliaryFiles;
      if (auxFiles.length > 0) {
        const newAux = await readAuxFiles(auxFiles);
        parsedAux.push(...newAux);
      }
      let content = editTarget.content;
      let fileName = editTarget.fileName;
      let fileSize = editTarget.fileSize;
      if (uploadFiles.length > 0) {
        content = await uploadFiles[0].text();
        fileName = uploadFiles[0].name;
        fileSize = uploadFiles[0].size;
      }
      const updated: Script = {
        ...editTarget,
        name: meta.name.trim(), description: meta.description, scriptType: meta.scriptType,
        version: meta.version, category: meta.category, fileName, fileSize, content,
        templateRequired: meta.templateRequired,
        templateIds: meta.templateRequired ? meta.templateIds : [],
        auxiliaryFiles: parsedAux,
        requirements: parseRequirements(),
      };
      await addScript(updated);
      setShowEdit(false);
      toast.success('保存成功');
    } catch { toast.error('保存失败'); }
    finally { setUploading(false); }
  };

  const removeAuxFromMeta = (idx: number) => {
    const updated = meta.auxiliaryFiles.filter((_, i) => i !== idx);
    setMeta({ ...meta, auxiliaryFiles: updated });
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
        formData.append('compatibleScriptType', tplMeta.compatibleScriptType);
        formData.append('uploadedBy', user?.id || '');
        formData.append('templateFile', file);
        await apiPost('/templates', formData);
      }
      setShowTplUpload(false);
      setTplMeta({ name: '', description: '', compatibleScriptType: 'python' });
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

  // ── Render ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">脚本及模板管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setTplMeta({ name: '', description: '', compatibleScriptType: 'python' }); setTplFiles([]); setShowTplUpload(true); }}>
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
          <SearchFilter value={searchQuery} onChange={setSearchQuery} placeholder="搜索脚本名称..." />
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
                            {sel.templateRequired && <Badge className="bg-amber-100 text-amber-800">需模板</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {sel.description || sel.fileName} · {formatFileSize(sel.fileSize)}
                            {sel.auxiliaryFiles.length > 0 && ` · 辅助文件 ${sel.auxiliaryFiles.length} 个`}
                          </p>
                          {sel.templateRequired && linkedTpls.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {linkedTpls.map((t) => <Badge key={t.id} variant="outline" className="text-xs">{t.name}</Badge>)}
                            </div>
                          )}
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
                          {canManage && (
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
                          <p className="text-xs text-muted-foreground mb-1">辅助文件：</p>
                          <div className="flex gap-2 flex-wrap">
                            {sel.auxiliaryFiles.map((af, i) => (
                              <Badge key={i} variant="outline" className="text-xs gap-1">
                                <File className="h-3 w-3" />{af.name}
                              </Badge>
                            ))}
                          </div>
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
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{tpl.name}</span>
                      <Badge variant="outline">{tpl.fileType.toUpperCase()}</Badge>
                      <Badge variant="secondary">{SCRIPT_TYPE_LABELS[tpl.compatibleScriptType]}</Badge>
                      <span className="text-xs text-muted-foreground">{formatFileSize(tpl.fileSize)}</span>
                    </div>
                    {canManage && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTplTarget(tpl)}><Trash2 className="h-4 w-4" /></Button>
                    )}
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
            <div className="space-y-2"><Label>备注</Label><Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="选填" rows={2} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本类型</Label>
                <Select value={meta.scriptType} onValueChange={(v) => setMeta({ ...meta, scriptType: v as ScriptType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SCRIPT_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>分类</Label>
                <Select value={meta.category} onValueChange={(v) => setMeta({ ...meta, category: v as LogCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LOG_CATEGORY_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>脚本文件</Label>
              <FileUploader files={uploadFiles} onFilesChange={setUploadFiles} triggerMode="manual" acceptedTypes=".sh,.py,.ps1,.bat,.txt" maxSizeMB={5} />
            </div>
            <div className="space-y-2">
              <Label>辅助文件（txt/xlsx/md/html等，选填）</Label>
              <FileUploader files={auxFiles} onFilesChange={setAuxFiles} triggerMode="manual" acceptedTypes=".txt,.xlsx,.md,.html,.csv,.json" maxSizeMB={10} />
            </div>
            {meta.scriptType === 'python' && (
              <div className="space-y-2 border rounded-lg p-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5"><PackageOpen className="h-3.5 w-3.5" />Python 环境配置</Label>
                  <label className="cursor-pointer text-xs text-primary hover:underline flex items-center gap-1">
                    <Upload className="h-3 w-3" />导入 requirements.txt
                    <input type="file" accept=".txt" className="hidden" onChange={handleImportRequirements} />
                  </label>
                </div>
                <Textarea
                  value={requirementsText}
                  onChange={(e) => setRequirementsText(e.target.value)}
                  placeholder={"每行一个依赖包，如：\npython-docx\npandas>=1.0\nopenpyxl"}
                  rows={4}
                  className="text-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">生成报告时自动检查并安装缺失的依赖包</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={meta.templateRequired} onCheckedChange={(v) => setMeta({ ...meta, templateRequired: v })} />
              <Label className="cursor-pointer">需要关联模板生成报告</Label>
            </div>
            {meta.templateRequired && (
              <div className="space-y-2">
                <Label>关联模板（可多选）</Label>
                <div className="flex flex-wrap gap-2">
                  {docTemplates.map((t) => {
                    const isSel = meta.templateIds.includes(t.id);
                    return (
                      <Badge key={t.id} variant={isSel ? 'default' : 'outline'} className="cursor-pointer" onClick={() => {
                        setMeta({ ...meta, templateIds: isSel ? meta.templateIds.filter((id) => id !== t.id) : [...meta.templateIds, t.id] });
                      }}>{t.name} ({t.fileType})</Badge>
                    );
                  })}
                </div>
                {docTemplates.length === 0 && <p className="text-xs text-muted-foreground">暂无模板，请先上传模板</p>}
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
            <div className="space-y-2"><Label>备注</Label><Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} rows={2} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>脚本类型</Label>
                <Select value={meta.scriptType} onValueChange={(v) => setMeta({ ...meta, scriptType: v as ScriptType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SCRIPT_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>分类</Label>
                <Select value={meta.category} onValueChange={(v) => setMeta({ ...meta, category: v as LogCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LOG_CATEGORY_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>脚本文件（留空则保留原文件）</Label>
              <FileUploader files={uploadFiles} onFilesChange={setUploadFiles} triggerMode="manual" acceptedTypes=".sh,.py,.ps1,.bat,.txt" maxSizeMB={5} />
              {editTarget && !uploadFiles.length && <p className="text-xs text-muted-foreground">当前：{editTarget.fileName} ({formatFileSize(editTarget.fileSize)})</p>}
            </div>
            <div className="space-y-2">
              <Label>辅助文件</Label>
              {meta.auxiliaryFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {meta.auxiliaryFiles.map((af, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      <File className="h-3 w-3" />{af.name}
                      <button onClick={() => removeAuxFromMeta(i)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
              <FileUploader files={auxFiles} onFilesChange={setAuxFiles} triggerMode="manual" acceptedTypes=".txt,.xlsx,.md,.html,.csv,.json" maxSizeMB={10} />
            </div>
            {meta.scriptType === 'python' && (
              <div className="space-y-2 border rounded-lg p-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5"><PackageOpen className="h-3.5 w-3.5" />Python 环境配置</Label>
                  <label className="cursor-pointer text-xs text-primary hover:underline flex items-center gap-1">
                    <Upload className="h-3 w-3" />导入 requirements.txt
                    <input type="file" accept=".txt" className="hidden" onChange={handleImportRequirements} />
                  </label>
                </div>
                <Textarea
                  value={requirementsText}
                  onChange={(e) => setRequirementsText(e.target.value)}
                  placeholder={"每行一个依赖包，如：\npython-docx\npandas>=1.0\nopenpyxl"}
                  rows={4}
                  className="text-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">生成报告时自动检查并安装缺失的依赖包</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={meta.templateRequired} onCheckedChange={(v) => setMeta({ ...meta, templateRequired: v })} />
              <Label className="cursor-pointer">需要关联模板生成报告</Label>
            </div>
            {meta.templateRequired && (
              <div className="space-y-2">
                <Label>关联模板（可多选）</Label>
                <div className="flex flex-wrap gap-2">
                  {docTemplates.map((t) => {
                    const isSel = meta.templateIds.includes(t.id);
                    return (
                      <Badge key={t.id} variant={isSel ? 'default' : 'outline'} className="cursor-pointer" onClick={() => {
                        setMeta({ ...meta, templateIds: isSel ? meta.templateIds.filter((id) => id !== t.id) : [...meta.templateIds, t.id] });
                      }}>{t.name} ({t.fileType})</Badge>
                    );
                  })}
                </div>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>模板名称</Label><Input value={tplMeta.name} onChange={(e) => setTplMeta({ ...tplMeta, name: e.target.value })} placeholder="必填" /></div>
              <div className="space-y-2"><Label>适配脚本类型</Label>
                <Select value={tplMeta.compatibleScriptType} onValueChange={(v) => setTplMeta({ ...tplMeta, compatibleScriptType: v as ScriptType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SCRIPT_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>备注</Label><Textarea value={tplMeta.description} onChange={(e) => setTplMeta({ ...tplMeta, description: e.target.value })} rows={2} /></div>
            <FileUploader files={tplFiles} onFilesChange={setTplFiles} triggerMode="manual" acceptedTypes=".docx,.xlsx,.md,.pdf" maxSizeMB={20} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTplUpload(false)}>取消</Button>
            <Button onClick={handleTplUpload} disabled={tplUploading}>{tplUploading ? '上传中...' : '确认上传'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} onConfirm={handleDelete} title="删除脚本" description={`确定要删除「${deleteTarget?.name}」v${deleteTarget?.version} 吗？`} />
      <ConfirmDialog open={!!deleteTplTarget} onOpenChange={() => setDeleteTplTarget(null)} onConfirm={handleDeleteTpl} title="删除模板" description={`确定要删除「${deleteTplTarget?.name}」吗？`} />
    </div>
  );
}
