import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { downloadFile } from '@/services/api';
import { canAccess } from '@/utils/permissions';
import { DocTemplate } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { toast } from 'sonner';
import { Trash2, Pencil, Download } from 'lucide-react';

export interface TemplateListPanelProps {
  /** 点击编辑模板（由页面打开编辑对话框） */
  onEditTemplate: (tpl: DocTemplate) => void;
}

export function TemplateListPanel({ onEditTemplate }: TemplateListPanelProps) {
  const { user } = useAuthStore();
  const { docTemplates, removeDocTemplate } = useDocTemplateStore();
  const canManage = canAccess(user?.role, 'scripts');
  const [deleteTplTarget, setDeleteTplTarget] = useState<DocTemplate | null>(null);

  const handleDeleteTpl = async () => {
    if (deleteTplTarget) { await removeDocTemplate(deleteTplTarget.id); setDeleteTplTarget(null); toast.success('已删除'); }
  };

  const handleTplDownload = (tpl: DocTemplate) => {
    downloadFile(`/templates/${tpl.id}/download`, tpl.fileName);
  };

  return (
    <>
      {docTemplates.length === 0 ? (
        <EmptyState title="暂无模板" description="点击右上角「上传模板」开始使用" />
      ) : (
        <div className="space-y-3">
          {docTemplates.map((tpl) => (
            <Card key={tpl.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{tpl.name}</span>
                    <Badge variant="outline" className="text-xs">{tpl.fileType.toUpperCase()}</Badge>
                    <span className="text-xs text-muted-foreground">{formatFileSize(tpl.fileSize)}</span>
                  </div>
                  {tpl.description && (
                    <p className="text-xs text-muted-foreground mt-1 truncate" title={tpl.description}>{tpl.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleTplDownload(tpl)} title="下载模板文件">
                    <Download className="h-4 w-4" />
                  </Button>
                  {canManage && (
                    <>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditTemplate(tpl)} title="编辑模板">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTplTarget(tpl)} title="删除模板">
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

      <ConfirmDialog open={!!deleteTplTarget} onOpenChange={() => setDeleteTplTarget(null)} onConfirm={handleDeleteTpl} title="删除模板" description={`确定要删除「${deleteTplTarget?.name}」吗？`} />
    </>
  );
}
