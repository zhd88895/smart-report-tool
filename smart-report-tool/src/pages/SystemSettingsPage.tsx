import { useState, useEffect } from 'react';
import { Save, RotateCcw, Settings as SettingsIcon, History, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAuthStore } from '@/stores/authStore';
import {
  SettingsData, SettingHistoryEntry,
  fetchAllSettings, updateSettings, fetchHistory, CATEGORY_LABELS,
} from '@/services/settingsService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function SystemSettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<SettingsData | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SettingHistoryEntry[]>([]);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const d = await fetchAllSettings();
      setData(d);
      const values: Record<string, string> = {};
      for (const s of d.settings) values[s.key] = s.value;
      setFormValues(values);
    } catch (err: any) { toast.error(err.message || '加载设置失败'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!isAdmin || !data) return;
    const updates = data.settings.filter(s => formValues[s.key] !== s.value).map(s => ({ key: s.key, value: formValues[s.key] }));
    if (updates.length === 0) { toast.info('没有需要保存的更改'); return; }
    setSaving(true);
    try {
      await updateSettings(updates);
      toast.success(`已保存 ${updates.length} 项更改`);
      loadSettings();
    } catch (err: any) { toast.error(err.message || '保存设置失败'); }
    finally { setSaving(false); }
  };

  const handleReset = () => {
    if (!data) return;
    const values: Record<string, string> = {};
    for (const s of data.settings) values[s.key] = s.value;
    setFormValues(values);
    toast.info('已重置');
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try { setHistory(await fetchHistory(30)); } catch { toast.error('获取操作日志失败'); }
  };

  const categories = data?.categories || [...new Set(data?.settings.map(s => s.category) || [])];
  const hasChanges = data?.settings.some(s => formValues[s.key] !== s.value) ?? false;
  const changeCount = data?.settings.filter(s => formValues[s.key] !== s.value).length ?? 0;

  if (user?.role === 'member') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12 space-y-4">
            <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">无访问权限</h3>
            <p className="text-sm text-muted-foreground">系统设置仅对管理员和高级成员开放</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner text="加载中..." className="py-16" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6" />系统设置
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-xs', isAdmin ? '' : 'opacity-50')}>
            {isAdmin ? '管理员（可编辑）' : '高级成员（只读）'}
          </Badge>
          <Button variant="outline" size="sm" onClick={openHistory}>
            <History className="h-4 w-4 mr-1" />操作日志
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!hasChanges}>
            <RotateCcw className="h-4 w-4 mr-1" />重置
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={handleSave} disabled={!hasChanges || saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? '保存中...' : `保存${changeCount > 0 ? ` (${changeCount})` : ''}`}
            </Button>
          )}
        </div>
      </div>

      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="暂无可配置项"
              description="系统设置功能正在建设中，后续版本会逐步开放可配置项"
            />
          </CardContent>
        </Card>
      ) : (
      <Tabs defaultValue={categories[0]}>
        <TabsList className="flex-wrap">
          {categories.map((cat) => (
            <TabsTrigger key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</TabsTrigger>
          ))}
        </TabsList>

        {categories.map((cat) => (
          <TabsContent key={cat} value={cat} className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{CATEGORY_LABELS[cat] || cat}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(data?.settings || []).filter(s => s.category === cat).map((setting) => {
                  const val = formValues[setting.key] || '';
                  const isChanged = val !== setting.value;
                  const showAsSecret = setting.isSecret && !showSecrets[setting.key];

                  return (
                    <div key={setting.key} className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-sm font-medium">{setting.label}</Label>
                        {setting.description && <span className="text-xs text-muted-foreground">— {setting.description}</span>}
                        {isChanged && <Badge variant="secondary" className="text-[10px]">已修改</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {setting.valueType === 'select' ? (
                          <Select value={val} onValueChange={(v) => setFormValues(prev => ({ ...prev, [setting.key]: v }))} disabled={!isAdmin}>
                            <SelectTrigger className={cn('flex-1', isChanged && 'border-yellow-500')}><SelectValue /></SelectTrigger>
                            <SelectContent>{setting.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : setting.valueType === 'boolean' ? (
                          <Switch checked={val === 'true'} onCheckedChange={(v) => setFormValues(prev => ({ ...prev, [setting.key]: String(v) }))} disabled={!isAdmin} />
                        ) : (
                          <div className="flex-1 relative">
                            <Input
                              type={showAsSecret ? 'password' : (setting.valueType === 'number' ? 'number' : 'text')}
                              value={val}
                              onChange={(e) => setFormValues(prev => ({ ...prev, [setting.key]: e.target.value }))}
                              readOnly={!isAdmin}
                              className={cn(isChanged && 'border-yellow-500', !isAdmin && 'bg-muted cursor-not-allowed', showAsSecret && 'pr-10')}
                            />
                            {setting.isSecret && (
                              <button type="button" onClick={() => setShowSecrets(prev => ({ ...prev, [setting.key]: !prev[setting.key] }))}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                                {showAsSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col">
          <DialogHeader><DialogTitle>操作日志 — 系统设置修改记录</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {history.length === 0 ? (
              <EmptyState title="暂无操作记录" description="" />
            ) : (
              <div className="space-y-1">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 text-xs">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono font-medium">{h.settingKey}</span>
                      <span className="text-muted-foreground ml-2">
                        {h.oldValue ? `"${h.oldValue.slice(0, 30)}" → ` : '→ '}
                        <span className="text-primary font-medium">"{h.newValue.slice(0, 30)}"</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <span className="text-muted-foreground">{h.changedByName || h.changedBy}</span>
                      <span className="text-muted-foreground/70">{new Date(h.changedAt).toLocaleString('zh-CN')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
