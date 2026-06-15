import { useState } from 'react';
import { Save, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { ROLE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/constants/roles';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSave = () => {
    if (newPassword && newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    toast.success('设置已保存');
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">个人设置</h2>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>查看和修改您的个人资料</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>用户名</Label>
            <Input value={user?.username || ''} disabled />
          </div>
          <div className="space-y-2">
            <Label>显示名称</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-sm">
              <Shield className="h-4 w-4 text-primary" />
              {user?.role ? ROLE_LABELS[user.role] : '-'}
            </div>
          </div>
          <div className="space-y-2">
            <Label>账户状态</Label>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs ${user?.status ? STATUS_COLORS[user.status] : ''}`}>
                {user?.status ? STATUS_LABELS[user.status] : '-'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>更新您的登录密码</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>当前密码</Label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>新密码</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>确认新密码</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <Button onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            保存设置
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
