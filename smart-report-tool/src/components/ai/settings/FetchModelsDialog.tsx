import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import { fetchProviderModels, createModel } from '@/services/aiConfigService';

interface FetchModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前选中厂商 ID */
  providerId: string | null;
  /** 导入完成后回调（通常为重新加载模型与厂商列表） */
  onImported: () => Promise<void> | void;
}

/**
 * 拉取模型列表弹窗（差量勾选导入：fetch-models 不带 import 拿差量，
 * 勾选后逐个 POST models 添加）
 */
export function FetchModelsDialog({ open, onOpenChange, providerId, onImported }: FetchModelsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // 弹窗打开时自动拉取差量模型；失败则提示并关闭弹窗
  useEffect(() => {
    if (!open || !providerId) return;
    (async () => {
      setLoading(true);
      setDiff([]);
      setSelected(new Set());
      try {
        const result = await fetchProviderModels(providerId, false);
        setDiff(result.newModels);
        setSelected(new Set(result.newModels));
        if (result.newModels.length === 0) {
          toast.info(`远端共 ${result.remoteCount} 个模型，均已添加`);
        }
      } catch (err: any) {
        toast.error(err.message || '拉取远端模型失败');
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerId]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (!providerId || selected.size === 0) return;
    setImporting(true);
    let success = 0;
    let failed = 0;
    for (const id of selected) {
      try {
        await createModel(providerId, { modelId: id, displayName: id });
        success += 1;
      } catch {
        failed += 1;
      }
    }
    setImporting(false);
    onOpenChange(false);
    if (failed === 0) toast.success(`已导入 ${success} 个模型`);
    else toast.warning(`导入完成：成功 ${success} 个，失败 ${failed} 个`);
    await onImported();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>拉取模型列表</DialogTitle>
          <DialogDescription>
            以下为远端有而本地未添加的模型，勾选后确认导入
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <LoadingSpinner text="正在拉取远端模型..." className="py-10" />
        ) : diff.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">没有可导入的新模型</p>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-2 rounded-md border p-3">
            {diff.map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selected.has(id)}
                  onCheckedChange={(v) => toggleSelected(id, v)}
                />
                <span className="font-mono">{id}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={handleImportSelected}
            disabled={importing || loading || selected.size === 0}
          >
            {importing
              ? <><LoadingSpinner className="inline-flex py-0 mr-1" />导入中...</>
              : `确认导入（${selected.size}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
