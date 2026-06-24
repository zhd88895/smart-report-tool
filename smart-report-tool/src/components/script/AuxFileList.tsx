import { useState, useEffect, useRef, useCallback } from 'react';
import { File } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AuxFile } from '@/types';

export function AuxFileList({ files }: { files: AuxFile[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const prev = el.style.maxHeight;
    el.style.maxHeight = 'none';
    const lineHeight = 22;
    setOverflows(el.scrollHeight > lineHeight + 6);
    el.style.maxHeight = prev;
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure, files]);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">辅助文件（{files.length} 个）：</p>
      <div className="flex items-start gap-2">
        <div
          ref={containerRef}
          className="flex-1 min-w-0 flex gap-1 flex-wrap"
          style={!expanded && overflows ? { maxHeight: 24, overflow: 'hidden' } : undefined}
        >
          {files.map((af, i) => (
            <Badge key={i} variant="outline" className="text-xs gap-1 whitespace-nowrap">
              <File className="h-3 w-3" />{af.name}
            </Badge>
          ))}
        </div>
        {overflows && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起' : '展开'}
          </Button>
        )}
      </div>
    </div>
  );
}
