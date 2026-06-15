import { useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { getTodayString } from '@/utils/formatters';

interface ReportInfoStepProps {
  name: string;
  date: string;
  author: string;
  authorId: string;
  enableAIAnalysis: boolean;
  onChange: (info: { name: string; date: string; author: string; authorId: string }) => void;
  onToggleAI: (enabled: boolean) => void;
}

export function ReportInfoStep({
  name,
  date,
  author,
  authorId,
  enableAIAnalysis,
  onChange,
  onToggleAI,
}: ReportInfoStepProps) {
  const { user } = useAuth();

  useEffect(() => {
    if (user && !author) {
      onChange({
        name: name || '',
        date: date || getTodayString(),
        author: user.displayName,
        authorId: user.id,
      });
    }
    if (!date) {
      onChange({ name, date: getTodayString(), author, authorId });
    }
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="report-name">
          报告名称 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="report-name"
          value={name}
          onChange={(e) => onChange({ name: e.target.value, date, author, authorId })}
          placeholder="请输入报告名称"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="report-date">报告日期</Label>
        <Input
          id="report-date"
          type="date"
          value={date}
          onChange={(e) => onChange({ name, date: e.target.value, author, authorId })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="report-author">报告作者</Label>
        <Input id="report-author" value={author} disabled />
      </div>
      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <Switch checked={enableAIAnalysis} onCheckedChange={onToggleAI} />
        <div>
          <Label className="cursor-pointer">启用AI智能分析</Label>
          <p className="text-xs text-muted-foreground">生成报告后将自动附加AI分析内容</p>
        </div>
      </div>
    </div>
  );
}
