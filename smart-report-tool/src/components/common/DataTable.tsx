import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/common/EmptyState';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowUpDown, Settings2 } from 'lucide-react';

/** 列最小像素宽度 */
const MIN_COL_WIDTH = 60;
/** 列默认像素宽度（列定义未给 width 时） */
const DEFAULT_COL_WIDTH = 150;

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
  sortable?: boolean;
  /** 内置排序取值器：返回 number 按数值比，返回 string 按中文 localeCompare 比 */
  sortValue?: (row: T) => string | number;
  /** 是否可在「列设置」中隐藏（默认 true；操作类列设 false） */
  hideable?: boolean;
  /** 弹性列：容器宽度变化时优先吸收多余/不足的宽度 */
  flex?: boolean;
  /** 列内容对齐方式（表头与单元格同时生效，默认 left） */
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey?: (row: T) => string;
  keyExtractor?: (row: T) => string;
  pageSize?: number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  /**
   * 表格唯一标识。传入后启用：列宽拖拽、窗口变化半自动调整、列显示/隐藏，
   * 全部状态持久化到 localStorage（key: `datatable:<tableId>`）。
   * 不传则行为与增强前完全一致。
   */
  tableId?: string;
}

interface PersistedTableState {
  widths: Record<string, number>;
  fixed: string[];
  hidden: string[];
}

/** 从列定义 width（如 '120px'）解析基础像素宽度，失败回退默认值 */
function baseWidth<T>(col: Column<T>): number {
  const px = col.width ? parseInt(col.width, 10) : NaN;
  return Number.isFinite(px) && px > 0 ? px : DEFAULT_COL_WIDTH;
}

/** 读取持久化状态，损坏数据回退默认 */
function loadPersisted(tableId: string): PersistedTableState {
  const empty: PersistedTableState = { widths: {}, fixed: [], hidden: [] };
  try {
    const raw = localStorage.getItem(`datatable:${tableId}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    const widths: Record<string, number> = {};
    if (parsed.widths && typeof parsed.widths === 'object') {
      for (const [k, v] of Object.entries(parsed.widths)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_COL_WIDTH) widths[k] = v;
      }
    }
    return {
      widths,
      fixed: Array.isArray(parsed.fixed) ? parsed.fixed.filter((x: unknown) => typeof x === 'string') : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return empty;
  }
}

export function DataTable<T>({ columns, data, rowKey, keyExtractor, pageSize = 10, sortKey, sortDir, onSortChange, tableId }: DataTableProps<T>) {
  const [page, setPage] = useState(1);
  const getKey = rowKey || keyExtractor || ((_row: T, index: number) => String(index));

  // ── 内置排序（外部未传 onSortChange 时生效） ──
  const [internalSort, setInternalSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const effectiveSortKey = onSortChange ? sortKey : internalSort?.key;
  const effectiveSortDir = onSortChange ? sortDir : internalSort?.dir;

  const handleSort = useCallback((key: string) => {
    if (onSortChange) {
      onSortChange(key);
    } else {
      setInternalSort((prev) =>
        prev?.key === key
          ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: 'asc' },
      );
    }
  }, [onSortChange]);

  const sortedData = useMemo(() => {
    if (onSortChange || !internalSort) return data;
    const col = columns.find((c) => c.key === internalSort.key);
    if (!col) return data;
    const getVal = col.sortValue ?? ((row: T) => (row as unknown as Record<string, string | number>)[col.key]);
    const arr = [...data];
    arr.sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'zh');
      }
      return internalSort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [data, columns, internalSort, onSortChange]);

  // ── tableId 增强能力：列宽 / 固定列 / 隐藏列 ──
  const containerRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, baseWidth(c)])),
  );
  const [fixedCols, setFixedCols] = useState<string[]>([]);
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);

  // tableId 变化（含挂载）时加载持久化状态
  useEffect(() => {
    if (!tableId) return;
    const p = loadPersisted(tableId);
    const keys = new Set(columns.map((c) => c.key));
    setFixedCols(p.fixed.filter((k) => keys.has(k)));
    setHiddenCols(p.hidden.filter((k) => keys.has(k)));
    const defaults = Object.fromEntries(columns.map((c) => [c.key, baseWidth(c)]));
    const validStored = Object.fromEntries(Object.entries(p.widths).filter(([k]) => k in defaults));
    setWidths({ ...defaults, ...validStored });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  // 状态持久化
  useEffect(() => {
    if (!tableId) return;
    try {
      localStorage.setItem(
        `datatable:${tableId}`,
        JSON.stringify({ widths, fixed: fixedCols, hidden: hiddenCols }),
      );
    } catch { /* 存储不可用时静默忽略 */ }
  }, [tableId, widths, fixedCols, hiddenCols]);

  // 供 ResizeObserver 回调读取最新状态（避免频繁重订阅）
  const stateRef = useRef({ columns, fixedCols, hiddenCols, widths });
  stateRef.current = { columns, fixedCols, hiddenCols, widths };

  // 窗口/容器尺寸变化时，重算未固定列宽
  useEffect(() => {
    if (!tableId) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const containerWidth = entries[0]?.contentRect.width ?? 0;
      if (containerWidth <= 0) return;
      const { columns: cols, fixedCols: fixed, hiddenCols: hidden, widths: cur } = stateRef.current;
      const visible = cols.filter((c) => !hidden.includes(c.key));
      const free = visible.filter((c) => !fixed.includes(c.key));
      if (free.length === 0) return;
      const fixedTotal = visible
        .filter((c) => fixed.includes(c.key))
        .reduce((s, c) => s + (cur[c.key] ?? baseWidth(c)), 0);
      const remaining = Math.max(0, containerWidth - fixedTotal);
      const next: Record<string, number> = { ...cur };
      const flexCols = free.filter((c) => c.flex);
      if (flexCols.length > 0) {
        // 非 flex 自由列保持基础宽，flex 列按基础宽比例吸收剩余空间
        const nonFlex = free.filter((c) => !c.flex);
        for (const c of nonFlex) next[c.key] = baseWidth(c);
        const nonFlexTotal = nonFlex.reduce((s, c) => s + baseWidth(c), 0);
        const flexBase = flexCols.reduce((s, c) => s + baseWidth(c), 0);
        const flexSpace = Math.max(flexCols.length * MIN_COL_WIDTH, remaining - nonFlexTotal);
        for (const c of flexCols) {
          next[c.key] = Math.max(MIN_COL_WIDTH, Math.round((flexSpace * baseWidth(c)) / flexBase));
        }
      } else {
        // 无 flex 列：所有未固定列按基础宽等比缩放
        const freeBase = free.reduce((s, c) => s + baseWidth(c), 0);
        for (const c of free) {
          next[c.key] = Math.max(MIN_COL_WIDTH, Math.round((remaining * baseWidth(c)) / freeBase));
        }
      }
      setWidths(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tableId]);

  /** 表头右缘拖拽手柄：全局 mousemove/mouseup 跟踪，拖过的列标记为固定 */
  const startResize = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    // 立即标记为固定，避免拖拽期间被自动重算覆盖
    setFixedCols((prev) => (prev.includes(key) ? prev : [...prev, key]));
    const startX = e.clientX;
    const startW = stateRef.current.widths[key] ?? DEFAULT_COL_WIDTH;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const nw = Math.max(MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX));
      setWidths((prev) => ({ ...prev, [key]: nw }));
    };
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const toggleHidden = useCallback((key: string, visible: boolean) => {
    setHiddenCols((prev) =>
      visible ? prev.filter((k) => k !== key) : prev.includes(key) ? prev : [...prev, key],
    );
  }, []);

  const visibleColumns = useMemo(
    () => (tableId ? columns.filter((c) => !hiddenCols.includes(c.key)) : columns),
    [tableId, columns, hiddenCols],
  );
  const totalWidth = visibleColumns.reduce((s, c) => s + (widths[c.key] ?? baseWidth(c)), 0);

  // ── 分页 ──
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const start = (page - 1) * pageSize;
  const pageData = sortedData.slice(start, start + pageSize);

  return (
    <div className="space-y-4">
      {tableId && (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-1" />列设置
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {columns.filter((c) => c.hideable !== false).map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={!hiddenCols.includes(c.key)}
                  onCheckedChange={(checked) => toggleHidden(c.key, !!checked)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="rounded-md border overflow-x-auto" ref={containerRef}>
        <Table style={tableId ? { tableLayout: 'fixed', width: totalWidth, minWidth: '100%' } : undefined}>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.key}
                  style={tableId ? { width: widths[col.key] ?? baseWidth(col) } : { width: col.width }}
                  className={tableId
                    ? `relative group border-r border-border last:border-r-0 ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`
                    : undefined}
                >
                  {col.sortable ? (
                    <button
                      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${col.align === 'center' ? 'justify-center w-full' : col.align === 'right' ? 'justify-end w-full' : ''}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                      {effectiveSortKey === col.key ? (
                        effectiveSortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                  {tableId && (
                    <span
                      onMouseDown={(e) => startResize(e, col.key)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none opacity-0 group-hover:opacity-100 hover:bg-primary/30 transition-opacity"
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageData.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumns.length}>
                  <EmptyState />
                </TableCell>
              </TableRow>
            )}
            {pageData.map((row, index) => (
              <TableRow key={getKey(row, index)}>
                {visibleColumns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={`${tableId ? 'border-r border-border/60 last:border-r-0' : ''} ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`.trim() || undefined}
                  >
                    {col.render ? col.render(row) : (row as unknown as Record<string, React.ReactNode>)[col.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
