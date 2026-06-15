import { useEffect } from 'react';
import { FileText, ClipboardList, Download, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useScriptStore } from '@/stores/scriptStore';
import { useReportStore } from '@/stores/reportStore';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';

export default function DashboardPage() {
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

  const stats = [
    { title: '脚本数量', value: scripts.length, icon: FileText, color: 'text-blue-500' },
    { title: '报告数量', value: reports.length, icon: ClipboardList, color: 'text-green-500' },
    { title: '可下载报告', value: reports.filter((r) => r.status === 'success').length, icon: Download, color: 'text-purple-500' },
    ...(user?.role === 'admin' ? [{ title: '用户数量', value: users.length, icon: Users, color: 'text-orange-500' }] : []),
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">仪表盘</h2>
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>最近生成的报告</CardTitle>
          </CardHeader>
          <CardContent>
            {reports.slice(0, 5).length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无报告</p>
            ) : (
              <div className="space-y-2">
                {reports.slice(0, 5).map((report) => (
                  <div key={report.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">{report.name}</p>
                      <p className="text-xs text-muted-foreground">{report.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>快捷入口</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">欢迎使用智能报告生成工具</p>
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>在「脚本管理」中上传巡检脚本</li>
              <li>在「生成报告」中创建新的巡检报告</li>
              <li>在「报告管理」中查看和下载历史报告</li>
              <li>在「AI助手」中获取智能分析建议</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
