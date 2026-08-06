/**
 * 系统日志页（仅管理员）
 *
 * 四类日志：
 * - 安全审计日志：用户编辑/删除/角色变更/密码重置等敏感操作（含被拒绝、密码验证失败的尝试）
 * - 设置操作日志：系统设置修改记录
 * - 登录日志：登录成功/失败、登出
 * - 后端运行日志：读取后端日志文件（今天+昨天），支持级别筛选
 */

import { useEffect, useState, useCallback } from 'react';
import { ScrollText, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/common/DataTable';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { apiGet } from '@/services/api';

interface AuditLog {
  id: string;
  action: string;
  actorName: string | null;
  target: string | null;
  detail: string | null;
  result: 'success' | 'failed' | 'denied';
  ip: string | null;
  createdAt: string;
}

interface RuntimeLog {
  timestamp: string;
  level: string;
  module: string;
  message: string;
}

const ACTION_LABELS: Record<string, string> = {
  'user.delete': '删除用户',
  'user.update': '编辑用户资料',
  'user.role_change': '修改角色',
  'user.status_change': '状态变更',
  'user.reset_password': '重置密码',
  'settings.update': '修改系统设置',
  'auth.login': '登录',
  'auth.logout': '登出',
};

const RESULT_LABELS: Record<string, { text: string; cls: string }> = {
  success: { text: '成功', cls: 'bg-green-100 text-green-800' },
  failed: { text: '失败', cls: 'bg-red-100 text-red-800' },
  denied: { text: '已拒绝', cls: 'bg-yellow-100 text-yellow-800' },
};

const LEVEL_COLORS: Record<string, string> = {
  INFO: 'bg-blue-100 text-blue-800',
  WARN: 'bg-yellow-100 text-yellow-800',
  ERROR: 'bg-red-100 text-red-800',
  DEBUG: 'bg-muted text-muted-foreground',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

/** 审计类日志表格（安全审计/设置操作/登录共用） */
function AuditTable({ category, refreshKey }: { category: string; refreshKey: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async (kw: string) => {
    setLoading(true);
    try {
      const data = await apiGet(`/audit-logs?category=${category}&limit=200${kw ? `&search=${encodeURIComponent(kw)}` : ''}`);
      setLogs(data.data?.logs || []);
    } catch (e: any) {
      toast.error(e?.message || '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { setSearch(''); load(''); }, [load, refreshKey]);

  const columns = [
    { key: 'createdAt', header: '时间', width: '165px', minWidth: 150, render: (l: AuditLog) => <span className="text-sm tabular-nums">{formatTime(l.createdAt)}</span> },
    { key: 'actorName', header: '操作者', minWidth: 90, render: (l: AuditLog) => l.actorName || '-' },
    {
      key: 'action', header: '操作', minWidth: 100,
      render: (l: AuditLog) => ACTION_LABELS[l.action] || l.action,
    },
    { key: 'target', header: '目标', minWidth: 90, render: (l: AuditLog) => <span className="break-all">{l.target || '-'}</span> },
    {
      key: 'result', header: '结果', width: '90px', minWidth: 80, align: 'center' as const,
      render: (l: AuditLog) => {
        const r = RESULT_LABELS[l.result] || { text: l.result, cls: 'bg-muted' };
        return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${r.cls}`}>{r.text}</span>;
      },
    },
    { key: 'detail', header: '详情', flex: true, render: (l: AuditLog) => <span className="text-sm break-all">{l.detail || '-'}</span> },
    { key: 'ip', header: 'IP', width: '120px', minWidth: 100, render: (l: AuditLog) => <span className="text-xs text-muted-foreground">{l.ip || '-'}</span> },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="搜索操作者 / 目标 / 详情..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(search); }}
          />
        </div>
        <Button size="sm" variant="outline" className="h-9" onClick={() => load(search)}>搜索</Button>
      </div>
      {loading ? (
        <LoadingSpinner text="加载中..." className="py-8" />
      ) : (
        <DataTable columns={columns} data={logs} keyExtractor={(l) => l.id} tableId={`audit-${category}`} tableClassName="text-sm" toolbarContainerId={`audit-${category}-toolbar`} />
      )}
    </div>
  );
}

/** 后端运行日志表格 */
function RuntimeLogTable({ refreshKey }: { refreshKey: number }) {
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState('all');

  const load = useCallback(async (lv: string) => {
    setLoading(true);
    try {
      const data = await apiGet(`/audit-logs/runtime?lines=500${lv !== 'all' ? `&level=${lv}` : ''}`);
      setLogs(data.data?.logs || []);
    } catch (e: any) {
      toast.error(e?.message || '运行日志加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(level); }, [load, level, refreshKey]);

  const columns = [
    { key: 'timestamp', header: '时间', width: '200px', minWidth: 180, render: (l: RuntimeLog) => <span className="text-xs tabular-nums">{formatTime(l.timestamp)}</span> },
    {
      key: 'level', header: '级别', width: '90px', minWidth: 80, align: 'center' as const,
      render: (l: RuntimeLog) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${LEVEL_COLORS[l.level] || 'bg-muted'}`}>{l.level}</span>
      ),
    },
    { key: 'module', header: '模块', width: '150px', minWidth: 110, render: (l: RuntimeLog) => <span className="text-sm">{l.module}</span> },
    { key: 'message', header: '内容', flex: true, render: (l: RuntimeLog) => <span className="text-sm break-all">{l.message}</span> },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部级别</SelectItem>
            <SelectItem value="INFO">INFO</SelectItem>
            <SelectItem value="WARN">WARN</SelectItem>
            <SelectItem value="ERROR">ERROR</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">显示今天与昨天的运行日志（最新 500 条）</span>
      </div>
      {loading ? (
        <LoadingSpinner text="加载中..." className="py-8" />
      ) : (
        <DataTable columns={columns} data={logs} keyExtractor={(l) => `${l.timestamp}-${l.module}-${l.message.slice(0, 30)}`} tableId="audit-runtime" tableClassName="text-sm" toolbarContainerId="audit-runtime-toolbar" />
      )}
    </div>
  );
}

export default function SystemLogsPage() {
  const [tab, setTab] = useState('security');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ScrollText className="h-6 w-6" />系统日志
        </h2>
        <Button size="sm" variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw className="mr-1 h-4 w-4" />刷新
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="security">安全审计日志</TabsTrigger>
          <TabsTrigger value="settings">设置操作日志</TabsTrigger>
          <TabsTrigger value="auth">登录日志</TabsTrigger>
          <TabsTrigger value="runtime">后端运行日志</TabsTrigger>
        </TabsList>
        {(['security', 'settings', 'auth'] as const).map((cat) => (
          <TabsContent key={cat} value={cat} className="mt-4">
            <Card>
              <CardHeader className="pt-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {cat === 'security' ? '安全审计日志' : cat === 'settings' ? '设置操作日志' : '登录日志'}
                  </CardTitle>
                  <div id={`audit-${cat}-toolbar`} className="shrink-0" />
                </div>
              </CardHeader>
              <CardContent>
                <AuditTable category={cat} refreshKey={refreshKey} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
        <TabsContent value="runtime" className="mt-4">
          <Card>
            <CardHeader className="pt-4 pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">后端运行日志</CardTitle>
                <div id="audit-runtime-toolbar" className="shrink-0" />
              </div>
            </CardHeader>
            <CardContent>
              <RuntimeLogTable refreshKey={refreshKey} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
