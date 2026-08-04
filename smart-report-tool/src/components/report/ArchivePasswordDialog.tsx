import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface ArchivePasswordDialogProps {
  open: boolean;
  fileName: string;
  onConfirm: (password: string) => void;
  onCancel: () => void;
  loading?: boolean;
  errorMessage?: string;
}

export function ArchivePasswordDialog({
  open,
  fileName,
  onConfirm,
  onCancel,
  loading = false,
  errorMessage,
}: ArchivePasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const handleConfirm = () => {
    if (!password.trim()) return;
    onConfirm(password.trim());
  };

  const handleCancel = () => {
    setPassword('');
    setShowPwd(false);
    onCancel();
  };

  // 每次打开时清空
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setPassword('');
      setShowPwd(false);
      onCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />压缩包需要密码
          </DialogTitle>
          <DialogDescription>
            文件 <span className="font-medium text-foreground">{fileName}</span> 已加密，请输入解压密码。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="archive-password">解压密码</Label>
            <div className="relative">
              <Input
                id="archive-password"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码..."
                autoFocus
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm();
                }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="text-xs text-destructive">{errorMessage}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消（跳过解压）
          </Button>
          <Button onClick={handleConfirm} disabled={!password.trim() || loading}>
            {loading ? '解压中...' : '确认解压'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
