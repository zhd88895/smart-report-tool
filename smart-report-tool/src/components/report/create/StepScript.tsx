import { Script } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/common/EmptyState';
import { formatFileSize } from '@/utils/formatters';
import { ChevronRight, Check, AlertCircle } from 'lucide-react';
import { isDepsReady } from './scriptDeps';

interface StepScriptProps {
  /** 已按区域过滤并去重的脚本列表 */
  scripts: Script[];
  selectedScriptId: string | null;
  manualTemplate: boolean;
  onManualTemplateChange: (value: boolean) => void;
  onSelectScript: (scriptId: string) => void;
  canGoNext: boolean;
  onNext: () => void;
}

/** 步骤1：选择脚本 */
export function StepScript({
  scripts,
  selectedScriptId,
  manualTemplate,
  onManualTemplateChange,
  onSelectScript,
  canGoNext,
  onNext,
}: StepScriptProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">步骤1：选择脚本</CardTitle>
        <p className="text-sm text-muted-foreground">请选择用于处理巡检数据的脚本</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch checked={manualTemplate} onCheckedChange={onManualTemplateChange} />
          <Label className="cursor-pointer text-sm">手动选择模板</Label>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {scripts.length === 0 && (
            <EmptyState title="暂无脚本" description="请先在「脚本与模板」页面添加脚本" />
          )}
          {scripts.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelectScript(s.id)}
              className={`cursor-pointer rounded-lg border p-4 transition-colors ${selectedScriptId === s.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{s.name}</p>
                    {s.scriptType === 'python' && s.requirements && s.requirements.length > 0 && (
                      isDepsReady(s)
                        ? <Badge className="text-xs bg-green-100 text-green-700 border-green-300 hover:bg-green-100 pointer-events-none"><Check className="h-3 w-3 mr-0.5" />已就绪</Badge>
                        : <Badge className="text-xs bg-red-50 text-red-600 border-red-200 hover:bg-red-50 pointer-events-none"><AlertCircle className="h-3 w-3 mr-0.5" />未就绪</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{s.description || s.fileName} · {formatFileSize(s.fileSize)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Python</Badge>
                  <Badge variant="outline">v{s.version}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button disabled={!canGoNext} onClick={onNext}>
            下一步 <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
