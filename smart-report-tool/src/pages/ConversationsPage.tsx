import { useState } from 'react';
import { Trash2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConversations } from '@/hooks/useConversations';
import { Conversation } from '@/types';
import { formatDate } from '@/utils/formatters';
import { toast } from 'sonner';

export default function ConversationsPage() {
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

  const columns = [
    { key: 'userName', header: '用户' },
    {
      key: 'messageCount',
      header: '消息数',
      render: (item: Conversation) => item.messages.length,
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
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">对话记录</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            全量对话审计
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={conversations} keyExtractor={(item) => item.id} />
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
