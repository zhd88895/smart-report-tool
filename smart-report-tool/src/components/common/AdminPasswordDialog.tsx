/**
 * 管理员密码验证弹窗
 *
 * 敏感操作（编辑/删除用户、重置密码、创建用户等）在确认后触发，
 * 要求输入当前登录管理员本人的密码进行二次验证。
 */

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export interface AdminPasswordDialogProps {
  open: boolean;
  /** 操作描述，如「删除用户 张三」 */
  description?: string;
  /** 验证者身份提示，默认「您自己（当前管理员）」；普通用户场景可传「您自己」 */
  verifierLabel?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  /** 点击确认验证；密码错误时请保持弹窗打开（由调用方决定返回 void） */
  onConfirm: (password: string) => void;
}

export function AdminPasswordDialog({ open, description, verifierLabel = '您自己（当前管理员）', loading, onOpenChange, onConfirm }: AdminPasswordDialogProps) {
  const [pwd, setPwd] = useState('');

  // 每次打开清空上次输入
  useEffect(() => { if (open) setPwd(''); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />安全验证
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <p className="text-sm">请输入<strong>{verifierLabel}</strong>的登录密码以确认此操作：</p>
          <Input
            type="password"
            value={pwd}
            autoFocus
            placeholder="登录密码"
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pwd) onConfirm(pwd); }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!pwd || loading} onClick={() => onConfirm(pwd)}>
            {loading ? '验证中...' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
