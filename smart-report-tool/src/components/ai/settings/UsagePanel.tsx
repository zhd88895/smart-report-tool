import { useMemo, useState } from 'react';
import { RefreshCw, BarChart3, Table as TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/common/EmptyState';
import { UsageChart } from './UsageChart';
import { cn } from '@/lib/utils';
import type { UsageStats } from '@/services/aiConfigService';

/** 用量功能标签 */
const FEATURE_LABELS: Record<string, string> = {
  chat: 'AI 对话',
  analyze_file: '文件分析',
  agent: 'Agent',
  report_analysis: '报告分析',
  tool: '工具调用',
};

interface UsagePanelProps {
  usage: UsageStats | null;
  /** 用量统计中 model_id（数据库 ID）→ 显示名 */
  modelNameMap: Map<string, string>;
  /** 当前选中厂商的模型 id 列表（用于按厂商过滤） */
  providerModelIds: string[];
  /** 当前选中厂商名（用于标题与空状态提示），null 表示未选择厂商 */
  providerName: string | null;
  onRefresh: () => void;
}

/** 用量统计面板：默认只显示当前选中厂商的用量，可切换查看全部模型 */
export function UsagePanel({ usage, modelNameMap, providerModelIds, providerName, onRefresh }: UsagePanelProps) {
  const [scope, setScope] = useState<'provider' | 'all'>('provider');
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const providerIdSet = useMemo(() => new Set(providerModelIds), [providerModelIds]);
  // 未选择厂商时没有可过滤目标，按「全部」处理
  const effectiveScope = providerName ? scope : 'all';

  const rows = useMemo(() => {
    const stats = usage?.stats ?? [];
    if (effectiveScope === 'all') return stats;
    return stats.filter((s) => providerIdSet.has(s.model_id));
  }, [usage, effectiveScope, providerIdSet]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-5 w-5" />
          用量统计（近 {usage?.days ?? 30} 天）
          {effectiveScope === 'provider' && providerName && (
            <Badge variant="secondary" className="font-normal">{providerName}</Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          {/* 视图切换：统计图 / 数据表格 */}
          <div className="flex items-center rounded-md border p-0.5 mr-1">
            <button
              type="button"
              onClick={() => setView('chart')}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                view === 'chart' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="统计图视图"
            >
              <BarChart3 className="h-3.5 w-3.5" />统计图
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                view === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="数据表格视图"
            >
              <TableIcon className="h-3.5 w-3.5" />表格
            </button>
          </div>
          {/* 范围切换：只看当前选中厂商 / 查看所有模型 */}
          <div className="flex items-center rounded-md border p-0.5 mr-1">
            <button
              type="button"
              onClick={() => setScope('provider')}
              disabled={!providerName}
              className={cn(
                'px-2.5 py-1 text-xs rounded-sm transition-colors',
                effectiveScope === 'provider'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
                !providerName && 'opacity-50 cursor-not-allowed'
              )}
              title={providerName ? `只显示「${providerName}」的用量` : '请先在左侧选择厂商'}
            >
              当前厂商
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={cn(
                'px-2.5 py-1 text-xs rounded-sm transition-colors',
                effectiveScope === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="显示所有模型的用量"
            >
              全部模型
            </button>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} title="刷新">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title={effectiveScope === 'provider' ? '该厂商暂无用量记录' : '暂无用量记录'}
            description={
              effectiveScope === 'provider'
                ? '可切换到「全部模型」查看其他厂商的用量'
                : '使用 AI 功能后会在此展示'
            }
          />
        ) : view === 'chart' ? (
          <UsageChart rows={rows} modelNameMap={modelNameMap} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>功能</TableHead>
                <TableHead className="text-right">调用次数</TableHead>
                <TableHead className="text-right">输入 Tokens</TableHead>
                <TableHead className="text-right">输出 Tokens</TableHead>
                <TableHead className="text-right">合计 Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s, i) => (
                <TableRow key={`${s.model_id}-${s.feature}-${i}`}>
                  <TableCell className="font-medium">
                    {modelNameMap.get(s.model_id) ?? s.model_id}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{FEATURE_LABELS[s.feature] ?? s.feature}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{s.calls.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{s.prompt_total.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{s.completion_total.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium">
                    {(s.prompt_total + s.completion_total).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
