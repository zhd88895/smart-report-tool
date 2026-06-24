import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { getApiUrl, fetchWithAuth } from '@/services/api';

interface ScriptEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scriptId: string;
  fileName: string;
}

export function ScriptEditor({ open, onOpenChange, scriptId, fileName }: ScriptEditorProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && scriptId) {
      setContent('');
      setLoading(true);
      fetchWithAuth(getApiUrl(`/scripts/${scriptId}/content`))
        .then((r) => r.json())
        .then((res) => {
          if (res.code === 200 && res.data?.content !== undefined) {
            setContent(res.data.content);
          } else {
            toast.error(res.message || '获取脚本内容失败');
          }
        })
        .catch(() => toast.error('读取脚本内容失败'))
        .finally(() => setLoading(false));
    }
  }, [open, scriptId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(getApiUrl(`/scripts/${scriptId}/content`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('脚本已保存');
      onOpenChange(false);
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">脚本内容 — {fileName}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 py-2">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-sm h-[60vh] resize-none"
              placeholder="脚本内容为空"
              spellCheck={false}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? '保存中...' : '保存修改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
