import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ScrollText, FileJson, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import {
  fetchCallLogs, fetchCallLogDetail,
  type CallLogRecord, type CallLogDetail,
} from '@/services/aiConfigService';

/** 功能标签 */
const FEATURE_LABELS: Record<string, string> = {
  chat: 'AI 对话',
  analyze_file: '文件分析',
  agent: 'Agent',
  report_analysis: '报告分析',
  tool: '工具调用',
};

/** 报告消耗 tab 关注的功能 */
const REPORT_FEATURES = ['report_analysis', 'analyze_file'];

const PAGE_SIZE = 100;

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
};

const formatLatency = (ms: number | null) => {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/** 状态徽标 */
function StatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'success') return <Badge variant="secondary" className="text-emerald-600">成功</Badge>;
  if (status === 'canceled') return <Badge variant="secondary" className="text-amber-600">已取消</Badge>;
  return (
    <Badge variant="destructive" title={error ?? undefined}>
      失败
    </Badge>
  );
}

interface CallLogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** model_id（数据库 ID）→ 显示名 */
  modelNameMap: Map<string, string>;
}

/**
 * AI 调用记录弹窗：
 * - 「调用记录」：全量调用逐条记录（含失败/取消），支持功能筛选，可查看每次提交的请求体快照
 * - 「报告消耗」：报告分析/文件分析的 token 消耗逐条记录与汇总，便于对比
 */
export function CallLogsDialog({ open, onOpenChange, modelNameMap }: CallLogsDialogProps) {
  const [tab, setTab] = useState<'logs' | 'report'>('logs');

  // ── 调用记录 tab ──
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [logs, setLogs] = useState<CallLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── 报告消耗 tab ──
  const [reportLogs, setReportLogs] = useState<CallLogRecord[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // ── 请求体详情 ──
  const [detail, setDetail] = useState<CallLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const modelName = useCallback(
    (id: string) => modelNameMap.get(id) ?? id,
    [modelNameMap]
  );

  const loadLogs = useCallback(async (offset = 0, append = false) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const result = await fetchCallLogs({
        feature: featureFilter === 'all' ? undefined : featureFilter,
        limit: PAGE_SIZE,
        offset,
      });
      setTotal(result.total);
      setLogs((prev) => (append ? [...prev, ...result.rows] : result.rows));
    } catch (err: any) {
      toast.error(err.message || '获取调用记录失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [featureFilter]);

  const loadReportLogs = useCallback(async () => {
    setReportLoading(true);
    try {
      const groups = await Promise.all(
        REPORT_FEATURES.map((f) => fetchCallLogs({ feature: f, limit: 200 }))
      );
      const merged = groups
        .flatMap((g) => g.rows)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      setReportLogs(merged);
    } catch (err: any) {
      toast.error(err.message || '获取报告消耗记录失败');
    } finally {
      setReportLoading(false);
    }
  }, []);

  // 打开弹窗时按当前 tab 加载数据
  useEffect(() => {
    if (!open) return;
    if (tab === 'logs') loadLogs();
    else loadReportLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, featureFilter]);

  /** 打开请求体详情 */
  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchCallLogDetail(id));
    } catch (err: any) {
      toast.error(err.message || '获取请求体详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  /** 报告消耗汇总 */
  const reportSummary = useMemo(() => {
    const success = reportLogs.filter((l) => l.status === 'success');
    const prompt = success.reduce((s, l) => s + l.prompt_tokens, 0);
    const completion = success.reduce((s, l) => s + l.completion_tokens, 0);
    const byModel = new Map<string, { calls: number; tokens: number }>();
    for (const l of success) {
      const name = modelName(l.model_id);
      const cur = byModel.get(name) ?? { calls: 0, tokens: 0 };
      cur.calls += 1;
      cur.tokens += l.prompt_tokens + l.completion_tokens;
      byModel.set(name, cur);
    }
    return { calls: success.length, prompt, completion, byModel };
  }, [reportLogs, modelName]);

  /** 请求体摘要解析 */
  const detailSummary = useMemo(() => {
    if (!detail?.request_summary) return null;
    try {
      return JSON.parse(detail.request_summary) as {
        model: string;
        messageCount: number;
        totalChars: number;
        messages: Array<{ role: string; chars: number }>;
        toolsCount: number;
        temperature: number;
        maxOutputTokens?: number;
        stream: boolean;
      };
    } catch {
      return null;
    }
  }, [detail]);

  /** 请求体 JSON 美化（失败则原样展示） */
  const detailBodyPretty = useMemo(() => {
    if (!detail?.request_body) return '';
    const truncated = detail.request_body.includes('...[已截断');
    const jsonPart = truncated
      ? detail.request_body.slice(0, detail.request_body.indexOf('\n...[已截断'))
      : detail.request_body;
    try {
      const pretty = JSON.stringify(JSON.parse(jsonPart), null, 2);
      return truncated
        ? pretty + detail.request_body.slice(detail.request_body.indexOf('\n...[已截断'))
        : pretty;
    } catch {
      return detail.request_body;
    }
  }, [detail]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5" />
              AI 调用记录
            </DialogTitle>
            <DialogDescription>
              查看每次 AI 调用的请求体结构与 token 消耗，可用于排查异常提交
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'logs' | 'report')} className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-fit">
              <TabsTrigger value="logs">调用记录</TabsTrigger>
              <TabsTrigger value="report">报告消耗</TabsTrigger>
            </TabsList>

            {/* ══ 调用记录 ══ */}
            <TabsContent value="logs" className="flex-1 flex flex-col min-h-0 mt-3">
              <div className="flex items-center gap-2 mb-3">
                <Select value={featureFilter} onValueChange={setFeatureFilter}>
                  <SelectTrigger className="w-40 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部功能</SelectItem>
                    {Object.entries(FEATURE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">共 {total} 条</span>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => loadLogs()} title="刷新">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center py-12"><LoadingSpinner /></div>
              ) : logs.length === 0 ? (
                <EmptyState title="暂无调用记录" description="使用 AI 功能后会在此展示每次调用的详情" />
              ) : (
                <>
                  <div className="flex-1 min-h-0 overflow-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-40">时间</TableHead>
                          <TableHead>功能</TableHead>
                          <TableHead>模型</TableHead>
                          <TableHead className="text-right">输入</TableHead>
                          <TableHead className="text-right">输出</TableHead>
                          <TableHead className="text-right">耗时</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="w-20 text-center">请求体</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logs.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-xs text-muted-foreground">{formatTime(l.created_at)}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{FEATURE_LABELS[l.feature] ?? l.feature}</Badge>
                            </TableCell>
                            <TableCell className="max-w-40 truncate" title={modelName(l.model_id)}>
                              {modelName(l.model_id)}
                            </TableCell>
                            <TableCell className="text-right">{l.prompt_tokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{l.completion_tokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{formatLatency(l.latency_ms)}</TableCell>
                            <TableCell>
                              <StatusBadge status={l.status} error={l.error} />
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => openDetail(l.id)}
                                disabled={detailLoading}
                                title="查看请求体"
                              >
                                <FileJson className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {logs.length < total && (
                    <div className="flex justify-center mt-2">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => loadLogs(logs.length, true)}
                        disabled={loadingMore}
                      >
                        {loadingMore && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                        加载更多（已显示 {logs.length}/{total}）
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* ══ 报告消耗 ══ */}
            <TabsContent value="report" className="flex-1 flex flex-col min-h-0 mt-3">
              {/* 汇总条 */}
              <div className="flex items-center gap-4 flex-wrap mb-3 text-sm">
                <span>
                  成功调用 <span className="font-semibold">{reportSummary.calls}</span> 次
                </span>
                <span>
                  总输入 <span className="font-semibold">{reportSummary.prompt.toLocaleString()}</span> tokens
                </span>
                <span>
                  总输出 <span className="font-semibold">{reportSummary.completion.toLocaleString()}</span> tokens
                </span>
                <span className="text-muted-foreground">
                  {Array.from(reportSummary.byModel.entries())
                    .map(([name, s]) => `${name}: ${s.calls} 次 / ${s.tokens.toLocaleString()} tokens`)
                    .join('　|　')}
                </span>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadReportLogs} title="刷新">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {reportLoading ? (
                <div className="flex-1 flex items-center justify-center py-12"><LoadingSpinner /></div>
              ) : reportLogs.length === 0 ? (
                <EmptyState title="暂无报告消耗记录" description="使用 AI 智能分析或报告分析功能后会在此展示" />
              ) : (
                <div className="flex-1 min-h-0 overflow-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">时间</TableHead>
                        <TableHead>功能</TableHead>
                        <TableHead>模型</TableHead>
                        <TableHead className="text-right">输入 Tokens</TableHead>
                        <TableHead className="text-right">输出 Tokens</TableHead>
                        <TableHead className="text-right">合计</TableHead>
                        <TableHead className="text-right">耗时</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="w-20 text-center">请求体</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportLogs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs text-muted-foreground">{formatTime(l.created_at)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{FEATURE_LABELS[l.feature] ?? l.feature}</Badge>
                          </TableCell>
                          <TableCell className="max-w-40 truncate" title={modelName(l.model_id)}>
                            {modelName(l.model_id)}
                          </TableCell>
                          <TableCell className="text-right">{l.prompt_tokens.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{l.completion_tokens.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">
                            {(l.prompt_tokens + l.completion_tokens).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">{formatLatency(l.latency_ms)}</TableCell>
                          <TableCell>
                            <StatusBadge status={l.status} error={l.error} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => openDetail(l.id)}
                              disabled={detailLoading}
                              title="查看请求体"
                            >
                              <FileJson className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ══ 请求体详情弹窗 ══ */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              请求体详情
              {detail && (
                <StatusBadge status={detail.status} error={detail.error} />
              )}
            </DialogTitle>
            {detail && (
              <DialogDescription>
                {formatTime(detail.created_at)} · {FEATURE_LABELS[detail.feature] ?? detail.feature} · {modelName(detail.model_id)}
                {detail.error && <span className="block text-destructive mt-1">错误：{detail.error}</span>}
              </DialogDescription>
            )}
          </DialogHeader>

          {detail && (
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              {/* 结构摘要 */}
              {detailSummary && (
                <div className="rounded-md border p-3 text-sm space-y-1.5 bg-muted/30">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>上游模型：<span className="font-medium">{detailSummary.model}</span></span>
                    <span>消息数：<span className="font-medium">{detailSummary.messageCount}</span></span>
                    <span>总字符：<span className="font-medium">{detailSummary.totalChars.toLocaleString()}</span></span>
                    <span>工具数：<span className="font-medium">{detailSummary.toolsCount}</span></span>
                    <span>temperature：<span className="font-medium">{detailSummary.temperature}</span></span>
                    {detailSummary.maxOutputTokens != null && (
                      <span>最大输出：<span className="font-medium">{detailSummary.maxOutputTokens.toLocaleString()}</span></span>
                    )}
                    <span>流式：<span className="font-medium">{detailSummary.stream ? '是' : '否'}</span></span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    消息结构：
                    {detailSummary.messages.map((m, i) => (
                      <span key={i} className="inline-block mr-2">
                        [{i}] {m.role} ({m.chars.toLocaleString()} 字符)
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* 完整请求体 */}
              <div className="flex-1 min-h-0 overflow-auto border rounded-md">
                <pre className="p-3 text-xs leading-relaxed whitespace-pre-wrap break-all font-mono">
                  {detailBodyPretty || '（无请求体快照，该记录可能产生于旧版本）'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
