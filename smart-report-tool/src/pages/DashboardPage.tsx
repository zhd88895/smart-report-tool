import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Sparkles,
  FilePlus2,
  Upload,
  FileText,
  ClipboardList,
  Download,
  Users,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { useScriptStore } from '@/stores/scriptStore';
import { useReportStore } from '@/stores/reportStore';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { ROUTES } from '@/constants/routes';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { scripts, fetchScripts } = useScriptStore();
  const { reports, fetchReports } = useReportStore();
  const { users, fetchUsers } = useUserStore();
  const { user } = useAuthStore();

  useEffect(() => {
    fetchScripts();
    fetchReports();
    if (user?.role === 'admin') {
      fetchUsers();
    }
  }, [fetchScripts, fetchReports, fetchUsers, user?.role]);

  // 最近 AI 分析（reportSource === 'ai' 表示 AI 智能分析生成）
  const aiReports = reports.filter((r) => r.reportSource === 'ai').slice(0, 5);

  const stats = [
    { title: '脚本数量', value: scripts.length, icon: FileText, color: 'text-primary' },
    { title: '报告数量', value: reports.length, icon: ClipboardList, color: 'text-sidebar-muted' },
    { title: '可下载报告', value: reports.filter((r) => r.status === 'success').length, icon: Download, color: 'text-primary' },
    ...(user?.role === 'admin' ? [{ title: '用户数量', value: users.length, icon: Users, color: 'text-sidebar-muted' }] : []),
  ];

  const quickActions = [
    {
      title: 'AI 智能分析',
      description: '上传日志，AI 自动分析并生成报告',
      icon: Sparkles,
      path: `${ROUTES.REPORT_CREATE}?mode=ai`,
      highlight: true,
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

  return (
    <div className="space-y-6">
      {/* 欢迎区 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          您好，{user?.displayName || user?.username || '用户'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">欢迎回到智能报告工作台</p>
      </div>

      {/* AI 助手大入口卡 */}
      <Card
        className="cursor-pointer border-primary/30 bg-primary/5 transition-colors hover:bg-primary/10"
        onClick={() => navigate(ROUTES.ASSISTANT)}
      >
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Bot className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">AI 助手</h3>
            <p className="text-sm text-muted-foreground">
              可分析日志、读写脚本、解答运维问题，点击开始对话
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-primary" />
        </CardContent>
      </Card>

      {/* 快捷操作卡 */}
      <div className="grid gap-4 md:grid-cols-3">
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 最近 AI 分析 */}
      <Card>
        <CardHeader>
          <CardTitle>最近 AI 分析</CardTitle>
        </CardHeader>
        <CardContent>
          {aiReports.length === 0 ? (
            <EmptyState title="暂无 AI 分析" description="使用「AI 分析巡检日志」后将在此展示最近记录" />
          ) : (
            <div className="space-y-2">
              {aiReports.map((report) => (
                <div
                  key={report.id}
                  className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
                  onClick={() => navigate(`${ROUTES.REPORTS}?tab=ai`)}
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{report.name}</p>
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
    </div>
  );
}
