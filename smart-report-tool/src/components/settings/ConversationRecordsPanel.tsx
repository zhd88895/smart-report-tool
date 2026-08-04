import { useMemo, useState } from 'react';
import { Trash2, MessageSquare, Coins, ArrowDownToLine, ArrowUpFromLine, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConversations } from '@/hooks/useConversations';
import { Conversation } from '@/types';
import { formatDate } from '@/utils/formatters';
import { toast } from 'sonner';

/** 千分位格式化大数字 */
function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

/**
 * 对话记录面板（个人设置页内嵌）。
 * 展示当前账号的 AI 助手对话列表，并附对话级 token 用量统计
 * （后端按 conversation_id 聚合 user_ai_usage_logs）。
 */
export function ConversationRecordsPanel() {
  const { conversations, removeConversation, refreshConversations } = useConversations();
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  const handleDelete = async () => {
    if (deleteTarget) {
      await removeConversation(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('对话记录已删除');
      refreshConversations();
    }
  };

  /** 汇总统计：仅合计有用量记录的对话 */
  const totals = useMemo(() => {
    let prompt = 0, completion = 0, calls = 0;
    for (const c of conversations) {
      if (c.tokenUsage) {
        prompt += c.tokenUsage.promptTokens;
        completion += c.tokenUsage.completionTokens;
        calls += c.tokenUsage.calls;
      }
    }
    return { prompt, completion, total: prompt + completion, calls };
  }, [conversations]);

  const stats = [
    { title: '总 Token', value: fmtNum(totals.total), icon: Coins },
    { title: '输入 Token', value: fmtNum(totals.prompt), icon: ArrowUpFromLine },
    { title: '输出 Token', value: fmtNum(totals.completion), icon: ArrowDownToLine },
    { title: '对话调用次数', value: fmtNum(totals.calls), icon: Hash },
  ];

  const columns = [
    {
      key: 'preview',
      header: '对话内容',
      render: (item: Conversation) => {
        const first = item.messages.find((m) => m.role === 'user')?.content || '（空对话）';
        return (
          <span className="block max-w-[280px] truncate" title={first}>
            {first.length > 30 ? `${first.slice(0, 30)}…` : first}
          </span>
        );
      },
    },
    {
      key: 'messageCount',
      header: '消息数',
      render: (item: Conversation) => item.messages.length,
    },
    {
      key: 'tokenUsage',
      header: 'Token 用量（入/出）',
      render: (item: Conversation) =>
        item.tokenUsage ? (
          <span className="text-sm tabular-nums" title={`共 ${fmtNum(item.tokenUsage.totalTokens)} tokens / ${item.tokenUsage.calls} 次调用`}>
            {fmtNum(item.tokenUsage.promptTokens)} / {fmtNum(item.tokenUsage.completionTokens)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    { key: 'createdAt', header: '创建时间', render: (item: Conversation) => formatDate(item.createdAt) },
    { key: 'updatedAt', header: '更新时间', render: (item: Conversation) => formatDate(item.updatedAt) },
    {
      key: 'actions',
      header: '操作',
      render: (item: Conversation) => (
        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* token 用量统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-xl font-bold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            我的对话记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={conversations} keyExtractor={(item) => item.id} />
          <p className="mt-3 text-xs text-muted-foreground">
            仅展示当前账号的对话；Token 用量自功能上线起统计，历史对话显示为「—」。
          </p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="确认删除"
        description="确定要删除这条对话记录吗？"
        onConfirm={handleDelete}
        destructive
      />
    </div>
  );
}
