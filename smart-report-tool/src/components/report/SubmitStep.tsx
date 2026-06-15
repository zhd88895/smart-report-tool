import { FileText, Calendar, User, Bot } from 'lucide-react';
import { LogCategory } from '@/types';
import { LOG_CATEGORY_LABELS } from '@/constants/categories';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SubmitStepProps {
  logCategory: LogCategory;
  uploadedFiles: File[];
  reportInfo: { name: string; date: string; author: string };
  enableAIAnalysis: boolean;
  selectedTemplateId: string | null;
}

export function SubmitStep({
  logCategory,
  uploadedFiles,
  reportInfo,
  enableAIAnalysis,
  selectedTemplateId,
}: SubmitStepProps) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">确认报告信息</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-primary" />
              日志信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">类型：</span>
              {LOG_CATEGORY_LABELS[logCategory]}
            </p>
            <p>
              <span className="text-muted-foreground">文件数：</span>
              {uploadedFiles.length} 个
            </p>
            <p>
              <span className="text-muted-foreground">文件名：</span>
              {uploadedFiles.map((f) => f.name).join(', ')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="h-4 w-4 text-primary" />
              报告信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">名称：</span>
              {reportInfo.name}
            </p>
            <p>
              <span className="text-muted-foreground">日期：</span>
              {reportInfo.date}
            </p>
            <p>
              <span className="text-muted-foreground">作者：</span>
              {reportInfo.author}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4 text-primary" />
              模板
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              <span className="text-muted-foreground">已选模板：</span>
              {selectedTemplateId ? selectedTemplateId.replace('tpl_', '').toUpperCase() : '未选择'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Bot className="h-4 w-4 text-primary" />
              AI分析
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              <span className="text-muted-foreground">状态：</span>
              {enableAIAnalysis ? '已启用' : '未启用'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
