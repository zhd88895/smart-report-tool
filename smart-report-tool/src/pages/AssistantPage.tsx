import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Send, Bot, User, Plus, Trash2, MessageSquare, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer';
import { ModelSelector } from '@/components/ai/ModelSelector';
import { AIFallbackNotice } from '@/components/ai/AIFallbackNotice';
import { useAIAssistant } from '@/hooks/useAIAssistant';
import { ToolCallCard, type ToolCallCardState } from '@/components/ai/ToolCallCard';
import { confirmToolCall, cancelToolCall } from '@/services/aiService';
import { useAuthStore } from '@/stores/authStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import { ROUTES } from '@/constants/routes';
import { Conversation } from '@/types';
import { formatDate } from '@/utils/formatters';
import { cn } from '@/lib/utils';

export default function AssistantPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    conversations, currentConversation,
    setCurrentConversation, createNewConversation, appendMessage,
    removeConversation, fetchConversations, resetConversations,
  } = useConversationStore();
  const { isLoading, sendStream } = useAIAssistant();
  const { resolved, loadResolved, refreshResolved, currentModel, fallbackNotice } = useAIConfigStore();

  const [input, setInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [streamingText, setStreamingText] = useState('');
  // 待确认卡片的本地终态（done/error=已处理；cancelled 归并到 error 展示）与请求进行中标记
  const [pendingStates, setPendingStates] = useState<Record<string, 'done' | 'error'>>({});
  const [pendingBusy, setPendingBusy] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 支持 ?id=<conversationId> 直达指定对话（如仪表盘「最近对话」跳转）
  const [searchParams, setSearchParams] = useSearchParams();
  const targetConversationId = searchParams.get('id');

  // 加载服务端解析后的 AI 配置（已有缓存时轻量刷新，同步设置页的变更）
  useEffect(() => {
    if (!resolved) loadResolved();
    else refreshResolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) {
      fetchConversations(user.id);
    } else {
      resetConversations();
    }
  }, [user, fetchConversations, resetConversations]);

  // 对话选中：优先 ?id= 指定的对话（应用后即清除参数，避免覆盖后续手动切换）
  useEffect(() => {
    if (conversations.length === 0) return;
    if (targetConversationId) {
      const target = conversations.find((c) => c.id === targetConversationId);
      if (target && currentConversation?.id !== target.id) {
        setCurrentConversation(target);
      }
      setSearchParams({}, { replace: true });
      return;
    }
    if (!currentConversation) setCurrentConversation(conversations[0]);
  }, [conversations, currentConversation, targetConversationId, setCurrentConversation, setSearchParams]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [currentConversation?.messages, streamingText]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !currentConversation) return;
    const message = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const userMsg = { role: 'user' as const, content: message, timestamp: new Date().toISOString() };
    await appendMessage(currentConversation.id, userMsg);
    const history = currentConversation.messages || [];
    setStreamingText('');
    // enableTools（hook 内默认开启）：响应可能携带工具轨迹 toolCalls 与待确认 pendingConfirm
    const result = await sendStream(message, history, (chunk) => setStreamingText((p) => p + chunk), currentConversation.id);
    setStreamingText('');
    const aiMsg = {
      role: 'assistant' as const,
      content: result.content,
      timestamp: new Date().toISOString(),
      ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
      ...(result.pendingConfirm ? { pendingConfirm: result.pendingConfirm } : {}),
    };
    await appendMessage(currentConversation.id, aiMsg);
    fetchConversations(user?.id);
  };

  /** 确认执行待确认工具：调 confirm 端点，结果作为新助手消息展示 */
  const handleToolConfirm = async (pendingId: string) => {
    if (!currentConversation || pendingBusy[pendingId]) return;
    setPendingBusy((p) => ({ ...p, [pendingId]: true }));
    try {
      const { summary } = await confirmToolCall(pendingId);
      setPendingStates((p) => ({ ...p, [pendingId]: 'done' }));
      await appendMessage(currentConversation.id, {
        role: 'assistant' as const,
        content: `✅ 已确认执行：${summary}`,
        timestamp: new Date().toISOString(),
      });
      fetchConversations(user?.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '执行失败';
      setPendingStates((p) => ({ ...p, [pendingId]: 'error' }));
      await appendMessage(currentConversation.id, {
        role: 'assistant' as const,
        content: `❌ 确认执行失败：${msg}`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setPendingBusy((p) => ({ ...p, [pendingId]: false }));
    }
  };

  /** 取消待确认工具：调 cancel 端点并展示取消结果 */
  const handleToolCancel = async (pendingId: string) => {
    if (!currentConversation || pendingBusy[pendingId]) return;
    setPendingBusy((p) => ({ ...p, [pendingId]: true }));
    try {
      const { summary } = await cancelToolCall(pendingId);
      setPendingStates((p) => ({ ...p, [pendingId]: 'error' }));
      await appendMessage(currentConversation.id, {
        role: 'assistant' as const,
        content: `🚫 ${summary}，该操作未执行。`,
        timestamp: new Date().toISOString(),
      });
      fetchConversations(user?.id);
    } catch (e) {
      // 取消失败（如已被处理）：卡片也置为终态，提示以后端状态为准
      const msg = e instanceof Error ? e.message : '取消失败';
      setPendingStates((p) => ({ ...p, [pendingId]: 'error' }));
      await appendMessage(currentConversation.id, {
        role: 'assistant' as const,
        content: `⚠️ 取消操作未生效：${msg}`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setPendingBusy((p) => ({ ...p, [pendingId]: false }));
    }
  };

  /** 待确认卡片当前状态：本地终态优先，否则 pending */
  const pendingCardState = (pendingId: string): ToolCallCardState =>
    pendingStates[pendingId] ?? 'pending';

  // 自动调整文本框高度
  const adjustTextareaHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const desired = Math.min(Math.max(ta.scrollHeight, 80), 400);
    ta.style.height = `${desired}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  const handleNewChat = () => { if (user) createNewConversation(user.id, user.displayName); };
  const handleDelete = async () => {
    if (deleteTarget) { await removeConversation(deleteTarget.id); setDeleteTarget(null); fetchConversations(user?.id); }
  };
  const lastMessagePreview = (conv: Conversation) => {
    const last = conv.messages?.[conv.messages.length - 1];
    if (!last) return '新对话';
    const text = last.content.slice(0, 50);
    return (last.role === 'user' ? '你: ' : 'AI: ') + text + (last.content.length > 50 ? '...' : '');
  };
  const current = currentModel();
  const isConfigured = !!current;
  const displayModel = current?.displayName || current?.modelId || '未配置';
  const providerName = current?.providerName || '未配置';

  return (
    <>
      {/* ═══ Chat Interface ═══ */}
      <div className="flex gap-4 h-[calc(100vh-120px)] overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-64 shrink-0 border rounded-lg bg-card flex flex-col h-full overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-1.5"><MessageSquare className="h-4 w-4" />我的对话</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="新对话" onClick={handleNewChat}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
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
                    onClick={() => setCurrentConversation(conv)}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="text-xs text-muted-foreground truncate">{lastMessagePreview(conv)}</p>
                    </div>
                    <Button
                      variant="secondary" size="icon" className="h-7 w-7 shrink-0 opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv); }}
                      title="删除对话"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-2 border-t text-xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{providerName}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => navigate(ROUTES.AI_SETTINGS)} title="AI 设置">
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Right Chat Area */}
        <Card className="flex flex-col flex-1 h-full overflow-hidden">
          <CardHeader className="border-b pb-3 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />智能助手
                <Badge variant="secondary" className="text-[10px] h-5">{displayModel}</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {currentConversation && <span className="text-xs text-muted-foreground">{formatDate(currentConversation.createdAt)}</span>}
                <ModelSelector />
                <Button variant="ghost" size="icon" className="h-7 w-7" title="AI 设置" onClick={() => navigate(ROUTES.AI_SETTINGS)}>
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0 p-0">
            {/* 系统默认配置兜底提示（X-AI-Fallback） */}
            {fallbackNotice && (
              <div className="px-4 pt-3 shrink-0">
                <AIFallbackNotice />
              </div>
            )}
            <div className="flex-1 overflow-y-auto min-h-0 p-4" ref={scrollRef}>
              {!currentConversation || currentConversation.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3 py-16">
                  <Bot className="h-12 w-12" />
                  {!isConfigured ? (
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => navigate(ROUTES.AI_SETTINGS)}
                    >
                      请前往 AI 设置配置模型
                    </button>
                  ) : (
                    <>
                      <p className="text-sm">
                        {currentConversation ? '发送消息开始对话' : '点击左侧对话或创建新对话'}
                      </p>
                      <p className="text-xs text-muted-foreground/70">{providerName} · {displayModel}</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {currentConversation.messages.map((msg, i) => (
                    <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                      {msg.role === 'assistant' && (
                        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Bot className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                      <div className={cn('flex flex-col gap-2 max-w-[80%]', msg.role === 'user' && 'items-end')}>
                        <div className={cn(
                          'rounded-lg px-4 py-2 text-sm',
                          msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        )}>
                          <MarkdownRenderer content={msg.content} />
                        </div>
                        {/* 只读工具调用轨迹卡片（done/error） */}
                        {msg.role === 'assistant' && msg.toolCalls?.map((tc, j) => (
                          <ToolCallCard
                            key={`tc-${i}-${j}`}
                            state={tc.ok ? 'done' : 'error'}
                            tool={tc.name}
                            summary={tc.summary}
                          />
                        ))}
                        {/* 待确认工具卡片（pending → 确认/取消） */}
                        {msg.role === 'assistant' && msg.pendingConfirm && (
                          <ToolCallCard
                            key={`pc-${i}`}
                            state={pendingCardState(msg.pendingConfirm.pendingId)}
                            tool={msg.pendingConfirm.tool}
                            summary={msg.pendingConfirm.argsSummary}
                            busy={!!pendingBusy[msg.pendingConfirm.pendingId]}
                            onConfirm={() => handleToolConfirm(msg.pendingConfirm!.pendingId)}
                            onCancel={() => handleToolCancel(msg.pendingConfirm!.pendingId)}
                          />
                        )}
                      </div>
                      {msg.role === 'user' && (
                        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <User className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  ))}
                  {streamingText && (
                    <div className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div className="rounded-lg px-4 py-2 max-w-[80%] text-sm bg-muted">
                        <MarkdownRenderer content={streamingText} />
                      </div>
                    </div>
                  )}
                  {isLoading && !streamingText && (
                    <div className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div className="rounded-lg px-4 py-2 bg-muted">
                        <div className="flex gap-1 py-1">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="border-t bg-white p-4 shrink-0 z-10">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  placeholder={currentConversation ? '输入消息...（Shift+Enter 换行，Enter 发送）' : '请先选择或创建对话'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={isLoading || !currentConversation}
                  className="min-h-[80px] max-h-[400px] resize-y flex-1"
                  rows={3}
                />
                <Button
                  className="h-10 px-4"
                  onClick={handleSend}
                  disabled={isLoading || !input.trim() || !currentConversation}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="确认删除"
        description="确定要删除这条对话记录吗？"
        onConfirm={handleDelete}
        destructive
      />
    </>
  );
}
