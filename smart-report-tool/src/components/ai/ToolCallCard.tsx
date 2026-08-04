import { Loader2, Wrench, CheckCircle2, XCircle, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 工具卡片四态：调用中 / 待确认 / 已完成 / 失败或已取消 */
export type ToolCallCardState = 'running' | 'pending' | 'done' | 'error';

export interface ToolCallCardProps {
  state: ToolCallCardState;
  /** 工具名（如 write_script / run_script / list_scripts） */
  tool: string;
  /** 结果摘要或待确认参数摘要 */
  summary: string;
  /** 待确认态：确认执行回调 */
  onConfirm?: () => void;
  /** 待确认态：取消回调 */
  onCancel?: () => void;
  /** 确认/取消请求进行中（禁用按钮） */
  busy?: boolean;
}

const STATE_STYLE: Record<ToolCallCardState, { icon: typeof Wrench; label: string; iconClass: string }> = {
  running: { icon: Loader2, label: '工具调用中', iconClass: 'text-primary animate-spin' },
  pending: { icon: ShieldQuestion, label: '待确认', iconClass: 'text-amber-500' },
  done: { icon: CheckCircle2, label: '已完成', iconClass: 'text-emerald-600' },
  error: { icon: XCircle, label: '未执行', iconClass: 'text-destructive' },
};

/**
 * AI 工具调用卡片：助手消息流内展示一次工具调用的状态。
 * pending 态提供「确认执行 / 取消」按钮（安全底线：写/执行类工具必须用户确认）。
 */
export function ToolCallCard({ state, tool, summary, onConfirm, onCancel, busy }: ToolCallCardProps) {
  const { icon: Icon, label, iconClass } = STATE_STYLE[state];
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs space-y-2 max-w-[80%]">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', iconClass)} />
        <span className="font-medium">{label}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tool}</code>
      </div>
      <p className="text-muted-foreground whitespace-pre-wrap break-words">{summary}</p>
      {state === 'pending' && (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" className="h-7 px-3 text-xs" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : '确认执行'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={onCancel} disabled={busy}>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}
