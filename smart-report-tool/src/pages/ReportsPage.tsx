import { useState } from 'react';
import { Download, Trash2, Search, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useReports } from '@/hooks/useReports';
import { useAuthStore } from '@/stores/authStore';
import { Report } from '@/types';
import { formatDate } from '@/utils/formatters';
import { LOG_CATEGORIES, LOG_CATEGORY_LABELS } from '@/constants/categories';
import { canAccess } from '@/utils/permissions';
import { toast } from 'sonner';

export default function ReportsPage() {
  const { reports, removeReport, refreshReports } = useReports();
  const { user } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const [logReport, setLogReport] = useState<Report | null>(null);
  const [logContent, setLogContent] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  const canDelete = canAccess(user?.role, 'deleteReport');

  const fetchLogs = async (report: Report) => {
    setLogReport(report);
    setLogLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/reports/${report.id}/logs`);
      if (!res.ok) throw new Error('获取日志失败');
      const data = await res.json();
      setLogContent(data.logs || []);
    } catch (e) {
      toast.error('获取执行日志失败');
      setLogContent([]);
    } finally {
      setLogLoading(false);
    }
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await removeReport(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('报告已删除');
      refreshReports();
    }
  };

  const filteredReports = reports.filter((r) => {
    const matchSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = typeFilter === 'all' || r.type === typeFilter;
    return matchSearch && matchType;
  });

  const columns = [
    { key: 'name', header: '报告名称' },
    { key: 'type', header: '类型', render: (item: Report) => LOG_CATEGORY_LABELS[item.type] },
    { key: 'date', header: '日期' },
    { key: 'author', header: '作者' },
    {
      key: 'status',
      header: '状态',
      render: (item: Report) => <StatusBadge status={item.status} />,
    },
    { key: 'createdAt', header: '创建时间', render: (item: Report) => formatDate(item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      render: (item: Report) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" title="查看执行日志" onClick={() => fetchLogs(item)}>
            <FileText className="h-4 w-4" />
          </Button>
          {item.fileUrl && (
            <Button variant="ghost" size="sm" onClick={() => {
              const a = document.createElement('a');
              a.href = item.fileUrl!;
              a.download = `${item.name}.html`;
              a.click();
            }}>
              <Download className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">报告管理</h2>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索报告..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {LOG_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>报告列表</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filteredReports} keyExtractor={(item) => item.id} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="确认删除"
        description={`确定要删除报告「${deleteTarget?.name}」吗？`}
        onConfirm={handleDelete}
        destructive
      />

      <Dialog open={!!logReport} onOpenChange={() => setLogReport(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>执行日志 - {logReport?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto bg-black text-green-400 font-mono text-sm p-4 rounded-md">
            {logLoading ? (
              <div className="text-muted-foreground">加载中...</div>
            ) : logContent.length === 0 ? (
              <div className="text-muted-foreground">暂无日志</div>
            ) : (
              logContent.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
