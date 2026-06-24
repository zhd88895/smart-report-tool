import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { ROUTES } from '@/constants/routes';
import { toast } from 'sonner';

const REGION_LIST = ['华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [region, setRegion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const register = useAuthStore((state) => state.register);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (username.length < 3 || username.length > 20) {
      toast.error('用户名需在 3-20 个字符之间');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }
    if (!region) {
      toast.error('请选择所属区域');
      return;
    }

    setIsLoading(true);
    const result = await register(username, password, displayName, region);
    setIsLoading(false);

    if (result.success) {
      toast.success('注册成功，请等待管理员审核');
      navigate(ROUTES.LOGIN);
    } else {
      toast.error(result.error || '注册失败');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">用户注册</CardTitle>
          <CardDescription>注册后需等待管理员审核方可登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reg-username">用户名</Label>
              <Input
                id="reg-username"
                placeholder="3-20 个字符"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-displayName">显示名称</Label>
              <Input
                id="reg-displayName"
                placeholder="您的显示名称"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-region">所属区域 <span className="text-destructive">*</span></Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger id="reg-region"><SelectValue placeholder="请选择区域" /></SelectTrigger>
                <SelectContent>
                  {REGION_LIST.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-password">密码</Label>
              <Input
                id="reg-password"
                type="password"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-confirm">确认密码</Label>
              <Input
                id="reg-confirm"
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              <UserPlus className="mr-2 h-4 w-4" />
              {isLoading ? '注册中...' : '注册'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            已有账号？{' '}
            <Link to={ROUTES.LOGIN} className="text-primary hover:underline">
              直接登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
