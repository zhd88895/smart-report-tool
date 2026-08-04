import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  createModel, updateModel, setDefaultModel,
  type AIModel,
} from '@/services/aiConfigService';

interface ModelForm {
  modelId: string;
  displayName: string;
  temperature: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  isDefault: boolean;
}

const EMPTY_MODEL_FORM: ModelForm = {
  modelId: '', displayName: '', temperature: '0.7',
  maxInputTokens: '128000', maxOutputTokens: '4096', isDefault: false,
};

interface ModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前选中厂商 ID（新增模型时必填） */
  providerId: string | null;
  /** null 表示新增 */
  editingModel: AIModel | null;
  /** 保存成功后回调（通常为重新加载模型与厂商列表） */
  onSaved: () => Promise<void> | void;
}

/** 添加/编辑模型弹窗 */
export function ModelDialog({ open, onOpenChange, providerId, editingModel, onSaved }: ModelDialogProps) {
  const [form, setForm] = useState<ModelForm>(EMPTY_MODEL_FORM);
  const [saving, setSaving] = useState(false);

  // 弹窗打开时初始化表单：新增用空表单，编辑回填现有模型
  useEffect(() => {
    if (!open) return;
    if (editingModel) {
      setForm({
        modelId: editingModel.modelId,
        displayName: editingModel.displayName,
        temperature: String(editingModel.temperature),
        maxInputTokens: String(editingModel.maxInputTokens),
        maxOutputTokens: String(editingModel.maxOutputTokens),
        isDefault: editingModel.isDefault,
      });
    } else {
      setForm(EMPTY_MODEL_FORM);
    }
  }, [open, editingModel]);

  const handleSave = async () => {
    if (!providerId) return;
    if (!form.modelId.trim()) { toast.error('请填写模型 ID'); return; }
    const temperature = Number(form.temperature);
    const maxInputTokens = Number(form.maxInputTokens);
    const maxOutputTokens = Number(form.maxOutputTokens);
    if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) {
      toast.error('温度需为 0-2 之间的数字'); return;
    }
    if (!Number.isInteger(maxInputTokens) || maxInputTokens <= 0) {
      toast.error('输入上限需为正整数'); return;
    }
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      toast.error('输出上限需为正整数'); return;
    }
    setSaving(true);
    try {
      if (editingModel) {
        await updateModel(editingModel.id, {
          displayName: form.displayName.trim() || form.modelId.trim(),
          temperature, maxInputTokens, maxOutputTokens,
        });
        if (form.isDefault && !editingModel.isDefault) {
          await setDefaultModel(editingModel.id);
        }
        toast.success('模型已更新');
      } else {
        // 创建接口只收 modelId/displayName，其余参数创建后再更新
        const created = await createModel(providerId, {
          modelId: form.modelId.trim(),
          displayName: form.displayName.trim() || form.modelId.trim(),
        });
        await updateModel(created.id, { temperature, maxInputTokens, maxOutputTokens });
        if (form.isDefault) await setDefaultModel(created.id);
        toast.success('模型已添加');
      }
      onOpenChange(false);
      await onSaved();
    } catch (err: any) {
      toast.error(err.message || '保存模型失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingModel ? '编辑模型' : '添加模型'}</DialogTitle>
          <DialogDescription>模型 ID 需与厂商接口返回的标识一致</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>模型 ID</Label>
            <Input
              value={form.modelId}
              onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
              placeholder="例如：mimo-v2.5-pro"
              disabled={!!editingModel}
            />
          </div>
          <div className="space-y-2">
            <Label>显示名</Label>
            <Input
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="留空则与模型 ID 相同"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>温度（0-2）</Label>
              <Input
                type="number" step="0.1" min="0" max="2"
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>输入上限</Label>
              <Input
                type="number" min="1"
                value={form.maxInputTokens}
                onChange={(e) => setForm((f) => ({ ...f, maxInputTokens: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>输出上限</Label>
              <Input
                type="number" min="1"
                value={form.maxOutputTokens}
                onChange={(e) => setForm((f) => ({ ...f, maxOutputTokens: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="cursor-pointer">设为默认模型</Label>
            <Switch
              checked={form.isDefault}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isDefault: v }))}
              disabled={editingModel?.isDefault}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
