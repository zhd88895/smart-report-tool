import { Badge } from '@/components/ui/badge';

interface StatusBadgeProps {
  status: 'generating' | 'success' | 'failed' | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    generating: 'secondary',
    success: 'default',
    failed: 'destructive',
  };

  const labels: Record<string, string> = {
    generating: '生成中',
    success: '已完成',
    failed: '失败',
  };

  return <Badge variant={variants[status] || 'outline'}>{labels[status] || status}</Badge>;
}
