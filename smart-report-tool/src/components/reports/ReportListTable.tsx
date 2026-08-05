import { FileText, FolderOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Report } from '@/types';
import { formatDateShort } from '@/utils/formatters';
import { LOG_CATEGORY_LABELS } from '@/constants/categories';

/** AI 分析特有的扩展类别显示名（support/other 不属于脚本类 LogCategory） */
const AI_EXTRA_TYPE_LABELS: Record<string, string> = { support: '整机支持包', other: '其他' };

export interface ReportListTableProps {
  reports: Report[];
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (key: string) => void;
  /** 判断当前用户是否能删除指定报告 */
  canDeleteReport: (report: Report) => boolean;
  onViewLogs: (report: Report) => void;
  onViewFiles: (report: Report) => void;
  onDelete: (report: Report) => void;
}

/** 报告管理页列表卡片：列定义 + DataTable */
export function ReportListTable({
  reports,
  sortKey,
  sortDir,
  onSortChange,
  canDeleteReport,
  onViewLogs,
  onViewFiles,
  onDelete,
}: ReportListTableProps) {
  const columns = [
    {
      key: 'reportNo',
      header: '编号',
      width: '190px',
      sortable: true,
      render: (item: Report) => <span className="font-mono text-xs">{item.reportNo || '-'}</span>,
    },
    { key: 'name', header: '报告名称', sortable: true },
    { key: 'type', header: '类型', sortable: true, render: (item: Report) => LOG_CATEGORY_LABELS[item.type] || AI_EXTRA_TYPE_LABELS[item.type] || item.type || '-' },
    { key: 'region', header: '区域', sortable: true, render: (item: Report) => item.region || '全部' },
    { key: 'date', header: '日期', sortable: true, render: (item: Report) => item.date ? formatDateShort(item.date) : (item as any).generatedAt ? formatDateShort((item as any).generatedAt) : '-' },
    { key: 'author', header: '作者', sortable: true, render: (item: Report) => item.author || (item as any).generatedBy || '-' },
    {
      key: 'status',
      header: '状态',
      width: '80px',
      sortable: true,
      render: (item: Report) => <StatusBadge status={item.status} />,
    },
    { key: 'createdAt', header: '创建时间', sortable: true, render: (item: Report) => formatDateShort((item as any).generatedAt || item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      width: '120px',
      render: (item: Report) => {
        const isAI = (item.reportSource || 'script') === 'ai';
        return (
        <div className="flex gap-2">
          {!isAI && (
            <Button variant="ghost" size="sm" title="查看执行日志" onClick={() => onViewLogs(item)}>
              <FileText className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" title="查看报告文件" onClick={() => onViewFiles(item)}>
            <FolderOpen className="h-4 w-4" />
          </Button>
          {canDeleteReport(item) && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(item)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      );},
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>报告列表</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable columns={columns} data={reports} keyExtractor={(item) => item.id} sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} />
      </CardContent>
    </Card>
  );
}
