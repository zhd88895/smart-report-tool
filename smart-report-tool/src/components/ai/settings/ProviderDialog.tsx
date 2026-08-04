import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import {
  VENDOR_PRESETS, createProvider, updateProvider, testConnection,
  type AIProvider,
} from '@/services/aiConfigService';

interface ProviderForm {
  vendorKey: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_PROVIDER_FORM: ProviderForm = { vendorKey: 'mimo', name: '', baseUrl: '', apiKey: '' };

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null 表示新增 */
  editingProvider: AIProvider | null;
  /** 保存成功后回调（通常为重新加载厂商列表） */
  onSaved: () => Promise<void> | void;
}

/** 添加/编辑厂商弹窗 */
export function ProviderDialog({ open, onOpenChange, editingProvider, onSaved }: ProviderDialogProps) {
  const [form, setForm] = useState<ProviderForm>(EMPTY_PROVIDER_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // 弹窗打开时初始化表单：新增取第一个预设，编辑回填现有配置
  useEffect(() => {
    if (!open) return;
    if (editingProvider) {
      setForm({
        vendorKey: editingProvider.vendorKey,
        name: editingProvider.name,
        baseUrl: editingProvider.baseUrl,
        apiKey: '',
      });
    } else {
      const preset = VENDOR_PRESETS[0];
      setForm({ vendorKey: preset.key, name: preset.name, baseUrl: preset.defaultBaseUrl, apiKey: '' });
    }
    setTestResult(null);
  }, [open, editingProvider]);

  const handleVendorChange = (key: string) => {
    const preset = VENDOR_PRESETS.find((v) => v.key === key);
    setForm((f) => ({
      ...f,
      vendorKey: key,
      name: preset?.name ?? f.name,
      baseUrl: preset?.defaultBaseUrl ?? f.baseUrl,
    }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 编辑中且未填新 Key：直接测库中已保存配置；否则用表单内联配置测试
      const result = editingProvider && !form.apiKey
        ? await testConnection({ providerId: editingProvider.id })
        : await testConnection({
            vendorKey: form.vendorKey,
            baseUrl: form.baseUrl,
            apiKey: form.apiKey,
          });
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message || '连接测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('请填写厂商名称'); return; }
    if (!editingProvider && !form.apiKey.trim()) { toast.error('请填写 API Key'); return; }
    setSaving(true);
    try {
      if (editingProvider) {
        await updateProvider(editingProvider.id, {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          // apiKey 留空表示不改动
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        });
        toast.success('厂商已更新');
      } else {
        await createProvider({
          vendorKey: form.vendorKey,
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim() || undefined,
          apiKey: form.apiKey.trim(),
        });
        toast.success('厂商已添加');
      }
      onOpenChange(false);
      await onSaved();
    } catch (err: any) {
      toast.error(err.message || '保存厂商失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingProvider ? '编辑厂商' : '添加厂商'}</DialogTitle>
          <DialogDescription>配置 AI 厂商的接入信息，API Key 仅保存在服务端</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>厂商类型</Label>
            <Select
              value={form.vendorKey}
              onValueChange={handleVendorChange}
              disabled={!!editingProvider}
            >
              <SelectTrigger><SelectValue placeholder="选择厂商" /></SelectTrigger>
              <SelectContent>
                {VENDOR_PRESETS.map((v) => (
                  <SelectItem key={v.key} value={v.key}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例如：小米 MiMo"
            />
          </div>
          <div className="space-y-2">
            <Label>API 地址（baseUrl）</Label>
            <Input
              value={form.baseUrl}
              onChange={(e) => { setForm((f) => ({ ...f, baseUrl: e.target.value })); setTestResult(null); }}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => { setForm((f) => ({ ...f, apiKey: e.target.value })); setTestResult(null); }}
              placeholder={editingProvider ? `${editingProvider.apiKeyMasked}（留空则不修改）` : '输入 API Key'}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button" variant="outline" size="sm"
              onClick={handleTestConnection} disabled={testing}
            >
              {testing ? <LoadingSpinner className="inline-flex py-0 mr-1" /> : null}
              测试连接
            </Button>
            {testResult && (
              testResult.ok ? (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />连接成功
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-destructive" title={testResult.error}>
                  <XCircle className="h-4 w-4" />连接失败{testResult.error ? `：${testResult.error}` : ''}
                </span>
              )
            )}
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
