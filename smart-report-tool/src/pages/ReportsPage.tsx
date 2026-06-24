import { useState, useMemo, useEffect, useRef } from 'react';
import { Download, Trash2, Search, FileText, FolderOpen, Package, X as XIcon, Check, Users, Calendar, MapPin, Tag, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { cn } from '@/lib/utils';
import { useReports } from '@/hooks/useReports';
import { useAuthStore } from '@/stores/authStore';
import { useUserStore } from '@/stores/userStore';
import { Report, ScriptRegion } from '@/types';
import { formatDate } from '@/utils/formatters';
import { LOG_CATEGORIES, LOG_CATEGORY_LABELS } from '@/constants/categories';
import { canAccess } from '@/utils/permissions';
import { getApiUrl, fetchWithAuth } from '@/services/api';
import { toast } from 'sonner';

/** 安全显示 toast 错误，防止 sonner 内部 this.create 丢失上下文时级联崩溃 */
function safeToastError(msg: string) {
  try { toast.error(msg); } catch (e) { console.error('[safeToastError] toast.error 抛出异常:', e); }
}
function safeToastSuccess(msg: string) {
  try { toast.success(msg); } catch (e) { console.error('[safeToastSuccess] toast.success 抛出异常:', e); }
}

const REGION_LIST: ScriptRegion[] = ['全部', '华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];

interface ReportFileInfo { index: number; name: string; size: number; }

function downloadFile(reportId: string, fileIndex: number) {
  const url = getApiUrl(`/reports/${reportId}/download?fileIndex=${fileIndex}`);
  fetchWithAuth(url).then(async (res) => {
    if (!res.ok) { safeToastError('文件不存在或已被清理'); return; }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    // 优先用 Content-Disposition（后端返回脚本原文件名，需解码）
    const cd = res.headers.get('Content-Disposition');
    const match = cd?.match(/filename="?([^"]+)"?/);
    a.download = match ? decodeURIComponent(match[1]) : `report`;
    a.click();
    URL.revokeObjectURL(objUrl);
  }).catch(() => {
    safeToastError('下载失败，请确认后端服务已启动');
  });
}

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
  const [showAuthorPicker, setShowAuthorPicker] = useState(false);
  const [authorSearch, setAuthorSearch] = useState('');
  const [authorRoleFilter, setAuthorRoleFilter] = useState<string>('all');
  const [authorRegionFilter, setAuthorRegionFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const [sortKey, setSortKey] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // 执行日志弹窗
  const [logReport, setLogReport] = useState<Report | null>(null);
  const [logContent, setLogContent] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // 查看报告文件弹窗
  const [filesReport, setFilesReport] = useState<Report | null>(null);
  const [reportFiles, setReportFiles] = useState<ReportFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const canDelete = canAccess(user?.role, 'deleteReport');

  // 区域筛选
  const [regionFilter, setRegionFilter] = useState<string>('全部');

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
      safeToastError('获取执行日志失败');
      setLogContent([]);
    } finally {
      setLogLoading(false);
    }
  };

  // 报告文件白名单扩展名
  const REPORT_FILE_EXTS = ['.html', '.docx', '.xlsx', '.md', '.pdf', '.json'];
  // 常见脚本/辅助文件黑名单
  const EXCLUDED_FILE_NAMES = new Set([
    'alias.json', 'alias.py', 'analysis.py', 'config.py', 'excel_io.py', 'logger.py',
    'main.py', 'config.ini', 'config.json', 'requirements.txt', 'setup.py', 'run.py',
    'utils.py', 'common.py', 'helpers.py', 'constants.py', 'settings.py',
  ]);

  const isReportOutputFile = (fileName: string): boolean => {
    const lower = fileName.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.'));
    if (EXCLUDED_FILE_NAMES.has(lower)) return false;
    if (['.py', '.js', '.ts', '.jsx', '.tsx', '.ps1', '.bat', '.sh', '.cmd', '.ini', '.cfg', '.yaml', '.yml', '.toml'].includes(ext)) return false;
    return REPORT_FILE_EXTS.includes(ext);
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
            name: f.name || `file_${i + 1}`,
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
      safeToastSuccess('报告已删除');
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
      return matchSearch && matchType && matchStatus && matchDate && matchAuthor && matchRegion;
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
  }, [reports, searchQuery, typeFilter, statusFilter, dateMode, dateFrom, dateTo, authorFilterIds, regionFilter, sortKey, sortDir, user]);

  const columns = [
    { key: 'name', header: '报告名称', sortable: true },
    { key: 'type', header: '类型', sortable: true, render: (item: Report) => LOG_CATEGORY_LABELS[item.type] },
    { key: 'region', header: '区域', sortable: true, render: (item: Report) => item.region || '全部' },
    { key: 'date', header: '日期', sortable: true },
    { key: 'author', header: '作者', sortable: true },
    {
      key: 'status',
      header: '状态',
      sortable: true,
      render: (item: Report) => <StatusBadge status={item.status} />,
    },
    { key: 'createdAt', header: '创建时间', sortable: true, render: (item: Report) => formatDate((item as any).generatedAt || item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      render: (item: Report) => {
        return (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" title="查看执行日志" onClick={() => fetchLogs(item)}>
            <FileText className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" title="查看报告文件" onClick={() => fetchReportFiles(item)}>
            <FolderOpen className="h-4 w-4" />
          </Button>
          {canDeleteReport(item) && (
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      );},
    },
  ];

  function formatSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">报告管理</h2>

      <div className="space-y-3">
        {/* 行1：搜索框 + 清除筛选按钮 */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索报告名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-xs shrink-0"
            disabled={!searchQuery && typeFilter === 'all' && statusFilter === 'all' && dateMode === 'all' && authorFilterIds.length === 0 && regionFilter === '全部'}
            onClick={() => {
              setSearchQuery('');
              setTypeFilter('all');
              setStatusFilter('all');
              setDateMode('all');
              setDateFrom('');
              setDateTo('');
              setAuthorFilterIds([]);
              setRegionFilter('全部');
            }}
          >
            <XIcon className="h-3.5 w-3.5 mr-1" />清除筛选
          </Button>
        </div>

        {/* 行2：筛选器 */}
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-auto h-9">
              <Tag className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {LOG_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-auto h-9">
              <CheckCircle className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
            </SelectContent>
          </Select>
          {/* 区域筛选 */}
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-auto h-9">
              <MapPin className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="全部区域" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="全部">全部区域</SelectItem>
              {REGION_LIST.filter((r) => r !== '全部').map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* 日期筛选 */}
          <div className="flex items-center gap-1">
            <Select value={dateMode} onValueChange={(v) => { setDateMode(v); if (v === 'all') { setDateFrom(''); setDateTo(''); } }}>
              <SelectTrigger className="w-auto h-9">
                <Calendar className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="日期" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部日期</SelectItem>
                <SelectItem value="exact">精确日期</SelectItem>
                <SelectItem value="after">在此之后</SelectItem>
                <SelectItem value="before">在此之前</SelectItem>
                <SelectItem value="range">日期范围</SelectItem>
              </SelectContent>
            </Select>
            {dateMode !== 'all' && (
              <>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[140px] h-9 text-xs" />
                {dateMode === 'range' && (
                  <>
                    <span className="text-xs text-muted-foreground mx-0.5 shrink-0">至</span>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[140px] h-9 text-xs" />
                  </>
                )}
              </>
            )}
          </div>
          {/* 作者筛选 */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-9" onClick={() => setShowAuthorPicker(true)}>
              <Users className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              {authorFilterIds.length > 0 ? `已选 ${authorFilterIds.length} 位作者` : '筛选作者'}
            </Button>
            {authorFilterIds.length > 0 && (
              <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setAuthorFilterIds([])}>
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>报告列表</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filteredReports} keyExtractor={(item) => item.id} sortKey={sortKey} sortDir={sortDir} onSortChange={handleSort} />
        </CardContent>
      </Card>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="确认删除"
        description={`确定要删除报告「${deleteTarget?.name}」吗？`}
        onConfirm={handleDelete}
        destructive
      />

      {/* 执行日志弹窗 */}
      <Dialog open={!!logReport} onOpenChange={(open) => { if (!open) { logAbortRef.current?.abort(); setLogReport(null); } }}>
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

      {/* ═════ 作者筛选弹窗 ═════ */}
      <Dialog open={showAuthorPicker} onOpenChange={(open) => { setShowAuthorPicker(open); if (!open) { setAuthorSearch(''); setAuthorRoleFilter('all'); setAuthorRegionFilter('all'); } }}>
        <DialogContent className="max-w-sm max-h-[70vh] flex flex-col">
          <DialogHeader><DialogTitle>选择作者</DialogTitle></DialogHeader>
          <div className="space-y-3 flex-1 min-h-0 flex flex-col">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={authorSearch}
                onChange={(e) => setAuthorSearch(e.target.value)}
                placeholder="搜索作者..."
                className="pl-8 h-9"
              />
            </div>
            {/* 筛选行 */}
            <div className="flex gap-2 flex-wrap items-center">
              <Select value={authorRoleFilter} onValueChange={setAuthorRoleFilter}>
                <SelectTrigger className="w-auto h-8 text-xs">
                  <Users className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="全部角色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部角色</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                  <SelectItem value="senior">高级成员</SelectItem>
                  <SelectItem value="member">普通成员</SelectItem>
                </SelectContent>
              </Select>
              <Select value={authorRegionFilter} onValueChange={setAuthorRegionFilter}>
                <SelectTrigger className="w-auto h-8 text-xs">
                  <MapPin className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="全部区域" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部区域</SelectItem>
                  {REGION_LIST.filter((r) => r !== '全部').map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={authorRoleFilter === 'all' && authorRegionFilter === 'all'}
                onClick={() => { setAuthorRoleFilter('all'); setAuthorRegionFilter('all'); }}
              >
                <XIcon className="h-3 w-3 mr-0.5" />清除筛选
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg">
              {(() => {
                const authorList = users
                  .filter((u) => {
                    if (!u.displayName) return false;
                    if (authorSearch && !u.displayName.toLowerCase().includes(authorSearch.toLowerCase()) && !u.username.toLowerCase().includes(authorSearch.toLowerCase())) return false;
                    if (authorRoleFilter !== 'all' && u.role !== authorRoleFilter) return false;
                    if (authorRegionFilter !== 'all' && (u.region || '全部') !== authorRegionFilter) return false;
                    return true;
                  })
                  .map((u) => u.displayName)
                  .filter((name, i, arr) => arr.indexOf(name) === i); // 去重
                if (authorList.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-12">无匹配用户</p>;
                }
                return (
                  <div className="divide-y">
                    {authorList.map((name) => {
                      const isSel = authorFilterIds.includes(name);
                      return (
                        <div
                          key={name}
                          className={cn(
                            'flex items-center gap-3 px-4 py-2.5 hover:bg-accent cursor-pointer transition-colors',
                            isSel && 'bg-primary/5'
                          )}
                          onClick={() => {
                            setAuthorFilterIds(isSel
                              ? authorFilterIds.filter((id) => id !== name)
                              : [...authorFilterIds, name]
                            );
                          }}
                        >
                          <div className={cn(
                            'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                            isSel ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                          )}>
                            {isSel && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                          </div>
                          <span className="text-sm truncate">{name}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">已选 {authorFilterIds.length} 人</span>
              {authorFilterIds.length > 0 && (
                <button className="text-xs text-primary hover:underline" onClick={() => setAuthorFilterIds([])}>清空</button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setShowAuthorPicker(false); setAuthorSearch(''); setAuthorRoleFilter('all'); setAuthorRegionFilter('all'); }}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 报告文件列表弹窗 */}
      <Dialog open={!!filesReport} onOpenChange={(open) => { if (!open) { filesAbortRef.current?.abort(); setFilesReport(null); setReportFiles([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>报告文件 - {filesReport?.name}</DialogTitle>
          </DialogHeader>
          {reportFiles.length > 1 && !filesLoading && (
            <div className="flex gap-2 pb-1">
              <Button size="sm" onClick={() => {
                for (let i = 0; i < reportFiles.length; i++) {
                  setTimeout(() => downloadFile(filesReport!.id, reportFiles[i].index), i * 300);
                }
              }}>
                <Download className="mr-1 h-3 w-3" />一键下载全部 ({reportFiles.length})
              </Button>
              <Button size="sm" variant="secondary" onClick={async () => {
                // 立即捕获当前报告信息，防止 dialog 关闭后状态变化
                const currentReport = filesReport;
                if (!currentReport) {
                  safeToastError('报告ID为空');
                  return;
                }
                try {
                  const res = await fetchWithAuth(getApiUrl(`/reports/${currentReport.id}/download-all`));
                  if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    safeToastError(errData.error || errData.message || `打包下载失败 (${res.status})`);
                    return;
                  }
                  const blob = await res.blob();
                  const objUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = objUrl;
                  const cd = res.headers.get('Content-Disposition');
                  const match = cd?.match(/filename="?([^"]+)"?/);
                  a.download = match ? decodeURIComponent(match[1]) : `${currentReport.name}_全部文件.tar.gz`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
                } catch (err: any) {
                  safeToastError(`打包下载失败: ${err.message || '网络错误'}`);
                  console.error('[打包下载] 捕获异常:', err);
                }
              }}>
                <Package className="mr-1 h-3 w-3" />打包下载 (.tar.gz)
              </Button>
            </div>
          )}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filesLoading ? (
              <p className="text-sm text-muted-foreground text-center py-4">加载中...</p>
            ) : reportFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无可下载的报告文件</p>
            ) : (
              reportFiles.map((f) => (
                <div key={f.index} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-sm font-medium truncate" title={f.name}>{f.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => downloadFile(filesReport!.id, f.index)}>
                    <Download className="mr-1 h-3 w-3" />下载
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
