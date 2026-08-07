import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Gauge, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import {
  createModel, updateModel, setDefaultModel, testConnection,
  startProbeLimits, fetchProbeJob,
  type AIModel, type ConnectionTestResult, type LimitProbeJob,
} from '@/services/aiConfigService';

interface ModelForm {
  modelId: string;
  displayName: string;
  temperature: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  supportsTools: boolean;
  supportsVision: boolean;
  thinkingMode: boolean;
  reasoningEffort: string;
  isDefault: boolean;
}

const EMPTY_MODEL_FORM: ModelForm = {
  modelId: '', displayName: '', temperature: '0.7',
  maxInputTokens: '128000', maxOutputTokens: '4096',
  supportsTools: true, supportsVision: false, thinkingMode: false, reasoningEffort: '',
  isDefault: false,
};

/** 输入/输出上限快捷档位 */
const INPUT_TOKEN_CHIPS = [32000, 64000, 128000, 256000, 1048576] as const;
const OUTPUT_TOKEN_CHIPS = [4096, 8192, 16384, 32768, 131072] as const;

/** 档位显示文案：>=1M 显示 1M，否则 K */
function formatChip(v: number): string {
  return v >= 1048576 ? '1M' : `${Math.round(v / 1024)}K`;
}

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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  // 上限探测：confirmArmed 表示已展示消耗警告、等待二次点击确认
  const [probeJob, setProbeJob] = useState<LimitProbeJob | null>(null);
  const [probeConfirmArmed, setProbeConfirmArmed] = useState(false);
  const probeLogRef = useRef<HTMLDivElement | null>(null);

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
        supportsTools: editingModel.supportsTools,
        supportsVision: editingModel.supportsVision,
        thinkingMode: editingModel.thinkingMode,
        reasoningEffort: editingModel.reasoningEffort,
        isDefault: editingModel.isDefault,
      });
    } else {
      setForm(EMPTY_MODEL_FORM);
    }
    setTestResult(null);
    setProbeJob(null);
    setProbeConfirmArmed(false);
  }, [open, editingModel]);

  // 探测任务运行中时每 2s 轮询一次进度
  useEffect(() => {
    if (!probeJob || probeJob.status !== 'running') return;
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchProbeJob(probeJob.id);
        setProbeJob(fresh);
      } catch {
        // 轮询失败（如服务重启丢失任务）时停止轮询
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [probeJob?.id, probeJob?.status]);

  // 探测日志自动滚到底部
  useEffect(() => {
    probeLogRef.current?.scrollTo({ top: probeLogRef.current.scrollHeight });
  }, [probeJob?.steps.length]);

  /** 启动上限探测（首次点击仅展示消耗警告，二次点击确认执行） */
  const handleProbe = async () => {
    if (!editingModel) return;
    if (!probeConfirmArmed) { setProbeConfirmArmed(true); return; }
    setProbeConfirmArmed(false);
    try {
      const job = await startProbeLimits(editingModel.id);
      setProbeJob(job);
    } catch (err: any) {
      toast.error(err.message || '启动探测失败');
    }
  };

  /** 把探测结果填入表单（仅填入探测到的字段） */
  const applyProbeResult = () => {
    if (!probeJob?.result) return;
    const r = probeJob.result;
    setForm((f) => ({
      ...f,
      ...(r.maxInputTokens != null ? { maxInputTokens: String(r.maxInputTokens) } : {}),
      ...(r.maxOutputTokens != null ? { maxOutputTokens: String(r.maxOutputTokens) } : {}),
    }));
    toast.success('已填入探测结果，点击保存生效');
  };

  /** 用当前厂商的已保存配置，对表单中的模型 ID 做真实对话测试 */
  const handleTestModel = async () => {
    if (!providerId) return;
    if (!form.modelId.trim()) { toast.error('请先填写模型 ID'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection({ providerId, modelId: form.modelId.trim() });
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message || '模型测试失败' });
    } finally {
      setTesting(false);
    }
  };

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
          supportsTools: form.supportsTools,
          supportsVision: form.supportsVision,
          thinkingMode: form.thinkingMode,
          reasoningEffort: form.thinkingMode ? form.reasoningEffort : '',
        });
        if (form.isDefault && !editingModel.isDefault) {
          await setDefaultModel(editingModel.id);
        }
        toast.success('模型已更新');
      } else {
        // 创建接口只收 modelId/displayName；已收录官方规格的模型由后端自动填充真实上限，
        // 因此这里只把用户手动改过的字段补丁式更新，没用默认值覆盖后端的自动填充
        const created = await createModel(providerId, {
          modelId: form.modelId.trim(),
          displayName: form.displayName.trim() || form.modelId.trim(),
        });
        const patch: Parameters<typeof updateModel>[1] = {};
        if (form.temperature !== EMPTY_MODEL_FORM.temperature) patch.temperature = temperature;
        if (form.maxInputTokens !== EMPTY_MODEL_FORM.maxInputTokens) patch.maxInputTokens = maxInputTokens;
        if (form.maxOutputTokens !== EMPTY_MODEL_FORM.maxOutputTokens) patch.maxOutputTokens = maxOutputTokens;
        if (form.supportsTools !== EMPTY_MODEL_FORM.supportsTools) patch.supportsTools = form.supportsTools;
        if (form.supportsVision !== EMPTY_MODEL_FORM.supportsVision) patch.supportsVision = form.supportsVision;
        if (form.thinkingMode !== EMPTY_MODEL_FORM.thinkingMode) patch.thinkingMode = form.thinkingMode;
        if (form.thinkingMode && form.reasoningEffort !== EMPTY_MODEL_FORM.reasoningEffort) patch.reasoningEffort = form.reasoningEffort;
        if (Object.keys(patch).length > 0) await updateModel(created.id, patch);
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
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingModel ? '编辑模型' : '添加模型'}</DialogTitle>
          <DialogDescription>模型 ID 需与厂商接口返回的标识一致</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>模型 ID</Label>
            <Input
              value={form.modelId}
              onChange={(e) => { setForm((f) => ({ ...f, modelId: e.target.value })); setTestResult(null); }}
              placeholder="例如：mimo-v2.5-pro"
              disabled={!!editingModel}
            />
          </div>
          {/* 保存前可用厂商已保存的配置实测该模型 ID 是否可用 */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button" variant="outline" size="sm"
              onClick={handleTestModel} disabled={testing || !providerId}
            >
              {testing ? <LoadingSpinner className="inline-flex py-0 mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
              测试模型
            </Button>
            {testResult && (
              testResult.ok ? (
                <span className="flex items-center gap-1 text-sm text-green-600" title={testResult.reply}>
                  <CheckCircle2 className="h-4 w-4" />
                  模型可用{testResult.latencyMs != null ? `（${(testResult.latencyMs / 1000).toFixed(1)}s）` : ''}
                  {testResult.reply ? `：${testResult.reply.slice(0, 40)}` : ''}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-destructive" title={testResult.error}>
                  <XCircle className="h-4 w-4" />测试失败{testResult.error ? `：${testResult.error}` : ''}
                </span>
              )
            )}
            {/* 上限探测：仅编辑已保存模型时可用；首次点击展示消耗警告，二次点击确认 */}
            {editingModel && (
              <Button
                type="button" variant="outline" size="sm"
                onClick={handleProbe}
                disabled={probeJob?.status === 'running'}
                title="通过实际调用逐步试出模型的真实输入/输出上限"
              >
                {probeJob?.status === 'running'
                  ? <LoadingSpinner className="inline-flex py-0 mr-1" />
                  : <Gauge className="h-3.5 w-3.5 mr-1" />}
                {probeJob?.status === 'running' ? '探测中…' : '探测上限'}
              </Button>
            )}
          </div>
          {/* 探测消耗警告（二次确认） */}
          {probeConfirmArmed && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              探测会真实调用厂商 API 并逐步加大输入，预计消耗数十万至数百万 token 额度，耗时可能达数分钟。
              再次点击「探测上限」确认开始。
            </div>
          )}
          {/* 探测进度日志 + 结果 */}
          {probeJob && (
            <div className="space-y-2 rounded-md border p-3">
              <div
                ref={probeLogRef}
                className="max-h-32 overflow-y-auto font-mono text-xs text-muted-foreground space-y-0.5"
              >
                {probeJob.steps.map((s, i) => <div key={i}>{s.message}</div>)}
                {probeJob.status === 'running' && <div className="animate-pulse">…</div>}
              </div>
              {probeJob.status === 'done' && probeJob.result && (
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <span className="text-xs">
                    实测：输入 {probeJob.result.maxInputTokens?.toLocaleString() ?? '未测出'}
                    {' / '}
                    输出 {probeJob.result.maxOutputTokens?.toLocaleString() ?? '厂商未校验'}
                  </span>
                  {(probeJob.result.maxInputTokens != null || probeJob.result.maxOutputTokens != null) && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={applyProbeResult}>
                      填入结果
                    </Button>
                  )}
                </div>
              )}
              {probeJob.status === 'done' && probeJob.result?.notes.length ? (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {probeJob.result.notes.map((n, i) => <div key={i}>· {n}</div>)}
                </div>
              ) : null}
              {probeJob.status === 'error' && (
                <div className="border-t pt-2 text-xs text-destructive">探测中止：{probeJob.error}</div>
              )}
            </div>
          )}
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
              <div className="flex flex-wrap gap-1">
                {INPUT_TOKEN_CHIPS.map((v) => (
                  <button
                    key={v} type="button"
                    className={`rounded border px-1.5 py-0.5 text-[11px] leading-4 transition-colors ${
                      form.maxInputTokens === String(v)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                    onClick={() => setForm((f) => ({ ...f, maxInputTokens: String(v) }))}
                  >
                    {formatChip(v)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>输出上限</Label>
              <Input
                type="number" min="1"
                value={form.maxOutputTokens}
                onChange={(e) => setForm((f) => ({ ...f, maxOutputTokens: e.target.value }))}
              />
              <div className="flex flex-wrap gap-1">
                {OUTPUT_TOKEN_CHIPS.map((v) => (
                  <button
                    key={v} type="button"
                    className={`rounded border px-1.5 py-0.5 text-[11px] leading-4 transition-colors ${
                      form.maxOutputTokens === String(v)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                    onClick={() => setForm((f) => ({ ...f, maxOutputTokens: String(v) }))}
                  >
                    {formatChip(v)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* 已收录官方规格的模型：展示官方上限并支持一键填入 */}
          {editingModel?.knownLimits && (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span>
                官方上限：输入 {editingModel.knownLimits.maxInputTokens?.toLocaleString() ?? '未收录'}
                {editingModel.knownLimits.maxOutputTokens != null && ` / 输出 ${editingModel.knownLimits.maxOutputTokens.toLocaleString()}`}
              </span>
              <Button
                type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                onClick={() => setForm((f) => ({
                  ...f,
                  ...(editingModel.knownLimits?.maxInputTokens != null
                    ? { maxInputTokens: String(editingModel.knownLimits.maxInputTokens) } : {}),
                  ...(editingModel.knownLimits?.maxOutputTokens != null
                    ? { maxOutputTokens: String(editingModel.knownLimits.maxOutputTokens) } : {}),
                }))}
              >
                填入官方上限
              </Button>
            </div>
          )}
          {/* 高级配置：模型能力声明（参考 workbuddy 设置项，保持本项目风格） */}
          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-sm font-medium">高级配置</Label>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.supportsTools}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, supportsTools: v === true }))}
                />
                工具调用
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.supportsVision}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, supportsVision: v === true }))}
                />
                图片输入
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.thinkingMode}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, thinkingMode: v === true }))}
                />
                思考模式
              </label>
            </div>
            {!form.supportsTools && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                关闭「工具调用」后，支持包分析、脚本读写等需要工具的功能将无法使用此模型
              </p>
            )}
            {form.thinkingMode && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">默认思考强度</Label>
                <Select
                  value={form.reasoningEffort || 'auto'}
                  onValueChange={(v) => setForm((f) => ({ ...f, reasoningEffort: v === 'auto' ? '' : v }))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动（使用厂商默认值）</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
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
