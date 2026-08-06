/**
 * 知识库管理页面
 *
 * 功能：
 * 1. 分类管理（创建、编辑、删除）
 * 2. 文件上传与解析
 * 3. 文件列表、搜索、删除
 *
 * @page KnowledgeBasePage
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  FolderPlus, Upload, Search, Trash2, Edit, FileText, FileCode,
  Archive, RefreshCw, Folder, AlertCircle, Download, X,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { AdminPasswordDialog } from '@/components/common/AdminPasswordDialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';

// ── 类型 ──

interface KBCategory {
  id: string;
  name: string;
  description?: string;
  color: string;
  sort_order: number;
  file_count?: number;
  created_at: string;
}

interface KBFile {
  id: string;
  category_id?: string;
  title: string;
  file_name: string;
  file_size: number;
  file_type: string;
  file_ext: string;
  content_length: number;
  status: string;
  error_message?: string;
  uploaded_by?: string;
  created_at: string;
}

// ── 辅助函数 ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(ext: string) {
  switch (ext) {
    case '.md': case '.markdown': return <FileCode className="h-4 w-4 text-blue-500" />;
    case '.html': case '.htm': return <FileCode className="h-4 w-4 text-orange-500" />;
    case '.pdf': return <Archive className="h-4 w-4 text-red-500" />;
    case '.docx': case '.doc': return <FileText className="h-4 w-4 text-indigo-500" />;
    case '.txt': case '.text': return <FileText className="h-4 w-4 text-gray-500" />;
    default: return <FileText className="h-4 w-4" />;
  }
}

// ── 页面组件 ──

export default function KnowledgeBasePage() {
  const [categories, setCategories] = useState<KBCategory[]>([]);
  const [files, setFiles] = useState<KBFile[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // 分类编辑对话框
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<KBCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');

  // 文件上传对话框（支持批量）
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadCategory, setUploadCategory] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // 删除确认对话框
  const [deleteCatTarget, setDeleteCatTarget] = useState<KBCategory | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<KBFile | null>(null);

  // ── 数据加载 ──

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge-base/categories', { credentials: 'include' });
      const data = await res.json();
      if (data.code === 200) setCategories(data.data || []);
    } catch { /* silent */ }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/api/knowledge-base/files';
      if (selectedCategoryId) url += `?categoryId=${selectedCategoryId}`;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (data.code === 200) setFiles(data.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [selectedCategoryId]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  // ── 分类操作 ──

  const openNewCategory = () => {
    setEditingCat(null);
    setCatName('');
    setCatDesc('');
    setCatDialogOpen(true);
  };

  const openEditCategory = (cat: KBCategory) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatDesc(cat.description || '');
    setCatDialogOpen(true);
  };

  const saveCategory = async () => {
    if (!catName.trim()) { toast.error('分类名称不能为空'); return; }
    try {
      if (editingCat) {
        await fetch(`/api/knowledge-base/categories/${editingCat.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify({ name: catName, description: catDesc }),
        });
        toast.success('分类更新成功');
      } else {
        await fetch('/api/knowledge-base/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify({ name: catName, description: catDesc }),
        });
        toast.success('分类创建成功');
      }
      setCatDialogOpen(false);
      loadCategories();
    } catch (e: any) { toast.error(`操作失败: ${e.message}`); }
  };

  const deleteCategory = (cat: KBCategory) => setDeleteCatTarget(cat);

  /** 删除类高危操作（分类/文件）统一走密码二次验证 */
  const [pwdAction, setPwdAction] = useState<{ kind: 'file' | 'category'; id: string; label: string } | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  const confirmDeleteCategory = () => {
    const cat = deleteCatTarget;
    if (!cat) return;
    setDeleteCatTarget(null);
    setPwdAction({ kind: 'category', id: cat.id, label: cat.name });
  };

  /** 输入密码后执行删除；失败（含密码错误）时弹窗保持打开可重试 */
  const handlePwdConfirm = async (password: string) => {
    const action = pwdAction;
    if (!action) return;
    setPwdLoading(true);
    try {
      const url = action.kind === 'file'
        ? `/api/knowledge-base/files/${action.id}`
        : `/api/knowledge-base/categories/${action.id}`;
      const res = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.code !== 200) {
        toast.error(data?.message || '删除失败');
        return; // 保持弹窗打开
      }
      toast.success(action.kind === 'file' ? '文件删除成功' : '分类删除成功');
      if (action.kind === 'category' && selectedCategoryId === action.id) setSelectedCategoryId(undefined);
      setPwdAction(null);
      loadCategories();
      loadFiles();
    } catch (e: any) {
      toast.error(`删除失败: ${e.message}`);
    } finally {
      setPwdLoading(false);
    }
  };

  // ── 文件操作 ──

  const openUpload = () => {
    setUploadFiles([]);
    setUploadCategory(selectedCategoryId || '');
    setUploadProgress('');
    setUploadDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (list.length === 0) return;
    const valid = list.filter((f) => {
      if (f.size > 200 * 1024 * 1024) {
        toast.error(`「${f.name}」超过 200MB，已跳过`);
        return false;
      }
      return true;
    });
    // 追加去重（同名同大小视为同一个文件）
    setUploadFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}_${f.size}`));
      return [...prev, ...valid.filter((f) => !seen.has(`${f.name}_${f.size}`))];
    });
    e.target.value = ''; // 允许重复选择同一文件
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const doUpload = async () => {
    if (uploadFiles.length === 0) { toast.error('请选择文件'); return; }
    setUploading(true);
    let ok = 0;
    const failed: string[] = [];
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const f = uploadFiles[i];
        setUploadProgress(`正在上传 ${i + 1}/${uploadFiles.length}：${f.name}`);
        try {
          const fd = new FormData();
          fd.append('file', f);
          if (uploadCategory) fd.append('categoryId', uploadCategory);
          const res = await fetch('/api/knowledge-base/files/upload', {
            method: 'POST', body: fd, credentials: 'include',
          });
          const data = await res.json();
          if (data.code === 200) {
            ok++;
          } else {
            failed.push(`「${f.name}」${data.message || '上传失败'}`);
          }
        } catch (e: any) {
          failed.push(`「${f.name}」${e.message}`);
        }
      }
      if (ok > 0) toast.success(`成功上传 ${ok} 个文件`);
      failed.forEach((msg) => toast.error(msg));
      if (failed.length === 0) setUploadDialogOpen(false);
      setUploadFiles((prev) => prev.filter((f) => failed.some((m) => m.includes(`「${f.name}」`))));
      loadFiles();
      loadCategories();
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const deleteFile = (file: KBFile) => setDeleteFileTarget(file);

  /** 下载知识库原始文件（直接走浏览器流式下载，不把大文件读进内存） */
  const downloadKbFile = (file: KBFile) => {
    const a = document.createElement('a');
    a.href = `/api/knowledge-base/files/${file.id}/download`;
    a.download = file.file_name || `${file.title}${file.file_ext || ''}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /** 重新解析失败的文件（后端补装解析库后可一键重试） */
  const [reparsingId, setReparsingId] = useState<string | null>(null);
  const reparseFile = async (file: KBFile) => {
    setReparsingId(file.id);
    try {
      const res = await fetch(`/api/knowledge-base/files/${file.id}/reparse`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json();
      if (data.code === 200 && data.data?.status === 'ready') {
        toast.success(data.message || '重新解析成功');
      } else {
        toast.error(data.message || '重新解析失败');
      }
      loadFiles();
    } catch (e: any) { toast.error(`重新解析失败: ${e.message}`); }
    finally { setReparsingId(null); }
  };

  const confirmDeleteFile = () => {
    const file = deleteFileTarget;
    if (!file) return;
    setDeleteFileTarget(null);
    setPwdAction({ kind: 'file', id: file.id, label: file.title || file.file_name });
  };

  const doSearch = async () => {
    if (!searchQuery.trim()) { loadFiles(); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/knowledge-base/files/search?q=${encodeURIComponent(searchQuery)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.code === 200) setFiles(data.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  // ── 文件列表列定义（DataTable，内置排序 + 列宽/显隐持久化） ──

  const fileColumns = [
    {
      key: 'file_name',
      header: '文件名',
      sortable: true,
      flex: true,
      render: (file: KBFile) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{getFileIcon(file.file_ext)}</span>
          <span className="font-medium truncate">{file.file_name}</span>
          {file.status === 'error' && (
            <Badge variant="destructive" className="text-xs shrink-0">
              <AlertCircle className="h-3 w-3 mr-1" />解析失败
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'file_size',
      header: '大小',
      sortable: true,
      minWidth: 90,
      sortValue: (file: KBFile) => file.file_size,
      render: (file: KBFile) => <span className="text-sm">{formatFileSize(file.file_size)}</span>,
    },
    {
      key: 'created_at',
      header: '上传时间',
      sortable: true,
      minWidth: 100,
      sortValue: (file: KBFile) => file.created_at,
      render: (file: KBFile) => (
        <span className="text-sm text-muted-foreground">
          {new Date(file.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '120px',
      minWidth: 110,
      sortable: false,
      hideable: false,
      render: (file: KBFile) => (
        <div className="flex gap-1 justify-end">
          {file.status === 'error' && (
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8"
              title="重新解析"
              disabled={reparsingId === file.id}
              onClick={() => reparseFile(file)}
            >
              <RefreshCw className={cn('h-4 w-4', reparsingId === file.id && 'animate-spin')} />
            </Button>
          )}
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8"
            title="下载文件"
            onClick={() => downloadKbFile(file)}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="删除文件"
            onClick={() => deleteFile(file)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  // ── 渲染 ──

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Folder className="h-6 w-6" />知识库管理
          </h2>
          <p className="text-sm text-muted-foreground mt-1">管理知识库分类与文件，支持在AI分析时关联参考</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openNewCategory}>
            <FolderPlus className="h-4 w-4 mr-1" />新建分类
          </Button>
          <Button size="sm" onClick={openUpload}>
            <Upload className="h-4 w-4 mr-1" />上传文件
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* 左侧：分类列表 */}
        <div className="w-56 shrink-0 space-y-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Folder className="h-4 w-4" />分类
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <button
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                  !selectedCategoryId ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                )}
                onClick={() => { setSelectedCategoryId(undefined); }}
              >
                <span>全部文件</span>
                <Badge variant="secondary" className="text-xs">{files.length}</Badge>
              </button>
              {categories.map((cat) => (
                <div key={cat.id} className="group flex items-center">
                  <button
                    className={cn(
                      'flex flex-1 items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                      selectedCategoryId === cat.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                    )}
                    onClick={() => { setSelectedCategoryId(cat.id); setSearchQuery(''); }}
                  >
                    <span className="truncate">{cat.name}</span>
                    <Badge variant="secondary" className="text-xs ml-1">{cat.file_count || 0}</Badge>
                  </button>
                  <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
                    <button className="p-1 hover:bg-accent rounded" onClick={() => openEditCategory(cat)}>
                      <Edit className="h-3 w-3" />
                    </button>
                    <button className="p-1 hover:bg-accent rounded" onClick={() => deleteCategory(cat)} title="删除分类">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">暂无分类</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：文件列表 */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* 搜索栏 */}
          <div className="flex gap-2">
            <Input
              placeholder="搜索文件标题或内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              className="flex-1"
            />
            <Button variant="outline" onClick={doSearch}>
              <Search className="h-4 w-4 mr-2" />搜索
            </Button>
            <Button variant="outline" onClick={loadFiles}>
              {loading ? <LoadingSpinner className="inline-flex py-0" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>

          {/* 文件列表 */}
          <Card>
            <CardContent className={files.length === 0 ? 'p-0' : 'p-4'}>
              {files.length === 0 ? (
                <EmptyState
                  title="暂无文件"
                  description="点击「上传文件」导入知识库内容，支持 Markdown、HTML、Word、PDF、TXT 格式"
                />
              ) : (
                <DataTable
                  columns={fileColumns}
                  data={files}
                  keyExtractor={(file) => file.id}
                  tableId="kb-files"
                />
              )}
            </CardContent>
          </Card>

          {/* 错误提示 */}
          {files.some(f => f.status === 'error') && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="py-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">部分文件解析失败</p>
                    <ul className="mt-1 space-y-1">
                      {files.filter(f => f.status === 'error').map(f => (
                        <li key={f.id} className="text-amber-700">
                          {f.title}: {f.error_message || '未知错误'}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* 分类编辑对话框 */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCat ? '编辑分类' : '新建分类'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>分类名称 *</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="例如：DELL服务器文档" />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Textarea value={catDesc} onChange={(e) => setCatDesc(e.target.value)} placeholder="分类描述（可选）" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>取消</Button>
            <Button onClick={saveCategory}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 文件上传对话框 */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传知识库文件</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>选择文件 *（可多选）</Label>
              <Input type="file" multiple onChange={handleFileSelect}
                accept=".md,.markdown,.html,.htm,.docx,.doc,.pdf,.txt,.text" />
              <p className="text-xs text-muted-foreground">支持 MD、HTML、Word、PDF、TXT，单文件最大200MB</p>
            </div>
            {uploadFiles.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-md border p-2">
                {uploadFiles.map((f, i) => (
                  <div key={`${f.name}_${f.size}_${i}`} className="flex items-center justify-between gap-2 text-sm px-1 py-0.5">
                    <span className="truncate">{f.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatFileSize(f.size)}</span>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeUploadFile(i)} disabled={uploading}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label>分类</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}
              >
                <option value="">未分类</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {uploading && uploadProgress && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <LoadingSpinner className="inline-flex py-0" />{uploadProgress}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)} disabled={uploading}>取消</Button>
            <Button onClick={doUpload} disabled={uploadFiles.length === 0 || uploading}>
              {uploading && <LoadingSpinner className="inline-flex py-0 mr-2" />}
              上传{uploadFiles.length > 0 ? `（${uploadFiles.length}）` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除分类确认 */}
      <ConfirmDialog
        open={!!deleteCatTarget}
        onOpenChange={() => setDeleteCatTarget(null)}
        title="删除分类"
        description={deleteCatTarget ? `确定删除分类"${deleteCatTarget.name}"吗？该分类下的文件将变为未分类。` : ''}
        onConfirm={confirmDeleteCategory}
        destructive
      />

      {/* 删除文件确认 */}
      <ConfirmDialog
        open={!!deleteFileTarget}
        onOpenChange={() => setDeleteFileTarget(null)}
        title="删除文件"
        description={deleteFileTarget ? `确定删除文件"${deleteFileTarget.title}"吗？` : ''}
        onConfirm={confirmDeleteFile}
        destructive
      />

      {/* 删除类高危操作的密码二次验证 */}
      <AdminPasswordDialog
        open={!!pwdAction}
        onOpenChange={(open) => { if (!open) setPwdAction(null); }}
        verifierLabel="您自己"
        description={pwdAction ? `即将删除${pwdAction.kind === 'file' ? '文件' : '分类'}「${pwdAction.label}」，此操作不可撤销。` : ''}
        loading={pwdLoading}
        onConfirm={(pwd) => { void handlePwdConfirm(pwd); }}
      />
    </div>
  );
}
