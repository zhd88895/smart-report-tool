/**
 * 知识库文件选择器组件
 *
 * 在 AI 分析面板中使用，允许用户勾选知识库文件作为上下文
 *
 * @component KnowledgeFilePicker
 */

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Check, FileText, FileCode, Archive } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';

interface KBFile {
  id: string;
  title: string;
  file_name: string;
  file_ext: string;
  file_size: number;
  content_length: number;
  status: string;
  category_id?: string;
}

interface KnowledgeFilePickerProps {
  selectedIds: string[];
  selectedNames: string[];
  onChange: (ids: string[], names: string[]) => void;
}

function getFileIcon(ext: string) {
  switch (ext) {
    case '.md': case '.markdown': return <FileCode className="h-3.5 w-3.5 text-blue-500" />;
    case '.html': case '.htm': return <FileCode className="h-3.5 w-3.5 text-orange-500" />;
    case '.pdf': return <Archive className="h-3.5 w-3.5 text-red-500" />;
    case '.docx': case '.doc': return <FileText className="h-3.5 w-3.5 text-indigo-500" />;
    default: return <FileText className="h-3.5 w-3.5 text-gray-500" />;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function KnowledgeFilePicker({ selectedIds, selectedNames, onChange }: KnowledgeFilePickerProps) {
  const [files, setFiles] = useState<KBFile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/knowledge-base/files', { credentials: 'include' });
      const data = await res.json();
      if (data.code === 200) {
        setFiles((data.data || []).filter((f: KBFile) => f.status === 'ready'));
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const doSearch = async () => {
    if (!searchQuery.trim()) { loadFiles(); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/knowledge-base/files/search?q=${encodeURIComponent(searchQuery)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.code === 200) {
        setFiles((data.data || []).filter((f: KBFile) => f.status === 'ready'));
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const toggleFile = (file: KBFile) => {
    if (selectedIds.includes(file.id)) {
      const idx = selectedIds.indexOf(file.id);
      const newIds = [...selectedIds];
      const newNames = [...selectedNames];
      newIds.splice(idx, 1);
      newNames.splice(idx, 1);
      onChange(newIds, newNames);
    } else {
      onChange([...selectedIds, file.id], [...selectedNames, file.title]);
    }
  };

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
      <div className="flex gap-2">
        <Input
          placeholder="搜索知识库文件..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          className="h-7 text-xs"
        />
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={doSearch}>
          <Search className="h-3 w-3" />
        </Button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedNames.map((name, i) => (
            <Badge key={i} variant="secondary" className="text-xs gap-1">
              {name}
              <button
                className="ml-0.5 hover:text-destructive"
                onClick={() => {
                  const newIds = [...selectedIds];
                  const newNames = [...selectedNames];
                  newIds.splice(i, 1);
                  newNames.splice(i, 1);
                  onChange(newIds, newNames);
                }}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}

      <ScrollArea className="h-[200px]">
        <div className="p-1">
        {files.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            {loading ? <LoadingSpinner text="加载中..." className="py-2 text-xs" /> : '暂无可用文件，请先在知识库页面上传文件'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {files.map((file) => {
              const isSelected = selectedIds.includes(file.id);
              return (
                <button
                  key={file.id}
                  onClick={() => toggleFile(file)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                  )}
                >
                  <div className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border',
                    isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                  )}>
                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  {getFileIcon(file.file_ext)}
                  <span className="flex-1 text-left truncate">{file.title}</span>
                  <span className="text-muted-foreground">{formatSize(file.content_length)}</span>
                </button>
              );
            })}
          </div>
        )}
        </div>
      </ScrollArea>
    </div>
  );
}
