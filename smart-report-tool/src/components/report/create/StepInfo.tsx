import { LogCategory, OutputFormat, ReportGenerationState } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronRight, History } from 'lucide-react';
import { CATEGORY_LABELS, OUTPUT_FORMAT_LABELS, LAST_NAME_KEY } from './constants';

interface StepInfoProps {
  reportInfo: ReportGenerationState['reportInfo'];
  outputFormat: OutputFormat;
  logCategory: LogCategory;
  onUpdate: (patch: Partial<Pick<ReportGenerationState, 'reportInfo' | 'outputFormat' | 'logCategory'>>) => void;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/** 步骤4：填写报告信息 */
export function StepInfo({
  reportInfo,
  outputFormat,
  logCategory,
  onUpdate,
  canGoNext,
  onPrev,
  onNext,
}: StepInfoProps) {
  return (
    <Card>
      <CardHeader><CardTitle>步骤4：填写报告信息</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>报告名称</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => {
                  const last = localStorage.getItem(LAST_NAME_KEY);
                  if (last) {
                    onUpdate({ reportInfo: { ...reportInfo, name: last } });
                  }
                }}
              >
                <History className="mr-1 h-3 w-3" />使用上次填写
              </Button>
            </div>
            <Input value={reportInfo.name} onChange={(e) => onUpdate({ reportInfo: { ...reportInfo, name: e.target.value } })} placeholder="如：2026年6月主机巡检报告" />
          </div>
          <div className="space-y-2">
            <Label>报告日期</Label>
            <Input type="date" value={reportInfo.date} onChange={(e) => onUpdate({ reportInfo: { ...reportInfo, date: e.target.value } })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>报告作者</Label>
            <Input value={reportInfo.author} onChange={(e) => onUpdate({ reportInfo: { ...reportInfo, author: e.target.value } })} placeholder="请输入作者" />
          </div>
          <div className="space-y-2">
            <Label>输出格式</Label>
            <Select value={outputFormat} onValueChange={(v) => onUpdate({ outputFormat: v as OutputFormat })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(OUTPUT_FORMAT_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>日志分类</Label>
          <Select value={logCategory} onValueChange={(v) => onUpdate({ logCategory: v as LogCategory })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
          </Select>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onPrev}>上一步</Button>
          <Button disabled={!canGoNext} onClick={onNext}>
            下一步 <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
