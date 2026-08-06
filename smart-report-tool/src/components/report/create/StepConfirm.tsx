import { LogCategory, OutputFormat, ReportGenerationState } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORY_LABELS, OUTPUT_FORMAT_LABELS } from './constants';

interface StepConfirmProps {
  reportInfo: ReportGenerationState['reportInfo'];
  logCategory: LogCategory;
  /** 已完成上传（status === 'done'）的巡检文件数 */
  doneFilesCount: number;
  scriptName?: string;
  /** 已解析的报告模板名（手动所选或脚本自动关联） */
  templateName?: string;
  outputFormat: OutputFormat;
  onPrev: () => void;
  onGenerate: () => void;
}

/** 步骤5：确认并生成报告 */
export function StepConfirm({
  reportInfo,
  logCategory,
  doneFilesCount,
  scriptName,
  templateName,
  outputFormat,
  onPrev,
  onGenerate,
}: StepConfirmProps) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">步骤5：确认并生成报告</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">报告名称：</span><span>{reportInfo.name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">报告日期：</span><span>{reportInfo.date}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">报告作者：</span><span>{reportInfo.author}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">日志分类：</span>
            <Badge variant="outline">{CATEGORY_LABELS[logCategory]}</Badge>
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">巡检文件：</span><span>{doneFilesCount} 个文件</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">处理脚本：</span><span>{scriptName || '-'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">报告模板：</span><span>{templateName || '-'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">输出格式：</span><span>{OUTPUT_FORMAT_LABELS[outputFormat]}</span></div>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onPrev}>上一步</Button>
          <Button onClick={onGenerate}>开始生成报告</Button>
        </div>
      </CardContent>
    </Card>
  );
}
