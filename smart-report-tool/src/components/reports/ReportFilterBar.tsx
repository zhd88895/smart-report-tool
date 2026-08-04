import { useState } from 'react';
import { Search, X as XIcon, Check, Users, Calendar, MapPin, Tag, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { User } from '@/types';
import { LOG_CATEGORIES } from '@/constants/categories';
import { REGION_LIST } from '@/components/script/constants';

export interface ReportFilterBarProps {
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
  typeFilter: string;
  onTypeFilterChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  regionFilter: string;
  onRegionFilterChange: (v: string) => void;
  dateMode: string;
  onDateModeChange: (v: string) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  authorFilterIds: string[];
  onAuthorFilterIdsChange: (ids: string[]) => void;
  /** 用户列表，用于作者筛选弹窗 */
  users: User[];
  /** 是否存在任一激活筛选（控制「清除筛选」按钮可用态） */
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

/** 报告管理页筛选栏：搜索框 + 各筛选器 + 作者筛选弹窗 */
export function ReportFilterBar({
  searchQuery,
  onSearchQueryChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  regionFilter,
  onRegionFilterChange,
  dateMode,
  onDateModeChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  authorFilterIds,
  onAuthorFilterIdsChange,
  users,
  hasActiveFilters,
  onClearFilters,
}: ReportFilterBarProps) {
  const [showAuthorPicker, setShowAuthorPicker] = useState(false);
  const [authorSearch, setAuthorSearch] = useState('');
  const [authorRoleFilter, setAuthorRoleFilter] = useState<string>('all');
  const [authorRegionFilter, setAuthorRegionFilter] = useState<string>('all');

  const resetAuthorPickerFilters = () => {
    setAuthorSearch('');
    setAuthorRoleFilter('all');
    setAuthorRegionFilter('all');
  };

  return (
    <>
      <div className="space-y-3">
        {/* 行1：搜索框 + 清除筛选按钮 */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索报告名称..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-xs shrink-0"
            disabled={!hasActiveFilters}
            onClick={onClearFilters}
          >
            <XIcon className="h-3.5 w-3.5 mr-1" />清除筛选
          </Button>
        </div>

        {/* 行2：筛选器 */}
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={typeFilter} onValueChange={onTypeFilterChange}>
            <SelectTrigger className="w-auto h-9">
              <Tag className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {LOG_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
              {/* AI 分析扩展类别（支持包/其他），便于筛选 AI 生成报告 */}
              <SelectItem value="support">整机支持包</SelectItem>
              <SelectItem value="other">其他</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
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
          <Select value={regionFilter} onValueChange={onRegionFilterChange}>
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
            <Select value={dateMode} onValueChange={(v) => { onDateModeChange(v); if (v === 'all') { onDateFromChange(''); onDateToChange(''); } }}>
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
                <Input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} className="w-[140px] h-9 text-xs" />
                {dateMode === 'range' && (
                  <>
                    <span className="text-xs text-muted-foreground mx-0.5 shrink-0">至</span>
                    <Input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} className="w-[140px] h-9 text-xs" />
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
              <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => onAuthorFilterIdsChange([])}>
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ═════ 作者筛选弹窗 ═════ */}
      <Dialog open={showAuthorPicker} onOpenChange={(open) => { setShowAuthorPicker(open); if (!open) { resetAuthorPickerFilters(); } }}>
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
                            onAuthorFilterIdsChange(isSel
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
                <button className="text-xs text-primary hover:underline" onClick={() => onAuthorFilterIdsChange([])}>清空</button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setShowAuthorPicker(false); resetAuthorPickerFilters(); }}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
