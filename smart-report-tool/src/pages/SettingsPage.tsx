import { useState, useEffect } from 'react';
import { Save, Shield, Loader2, Lock, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { useUserStore } from '@/stores/userStore';
import { ROLE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/constants/roles';
import { ScriptRegion, User } from '@/types';
import { apiPost } from '@/services/api';
import { toast } from 'sonner';

const REGION_LIST: ScriptRegion[] = ['全部', '华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuthStore();
  const { updateProfile, removeUser, users } = useUserStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [region, setRegion] = useState<ScriptRegion>(user?.region || '全部');
  const [saving, setSaving] = useState(false);

  // 同步 region（当 user 从外部更新时）
  useEffect(() => {
    if (user?.region) setRegion(user.region);
  }, [user?.region]);

  // 密码修改
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  // 删除账户
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const adminCount = users.filter((u) => u.role === 'admin').length;

  const handleSave = async () => {
    setSaving(true);
    if (user) {
      const updates: Partial<User> = {};
      if (displayName !== user.displayName) updates.displayName = displayName;
      if (region !== (user.region || '全部')) updates.region = region as ScriptRegion;
      if (Object.keys(updates).length > 0) {
        const result = await updateProfile(user.id, { displayName: updates.displayName, region: updates.region });
        if (!result.success) { toast.error(result.error || '保存失败'); setSaving(false); return; }
        updateUser(updates);
      }
    }
    toast.success('设置已保存');
    setSaving(false);
  };

  const handleChangePassword = async () => {
    if (!currentPassword) { toast.error('请输入当前密码'); return; }
    if (!newPassword || newPassword.length < 6) { toast.error('新密码至少6位'); return; }
    if (newPassword !== confirmPassword) { toast.error('两次输入的新密码不一致'); return; }
    if (!user) return;

    setChangingPwd(true);
    try {
      await apiPost('/users/change-password', { userId: user.id, currentPassword, newPassword });
      toast.success('密码修改成功，下次登录请使用新密码');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      toast.error(e?.message || '密码修改失败');
    } finally {
      setChangingPwd(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || !deletePassword) { toast.error('请输入密码确认'); return; }
    if (user.role === 'admin' && adminCount <= 1) {
      toast.error('系统中至少需要保留一个管理员，不能删除自己');
      return;
    }
    setDeleting(true);
    try {
      // 先验证密码
      await apiPost('/users/login', { username: user.username, password: deletePassword });
      // 删除账户
      await removeUser(user.id);
      toast.success('账户已删除');
      logout();
      window.location.href = '/login';
    } catch (e: any) {
      toast.error(e?.message || '删除失败，请检查后端服务');
      setDeleting(false);
    }
  };

  const canDeleteSelf = !(user?.role === 'admin' && adminCount <= 1);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">个人设置</h2>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>查看和修改您的个人资料</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label>用户名</Label><Input value={user?.username || ''} disabled /></div>
          <div className="space-y-2"><Label>显示名称</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>角色</Label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-sm">
              <Shield className="h-4 w-4 text-primary" />{user?.role ? ROLE_LABELS[user.role] : '-'}
            </div>
          </div>
          <div className="space-y-2">
            <Label>账户状态</Label>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs ${user?.status ? STATUS_COLORS[user.status] : ''}`}>{user?.status ? STATUS_LABELS[user.status] : '-'}</span>
            </div>
          </div>
          {user?.role === 'admin' && (
            <div className="space-y-2">
              <Label>所属区域</Label>
              <Select value={region} onValueChange={(v) => setRegion(v as ScriptRegion)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGION_LIST.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">设置你的管辖区域，报告中同区域数据将优先展示</p>
            </div>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? '保存中...' : '保存设置'}
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" />修改密码</CardTitle>
          <CardDescription>输入当前密码并设置新密码</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label>当前密码</Label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>
          <div className="space-y-2"><Label>新密码</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少6位" /></div>
          <div className="space-y-2"><Label>确认新密码</Label><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
          <Button onClick={handleChangePassword} disabled={changingPwd}>
            {changingPwd ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
            {changingPwd ? '修改中...' : '修改密码'}
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-lg border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" />删除账户</CardTitle>
          <CardDescription>
            {canDeleteSelf
              ? '删除后将立即退出登录，此操作不可撤销'
              : '系统中至少需要保留一个管理员，无法删除自己'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => { setDeletePassword(''); setShowDeleteDialog(true); }} disabled={!canDeleteSelf}>
            <Trash2 className="mr-2 h-4 w-4" />删除我的账户
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2"><AlertTriangle className="h-5 w-5" />确认删除账户</DialogTitle>
            <DialogDescription>
              此操作将永久删除您的账户「{user?.displayName}」和所有关联数据。<br />
              请输入您的密码以确认：
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>密码确认</Label>
              <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="输入当前密码" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
