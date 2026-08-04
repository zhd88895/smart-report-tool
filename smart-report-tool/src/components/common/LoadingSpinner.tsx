import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  text?: string;
  className?: string;
}

/** 统一加载态：Loader2 旋转图标 + 可选文字；按钮内联使用时传 className="inline-flex py-0" */
export function LoadingSpinner({ text, className }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      {text && <span>{text}</span>}
    </div>
  );
}
