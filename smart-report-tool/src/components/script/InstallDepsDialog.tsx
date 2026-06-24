import { Loader2, Check, AlertCircle, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export interface InstallDepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installStatus: 'idle' | 'installing' | 'done' | 'failed';
  installLogs: string[];
}

export function InstallDepsDialog({ open, onOpenChange, installStatus, installLogs }: InstallDepsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onOpenChange(false); }}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />依赖安装
            {installStatus === 'installing' && <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />安装中</Badge>}
            {installStatus === 'done' && <Badge className="bg-green-100 text-green-700"><Check className="h-3 w-3 mr-1" />完成</Badge>}
            {installStatus === 'failed' && <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />失败</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto bg-black text-green-400 font-mono text-xs p-4 rounded-md">
          {installLogs.length === 0 && installStatus === 'installing' && (
            <div className="text-muted-foreground">正在连接...</div>
          )}
          {installLogs.length === 0 && installStatus === 'idle' && (
            <div className="text-muted-foreground">准备中...</div>
          )}
          {installLogs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
