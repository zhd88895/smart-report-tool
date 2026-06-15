import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { ReportStatus } from '@/types';

interface ProgressPanelProps {
  progress: number;
  status: ReportStatus | 'idle';
  errorMessage?: string;
}

export function ProgressPanel({ progress, status, errorMessage }: ProgressPanelProps) {
  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-12">
      {status === 'generating' && (
        <>
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <h3 className="text-lg font-semibold">正在生成报告...</h3>
          <div className="w-full max-w-md">
            <Progress value={progress} />
            <p className="mt-2 text-center text-sm text-muted-foreground">{progress}%</p>
          </div>
        </>
      )}
      {status === 'success' && (
        <>
          <CheckCircle className="h-12 w-12 text-green-500" />
          <h3 className="text-lg font-semibold text-green-600">报告生成成功</h3>
          <p className="text-sm text-muted-foreground">您可以前往报告管理页面查看和下载</p>
        </>
      )}
      {status === 'failed' && (
        <>
          <XCircle className="h-12 w-12 text-destructive" />
          <h3 className="text-lg font-semibold text-destructive">报告生成失败</h3>
          <p className="text-sm text-muted-foreground">{errorMessage || '请检查日志文件并重试'}</p>
        </>
      )}
    </div>
  );
}
