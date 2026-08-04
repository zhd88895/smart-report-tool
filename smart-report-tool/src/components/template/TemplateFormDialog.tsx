import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { apiPost } from '@/services/api';
import { DocTemplate, DocTemplateType } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { FileUploader } from '@/components/common/FileUploader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

export interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑目标；为 null 时是上传模式 */
  editTarget: DocTemplate | null;
}

/** 上传 / 编辑模板共用的表单对话框（editTarget 为空即上传模式） */
export function TemplateFormDialog({ open, onOpenChange, editTarget }: TemplateFormDialogProps) {
  const { user } = useAuthStore();
  const { fetchDocTemplates, updateDocTemplateWithFile } = useDocTemplateStore();

  // Template form
  const [tplMeta, setTplMeta] = useState({ name: '', description: '' });
  const [tplFiles, setTplFiles] = useState<File[]>([]);
  const [tplUploading, setTplUploading] = useState(false);
  const [tplReuploadFile, setTplReuploadFile] = useState<File[]>([]);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  // 打开对话框时初始化表单（render 期间派生状态，避免旧数据闪现）：
  // 上传模式 = 重置为空表单；编辑模式 = 从 editTarget 回填
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      if (editTarget) {
        setTplMeta({ name: editTarget.name, description: editTarget.description || '' });
        setTplReuploadFile([]);
      } else {
        setTplMeta({ name: '', description: '' });
        setTplFiles([]);
      }
    }
  }

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
      onOpenChange(false);
      setTplMeta({ name: '', description: '' });
      setTplFiles([]);
      await fetchDocTemplates();
      toast.success(`模板上传成功（${tplFiles.length} 个文件）`);
    } catch (e) {
      toast.error(`上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    finally { setTplUploading(false); }
  };

  // ── Template edit ──
  const handleTplEdit = async () => {
    if (!editTarget || !tplMeta.name.trim()) { toast.error('请填写模板名称'); return; }
    if (tplReuploadFile.length > 0) {
      // 有文件需要覆盖 — 显示确认弹窗
      setShowOverwriteConfirm(true);
      return;
    }
    await saveTplEdit();
  };

  const saveTplEdit = async () => {
    if (!editTarget) return;
    try {
      if (tplReuploadFile.length > 0) {
        const formData = new FormData();
        formData.append('name', tplMeta.name.trim());
        formData.append('description', tplMeta.description);
        const file = tplReuploadFile[0];
        const ext = file.name.split('.').pop()?.toLowerCase();
        formData.append('fileType', ext || 'docx');
        formData.append('templateFile', file);
        await updateDocTemplateWithFile(editTarget.id, formData);
      } else {
        const { updateDocTemplate } = useDocTemplateStore.getState();
        await updateDocTemplate(editTarget.id, { name: tplMeta.name.trim(), description: tplMeta.description });
      }
      onOpenChange(false);
      setShowOverwriteConfirm(false);
      toast.success('模板已更新');
    } catch { toast.error('更新失败'); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editTarget ? '编辑模板' : '上传模板'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>模板名称</Label><Input value={tplMeta.name} onChange={(e) => setTplMeta({ ...tplMeta, name: e.target.value })} placeholder="必填" /></div>
            <div className="space-y-2"><Label>备注（{tplMeta.description.length}/100）</Label><Textarea value={tplMeta.description} onChange={(e) => setTplMeta({ ...tplMeta, description: e.target.value })} rows={2} maxLength={100} placeholder="选填，最多100字" /></div>
            {editTarget ? (
              <div className="space-y-2">
                <Label>重新上传模板文件（选填，将覆盖原文件）</Label>
                <FileUploader files={tplReuploadFile} onFilesChange={(files) => setTplReuploadFile(files.slice(-1))} triggerMode="manual" acceptedTypes=".docx,.xlsx,.md,.pdf" maxSizeMB={20} />
                {!tplReuploadFile.length && (
                  <p className="text-sm font-medium mt-1">当前文件：{editTarget.fileName} ({formatFileSize(editTarget.fileSize)})</p>
                )}
              </div>
            ) : (
              <FileUploader files={tplFiles} onFilesChange={setTplFiles} triggerMode="manual" acceptedTypes=".docx,.xlsx,.md,.pdf" maxSizeMB={20} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { onOpenChange(false); setShowOverwriteConfirm(false); }}>取消</Button>
            {editTarget ? (
              <Button onClick={handleTplEdit}>保存修改</Button>
            ) : (
              <Button onClick={handleTplUpload} disabled={tplUploading}>{tplUploading ? '上传中...' : '确认上传'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={showOverwriteConfirm} onOpenChange={() => setShowOverwriteConfirm(false)} onConfirm={saveTplEdit} title="确认覆盖模板文件" description={`将使用「${tplReuploadFile[0]?.name || ''}」替换原有模板文件「${editTarget?.fileName || ''}」，此操作不可撤销。确定继续吗？`} />
    </>
  );
}
