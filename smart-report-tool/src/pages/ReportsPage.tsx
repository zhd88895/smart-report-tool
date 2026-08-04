import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ReportFilterBar } from '@/components/reports/ReportFilterBar';
import { ReportListTable } from '@/components/reports/ReportListTable';
import { ReportPreviewDialog, ReportFileInfo, isReportOutputFile } from '@/components/reports/ReportPreviewDialog';
import { useReports } from '@/hooks/useReports';
import { useAuthStore } from '@/stores/authStore';
import { useUserStore } from '@/stores/userStore';
import { Report } from '@/types';
import { LOG_CATEGORY_LABELS } from '@/constants/categories';
import { canAccess } from '@/utils/permissions';
import { getApiUrl, fetchWithAuth } from '@/services/api';
import { toast } from 'sonner';

export default function ReportsPage() {
  const { reports, removeReport, refreshReports } = useReports();
  const { user } = useAuthStore();
  const { users, fetchUsers } = useUserStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // 日期筛选
  const [dateMode, setDateMode] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // 作者筛选
  const [authorFilterIds, setAuthorFilterIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(searchParams.get('tab') === 'ai' ? 'ai' : 'script'); // 'script' | 'ai'
  const [sortKey, setSortKey] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // 区域筛选
  const [regionFilter, setRegionFilter] = useState<string>('全部');
  // 是否已根据当前用户初始化过默认筛选（防止手动清空后再次自动应用）
  const [hasInitDefaultFilters, setHasInitDefaultFilters] = useState(false);

  // 执行日志弹窗
  const [logReport, setLogReport] = useState<Report | null>(null);
  const [logContent, setLogContent] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // 查看报告文件弹窗
  const [filesReport, setFilesReport] = useState<Report | null>(null);
  const [reportFiles, setReportFiles] = useState<ReportFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const canDelete = canAccess(user?.role, 'deleteReport');

  // AbortControllers for long requests
  const logAbortRef = useRef<AbortController | null>(null);
  const filesAbortRef = useRef<AbortController | null>(null);

  // 判断当前用户是否能删除指定报告（senior 只能删除自己区域的）
  const canDeleteReport = (report: Report): boolean => {
    if (!canDelete) return false;
    if (user?.role === 'admin') return true;
    // senior: 只能删除自己区域的报告
    if (user?.role === 'senior') {
      const userRegion = user.region || '全部';
      const reportRegion = report.region || '全部';
      return userRegion === '全部' || reportRegion === '全部' || reportRegion === userRegion;
    }
    return false;
  };

  // 加载用户列表用于作者筛选
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // 默认筛选：作者=当前用户，区域=当前用户所属区域（仅在首次获取到用户时应用一次）
  useEffect(() => {
    if (user && !hasInitDefaultFilters) {
      const authorName = user.displayName || user.username || '';
      if (authorName) {
        setAuthorFilterIds([authorName]);
      }
      if (user.region) {
        setRegionFilter(user.region);
      }
      setHasInitDefaultFilters(true);
    }
  }, [user, hasInitDefaultFilters]);

  const fetchLogs = async (report: Report) => {
    // Abort previous request
    logAbortRef.current?.abort();
    const controller = new AbortController();
    logAbortRef.current = controller;

    setLogReport(report);
    setLogLoading(true);
    try {
      const res = await fetchWithAuth(getApiUrl(`/reports/${report.id}/logs`), { signal: controller.signal });
      if (!res.ok) throw new Error('获取日志失败');
      const payload = await res.json();
      const logs = payload.data?.logs || payload.logs || [];
      setLogContent(logs);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      toast.error('获取执行日志失败');
      setLogContent([]);
    } finally {
      setLogLoading(false);
    }
  };

  const fetchReportFiles = async (report: Report) => {
    // Abort previous request
    filesAbortRef.current?.abort();
    const controller = new AbortController();
    filesAbortRef.current = controller;

    setFilesReport(report);
    setFilesLoading(true);
    setReportFiles([]);
    try {
      const res = await fetchWithAuth(getApiUrl(`/reports/${report.id}/files`), { signal: controller.signal });
      if (res.ok) {
        const payload = await res.json();
        const files = payload.data?.files || payload.files || [];
        const filteredFiles = files.filter((f: any) => isReportOutputFile(f.name || ''));
        if (filteredFiles.length > 0) {
          setReportFiles(filteredFiles.map((f: any, i: number) => ({
            index: i,
            name: (f.name || '').split(/[/\\]/).pop() || `file_${i + 1}`,
            size: f.size || 0,
          })));
          setFilesLoading(false);
          return;
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      // 后端不可用，继续走本地兜底
    }

    // 本地 filePaths/filePath 兜底
    const localPaths = report.filePaths && report.filePaths.length > 0
      ? report.filePaths : (report.filePath ? [report.filePath] : []);
    const files: ReportFileInfo[] = localPaths
      .filter((fp) => isReportOutputFile(fp))
      .map((fp, i) => ({
        index: i,
        name: fp.split(/[/\\]/).pop() || `file_${i + 1}`,
        size: 0,
      }));
    setReportFiles(files);
    setFilesLoading(false);
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await removeReport(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('报告已删除');
      refreshReports();
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filteredReports = useMemo(() => {
    let result = reports.filter((r) => {
      // Tab筛选：根据 activeTab 过滤报告来源
      const expectSource = activeTab === 'ai' ? 'ai' : 'script';
      const matchSource = (r.reportSource || 'script') === expectSource;
      const matchSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchType = typeFilter === 'all' || r.type === typeFilter;
      const matchStatus = statusFilter === 'all' || r.status === statusFilter;
      // 日期筛选
      let matchDate = true;
      if (dateMode !== 'all' && r.date) {
        if (dateMode === 'exact') matchDate = r.date === dateFrom;
        else if (dateMode === 'after' && dateFrom) matchDate = r.date >= dateFrom;
        else if (dateMode === 'before' && dateFrom) matchDate = r.date <= dateFrom;
        else if (dateMode === 'range') {
          const inRange = (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo);
          matchDate = inRange;
        }
      }
      // 作者筛选（多选，报告作者在选中列表中即匹配）
      let matchAuthor = true;
      if (authorFilterIds.length > 0) {
        matchAuthor = authorFilterIds.includes(r.author);
      }
      // 区域筛选
      let matchRegion = true;
      if (regionFilter !== '全部') {
        matchRegion = (r.region || '全部') === regionFilter;
      }
      return matchSource && matchSearch && matchType && matchStatus && matchDate && matchAuthor && matchRegion;
    });

    // 区域优先排序：匹配用户区域的排最前（非 admin 用户）
    if (user?.role && user.role !== 'admin') {
      const userRegion = user.region || '全部';
      result = [...result].sort((a, b) => {
        const ra = a.region || '全部';
        const rb = b.region || '全部';
        const aMatch = userRegion === '全部' || ra === '全部' || ra === userRegion;
        const bMatch = userRegion === '全部' || rb === '全部' || rb === userRegion;
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    }

    // 用户选择的排序
    result.sort((a, b) => {
      let va: any = (a as any)[sortKey];
      let vb: any = (b as any)[sortKey];
      if (sortKey === 'type') { va = LOG_CATEGORY_LABELS[a.type]; vb = LOG_CATEGORY_LABELS[b.type]; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [reports, searchQuery, typeFilter, statusFilter, dateMode, dateFrom, dateTo, authorFilterIds, regionFilter, sortKey, sortDir, user, activeTab]);

  const hasActiveFilters = !!searchQuery || typeFilter !== 'all' || statusFilter !== 'all' || dateMode !== 'all' || authorFilterIds.length > 0 || regionFilter !== '全部';

  const clearFilters = () => {
    setSearchQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
    setDateMode('all');
    setDateFrom('');
    setDateTo('');
    setAuthorFilterIds([]);
    setRegionFilter('全部');
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">报告管理</h2>

      <ReportFilterBar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        regionFilter={regionFilter}
        onRegionFilterChange={setRegionFilter}
        dateMode={dateMode}
        onDateModeChange={setDateMode}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        authorFilterIds={authorFilterIds}
        onAuthorFilterIdsChange={setAuthorFilterIds}
        users={users}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

      {/* Tab 切换：脚本生成 / AI生成 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="script">脚本生成</TabsTrigger>
          <TabsTrigger value="ai">AI生成</TabsTrigger>
        </TabsList>
      </Tabs>

      <ReportListTable
        reports={filteredReports}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSort}
        canDeleteReport={canDeleteReport}
        onViewLogs={fetchLogs}
        onViewFiles={fetchReportFiles}
        onDelete={setDeleteTarget}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="确认删除"
        description={`确定要删除报告「${deleteTarget?.name}」吗？`}
        onConfirm={handleDelete}
        destructive
      />

      <ReportPreviewDialog
        logReport={logReport}
        logContent={logContent}
        logLoading={logLoading}
        onCloseLog={() => { logAbortRef.current?.abort(); setLogReport(null); }}
        filesReport={filesReport}
        reportFiles={reportFiles}
        filesLoading={filesLoading}
        onCloseFiles={() => { filesAbortRef.current?.abort(); setFilesReport(null); setReportFiles([]); }}
      />
    </div>
  );
}
