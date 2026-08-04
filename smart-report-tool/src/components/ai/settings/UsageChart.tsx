import { useMemo } from 'react';
import type { UsageStatRow } from '@/services/aiConfigService';

interface ModelUsage {
  modelId: string;
  name: string;
  prompt: number;
  completion: number;
  calls: number;
  total: number;
}

interface UsageChartProps {
  rows: UsageStatRow[];
  /** 用量统计中 model_id（数据库 ID）→ 显示名 */
  modelNameMap: Map<string, string>;
}

/** 格式化大数字（如 12.3k） */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/**
 * 用量统计图：按模型聚合的横向堆叠条形图
 * 深蓝段 = 输入 Tokens，灰段 = 输出 Tokens，与整体商务配色一致
 */
export function UsageChart({ rows, modelNameMap }: UsageChartProps) {
  const { models, maxTotal, sumCalls, sumTokens } = useMemo(() => {
    const map = new Map<string, ModelUsage>();
    for (const r of rows) {
      const cur = map.get(r.model_id) ?? {
        modelId: r.model_id,
        name: modelNameMap.get(r.model_id) ?? r.model_id,
        prompt: 0,
        completion: 0,
        calls: 0,
        total: 0,
      };
      cur.prompt += r.prompt_total;
      cur.completion += r.completion_total;
      cur.calls += r.calls;
      cur.total += r.prompt_total + r.completion_total;
      map.set(r.model_id, cur);
    }
    const models = [...map.values()].sort((a, b) => b.total - a.total);
    return {
      models,
      maxTotal: Math.max(1, ...models.map((m) => m.total)),
      sumCalls: models.reduce((s, m) => s + m.calls, 0),
      sumTokens: models.reduce((s, m) => s + m.total, 0),
    };
  }, [rows, modelNameMap]);

  return (
    <div className="space-y-5 py-2">
      {/* 汇总 */}
      <div className="flex items-center gap-6 text-sm">
        <span className="text-muted-foreground">
          总调用 <span className="font-semibold text-foreground">{sumCalls.toLocaleString()}</span> 次
        </span>
        <span className="text-muted-foreground">
          合计 <span className="font-semibold text-foreground">{sumTokens.toLocaleString()}</span> Tokens
        </span>
        <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-700" />输入 Tokens
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" />输出 Tokens
          </span>
        </span>
      </div>

      {/* 条形图 */}
      <div className="space-y-4">
        {models.map((m) => {
          const promptPct = (m.prompt / maxTotal) * 100;
          const completionPct = (m.completion / maxTotal) * 100;
          return (
            <div key={m.modelId} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium truncate" title={m.name}>{m.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {m.calls.toLocaleString()} 次 · {m.total.toLocaleString()} Tokens
                </span>
              </div>
              <div className="flex h-4 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="bg-blue-700 transition-all"
                  style={{ width: `${promptPct}%` }}
                  title={`输入 ${m.prompt.toLocaleString()} Tokens`}
                />
                <div
                  className="bg-slate-400 transition-all"
                  style={{ width: `${completionPct}%` }}
                  title={`输出 ${m.completion.toLocaleString()} Tokens`}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>输入 {formatTokens(m.prompt)}</span>
                <span>输出 {formatTokens(m.completion)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
