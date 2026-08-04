import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Sparkles,
  FilePlus2,
  Upload,
  FileText,
  Users,
  ChevronRight,
  Coins,
  Hash,
  Database,
  AlertTriangle,
  MessageSquare,
  Cpu,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import { useScriptStore } from '@/stores/scriptStore';
import { useReportStore } from '@/stores/reportStore';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { apiGet } from '@/services/api';
import { fetchResolved, fetchUsage, type ResolvedAIConfig, type UsageStats } from '@/services/aiConfigService';
import { ROUTES } from '@/constants/routes';
import type { Conversation } from '@/types';

/** 千分位数字格式化 */
function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 截取对话预览文本 */
function conversationPreview(c: Conversation): string {
  const firstUserMsg = c.messages.find((m) => m.role === 'user');
  const text = firstUserMsg?.content || '(空对话)';
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** ISO 日期转简短显示（今天显时间，其余显日期） */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { scripts, fetchScripts } = useScriptStore();
  const { reports, fetchReports } = useReportStore();
  const { users, fetchUsers } = useUserStore();
  const { user } = useAuthStore();

  const [resolved, setResolved] = useState<ResolvedAIConfig | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    fetchScripts();
    fetchReports();
    if (user?.role === 'admin') {
      fetchUsers();
    }
    // AI 相关数据独立加载，失败不影响主页面
    fetchResolved().then(setResolved).catch(() => setResolved(null));
    fetchUsage().then(setUsage).catch(() => setUsage(null));
    apiGet('/conversations')
      .then((res) => setConversations(Array.isArray(res?.data?.conversations) ? res.data.conversations : []))
      .catch(() => setConversations([]));
  }, [fetchScripts, fetchReports, fetchUsers, user?.role]);

  // 近 30 天 AI 用量汇总
  const usageSummary = useMemo(() => {
    if (!usage) return null;
    const prompt = usage.stats.reduce((s, r) => s + r.prompt_total, 0);
    const completion = usage.stats.reduce((s, r) => s + r.completion_total, 0);
    const calls = usage.stats.reduce((s, r) => s + r.calls, 0);
    return { prompt, completion, total: prompt + completion, calls };
  }, [usage]);

  // 最近 AI 分析（reportSource === 'ai' 表示 AI 智能分析生成）
  const aiReports = reports.filter((r) => r.reportSource === 'ai').slice(0, 5);
  const aiReportCount = reports.filter((r) => r.reportSource === 'ai').length;
  // 最近对话（按更新时间倒序取前 5）
  const recentConversations = [...conversations]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const stats = [
    {
      title: 'Token 用量（30天）',
      value: usageSummary ? fmtNum(usageSummary.total) : '—',
      sub: usageSummary ? `入 ${fmtNum(usageSummary.prompt)} / 出 ${fmtNum(usageSummary.completion)}` : '暂无用量记录',
      icon: Coins,
      color: 'text-primary',
    },
    {
      title: 'AI 调用次数（30天）',
      value: usageSummary ? fmtNum(usageSummary.calls) : '—',
      sub: '助手 / 分析等全部 AI 功能',
      icon: Hash,
      color: 'text-primary',
    },
    {
      title: 'AI 分析报告',
      value: aiReportCount,
      sub: `全部报告 ${reports.length} 份`,
      icon: Sparkles,
      color: 'text-primary',
    },
    {
      title: '巡检脚本',
      value: scripts.length,
      sub: `可下载报告 ${reports.filter((r) => r.status === 'success').length} 份`,
      icon: FileText,
      color: 'text-sidebar-muted',
    },
    ...(user?.role === 'admin'
      ? [{ title: '用户数量', value: users.length, sub: '系统注册用户', icon: Users, color: 'text-sidebar-muted' }]
      : []),
  ];

  const quickActions = [
    {
      title: 'AI 助手',
      description: '可分析日志、读写脚本、解答运维问题',
      icon: Bot,
      path: ROUTES.ASSISTANT,
      highlight: true,
    },
    {
      title: '知识库',
      description: '管理手册资料，供 AI 分析时引用',
      icon: Database,
      path: ROUTES.KNOWLEDGE_BASE,
      highlight: false,
    },
    {
      title: '脚本生成报告',
      description: '选择巡检脚本，生成标准报告',
      icon: FilePlus2,
      path: `${ROUTES.REPORT_CREATE}?mode=script`,
      highlight: false,
    },
    {
      title: '上传脚本',
      description: '上传新的巡检脚本或模板',
      icon: Upload,
      path: ROUTES.SCRIPTS,
      highlight: false,
    },
  ];

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="space-y-6">
      {/* 欢迎区 + 当前模型状态 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            您好，{user?.displayName || user?.username || '用户'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{today}，欢迎回到智能报告工作台</p>
        </div>
        {resolved?.defaultModel ? (
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs">
            <Cpu className="h-3.5 w-3.5 text-primary" />
            当前模型：{resolved.defaultModel.providerName} / {resolved.defaultModel.displayName}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="cursor-pointer gap-1.5 border-amber-500/50 px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-500/10"
            onClick={() => navigate(ROUTES.AI_SETTINGS)}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            未配置默认模型，点击前往 AI 设置
          </Badge>
        )}
      </div>

      {/* AI 智能分析大入口卡（主功能） */}
      <Card
        className="cursor-pointer border-primary/30 bg-primary/5 transition-colors hover:bg-primary/10"
        onClick={() => navigate(`${ROUTES.REPORT_CREATE}?mode=ai`)}
      >
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">AI 智能分析</h3>
            <p className="text-sm text-muted-foreground">
              上传日志或整机支持包，AI 自动拆包分析并生成巡检报告，点击开始
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-primary" />
        </CardContent>
      </Card>

      {/* 快捷操作卡 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Card
            key={action.title}
            className={`cursor-pointer transition-colors ${
              action.highlight
                ? 'border-primary/30 hover:border-primary/60 hover:bg-primary/5'
                : 'hover:border-primary/40 hover:bg-accent'
            }`}
            onClick={() => navigate(action.path)}
          >
            <CardContent className="flex items-center gap-3 p-5">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  action.highlight ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                }`}
              >
                <action.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{action.title}</p>
                <p className="truncate text-xs text-muted-foreground">{action.description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 统计卡 */}
      <div className={`grid gap-4 md:grid-cols-2 ${stats.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 最近动态：AI 分析 + 最近对话 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 最近 AI 分析 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">最近 AI 分析</CardTitle>
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => navigate(`${ROUTES.REPORTS}?tab=ai`)}
            >
              全部 AI 报告
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </CardHeader>
          <CardContent>
            {aiReports.length === 0 ? (
              <EmptyState title="暂无 AI 分析" description="使用「AI 智能分析」后将在此展示最近记录" />
            ) : (
              <div className="space-y-2">
                {aiReports.map((report) => (
                  <div
                    key={report.id}
                    className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
                    onClick={() => navigate(`${ROUTES.REPORTS}?tab=ai`)}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{report.name}</p>
                        <p className="text-xs text-muted-foreground">{report.date}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 最近对话 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">最近对话</CardTitle>
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => navigate(ROUTES.ASSISTANT)}
            >
              打开 AI 助手
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </CardHeader>
          <CardContent>
            {recentConversations.length === 0 ? (
              <EmptyState title="暂无对话" description="与 AI 助手的对话将在此展示，点击右上角直接开始" />
            ) : (
              <div className="space-y-2">
                {recentConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
                    onClick={() => navigate(`${ROUTES.ASSISTANT}?id=${conv.id}`)}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{conversationPreview(conv)}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(conv.updatedAt)} · {conv.messages.length} 条消息
                        </p>
                      </div>
                    </div>
                    {conv.tokenUsage && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {fmtNum(conv.tokenUsage.totalTokens)} tokens
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
