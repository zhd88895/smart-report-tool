import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Plus, Trash2, MessageSquare, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAIAssistant } from '@/hooks/useAIAssistant';
import { useAuthStore } from '@/stores/authStore';
import { useConversationStore } from '@/stores/conversationStore';
import { Conversation } from '@/types';
import { formatDate } from '@/utils/formatters';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function AssistantPage() {
  const { user } = useAuthStore();
  const {
    conversations, currentConversation,
    setCurrentConversation, createNewConversation, appendMessage,
    removeConversation, fetchConversations,
  } = useConversationStore();
  const { isLoading, send } = useAIAssistant();
  const [input, setInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === 'admin';

  // 加载对话记录：管理员看全部，其他人只看自己的
  // 加载后默认选中最新的对话，而非自动创建新对话
  useEffect(() => {
    if (user) {
      fetchConversations(isAdmin ? undefined : user.id);
    }
  }, [user, isAdmin, fetchConversations]);

  // 当对话列表加载完成后，自动选中最近一次对话
  useEffect(() => {
    if (!currentConversation && conversations.length > 0) {
      setCurrentConversation(conversations[0]);
    }
  }, [conversations, currentConversation, setCurrentConversation]);

  // 自动滚动消息到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentConversation?.messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !currentConversation) return;
    const message = input.trim();
    setInput('');

    const userMsg = { role: 'user' as const, content: message, timestamp: new Date().toISOString() };
    await appendMessage(currentConversation.id, userMsg);

    const aiContent = await send(message);
    const aiMsg = { role: 'assistant' as const, content: aiContent, timestamp: new Date().toISOString() };
    await appendMessage(currentConversation.id, aiMsg);

    // 刷新对话列表以更新最后消息
    fetchConversations(isAdmin ? undefined : user?.id);
  };

  const handleNewChat = () => {
    if (user) createNewConversation(user.id, user.displayName);
  };

  const handleSelectConversation = (conv: Conversation) => {
    setCurrentConversation(conv);
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await removeConversation(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('对话已删除');
      fetchConversations(isAdmin ? undefined : user?.id);
    }
  };

  // 对话列表预览文字
  const lastMessagePreview = (conv: Conversation) => {
    const last = conv.messages?.[conv.messages.length - 1];
    if (!last) return '新对话';
    const text = last.content.slice(0, 50);
    return (last.role === 'user' ? '你: ' : 'AI: ') + text + (last.content.length > 50 ? '...' : '');
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* 左侧：对话记录列表 */}
      <div className="w-64 shrink-0 border rounded-lg bg-card flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4" />
            {isAdmin ? '全部对话' : '我的对话'}
          </h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="新对话" onClick={handleNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-2">暂无对话记录</p>
          ) : (
            <div className="py-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    'group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent transition-colors',
                    currentConversation?.id === conv.id && 'bg-accent'
                  )}
                  onClick={() => handleSelectConversation(conv)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {isAdmin && <span className="text-xs text-primary truncate max-w-[80px]">{conv.userName}</span>}
                      {isAdmin && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{lastMessagePreview(conv)}</p>
                    {!isAdmin && conv.messages.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{conv.messages.length} 条消息</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv); }}
                    title="删除对话"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* 右侧：聊天区 */}
      <Card className="flex flex-col flex-1">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              智能助手
              {currentConversation && (
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  {formatDate(currentConversation.createdAt)}
                </span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-0">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {!currentConversation || currentConversation.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2 py-12">
                <Bot className="h-12 w-12" />
                <p>{currentConversation ? '发送消息开始对话' : '点击左侧对话或创建新对话'}</p>
                <p className="text-xs">我可以帮您查询报告、分析数据或回答一般问题</p>
              </div>
            ) : (
              <div className="space-y-4">
                {currentConversation.messages.map((msg, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex gap-3',
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    {msg.role === 'assistant' && (
                      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                    <div
                      className={cn(
                        'rounded-lg px-4 py-2 max-w-[80%] text-sm',
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}
                    >
                      <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                    </div>
                    {msg.role === 'user' && (
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div className="rounded-lg px-4 py-2 bg-muted">
                      <div className="flex gap-1">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <Separator />
          <div className="p-4 flex gap-2">
            <Input
              placeholder={currentConversation ? '输入消息...' : '请先选择或创建对话'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={isLoading || !currentConversation}
            />
            <Button onClick={handleSend} disabled={isLoading || !input.trim() || !currentConversation}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
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
