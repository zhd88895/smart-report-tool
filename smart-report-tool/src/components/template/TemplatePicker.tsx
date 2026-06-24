import { useState } from 'react';
import { Search, Check, Plus, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocTemplate } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { downloadFile } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docTemplates: DocTemplate[];
  selectedTemplateIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onOpenUpload: () => void;
}

export function TemplatePicker({ open, onOpenChange, docTemplates, selectedTemplateIds, onSelectionChange, onOpenUpload }: TemplatePickerProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');

  const handleClose = () => {
    onOpenChange(false);
    setSearch('');
    setFilterType('');
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle>选择关联模板</DialogTitle></DialogHeader>
        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          {/* 搜索 + 上传 */}
          <div className="flex items-center gap-2 py-1">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模板名称..."
                className="pl-8 h-9 w-full focus-visible:ring-1 focus-visible:ring-offset-0"
              />
            </div>
            <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={onOpenUpload}>
              <Plus className="h-3.5 w-3.5 mr-1" />上传新模板
            </Button>
          </div>

          {/* 格式筛选 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={filterType === '' ? 'default' : 'outline'} className="cursor-pointer select-none text-xs" onClick={() => setFilterType('')}>全部</Badge>
            {['docx', 'doc', 'xlsx', 'pdf', 'md'].map((ft) => (
              <Badge key={ft} variant={filterType === ft ? 'default' : 'outline'} className="cursor-pointer select-none text-xs" onClick={() => setFilterType(filterType === ft ? '' : ft)}>
                .{ft}
              </Badge>
            ))}
          </div>

          {/* 模板列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg">
            {(() => {
              const filtered = docTemplates.filter((t) => {
                if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
                if (filterType && t.fileType !== filterType) return false;
                return true;
              });
              if (filtered.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-12">{search || filterType ? '无匹配模板' : '暂无模板，请上传'}</p>;
              }
              return (
                <div className="divide-y">
                  {filtered.map((t) => {
                    const isSel = selectedTemplateIds.includes(t.id);
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 hover:bg-accent cursor-pointer transition-colors',
                          isSel && 'bg-primary/5'
                        )}
                        onClick={() => {
                          onSelectionChange(
                            isSel
                              ? selectedTemplateIds.filter((id) => id !== t.id)
                              : [...selectedTemplateIds, t.id]
                          );
                        }}
                      >
                        {/* Checkbox */}
                        <div className={cn(
                          'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                          isSel ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                        )}>
                          {isSel && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.fileType.toUpperCase()} · {formatFileSize(t.fileSize)}
                            {t.description && <span className="ml-2 opacity-60">{t.description}</span>}
                          </p>
                        </div>
                        {/* Actions */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadFile(`/templates/${t.id}/download`, t.fileName);
                          }}
                        >
                          <Download className="h-3 w-3 mr-1" />下载
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* 底部选中统计 */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              已选 {selectedTemplateIds.length} 个模板
              {selectedTemplateIds.length > 0 && (
                <button className="ml-2 text-primary hover:underline" onClick={() => onSelectionChange([])}>清空</button>
              )}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleClose}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
