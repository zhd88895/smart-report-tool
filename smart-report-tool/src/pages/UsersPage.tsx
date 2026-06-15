import { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useUsers } from '@/hooks/useUsers';
import { useUserStore } from '@/stores/userStore';
import { User } from '@/types';
import { formatDate } from '@/utils/formatters';
import { ROLE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/constants/roles';
import { toast } from 'sonner';

export default function UsersPage() {
  const { users, addUser, removeUser, refreshUsers } = useUsers();
  const userStore = useUserStore();
  const [activeTab, setActiveTab] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', role: 'member' as User['role'] });

  useEffect(() => {
    userStore.fetchPendingUsers();
  }, []);

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.displayName) {
      toast.error('请填写完整信息');
      return;
    }

    const user: User = {
      id: `user_${Date.now()}`,
      username: newUser.username,
      password: newUser.password,
      role: newUser.role,
      displayName: newUser.displayName,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    await addUser(user);
    setShowAddDialog(false);
    setNewUser({ username: '', password: '', displayName: '', role: 'member' });
    toast.success('用户创建成功');
    refreshUsers();
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await removeUser(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('用户已删除');
      refreshUsers();
    }
  };

  const handleApprove = async (userId: string) => {
    await userStore.approveUser(userId);
    toast.success('用户已批准');
    refreshUsers();
  };

  const handleReject = async (userId: string) => {
    await userStore.rejectUser(userId);
    toast.success('用户已拒绝');
    refreshUsers();
  };

  const handleRoleChange = async (userId: string, newRole: User['role']) => {
    await userStore.updateUserRole(userId, newRole);
    toast.success('角色已更新');
    refreshUsers();
  };

  const allColumns = [
    { key: 'username', header: '用户名' },
    { key: 'displayName', header: '显示名称' },
    {
      key: 'role',
      header: '角色',
      render: (item: User) => (
        <Select value={item.role} onValueChange={(v) => handleRoleChange(item.id, v as User['role'])}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
            <SelectItem value="senior">{ROLE_LABELS.senior}</SelectItem>
            <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (item: User) => (
        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[item.status]}`}>
          {STATUS_LABELS[item.status]}
        </span>
      ),
    },
    { key: 'createdAt', header: '创建时间', render: (item: User) => formatDate(item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      render: (item: User) => (
        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    },
  ];

  const pendingColumns = [
    { key: 'username', header: '用户名' },
    { key: 'displayName', header: '显示名称' },
    { key: 'createdAt', header: '申请时间', render: (item: User) => formatDate(item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      render: (item: User) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => handleApprove(item.id)}>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleReject(item.id)}>
            <XCircle className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">用户管理</h2>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          添加用户
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">全部用户</TabsTrigger>
          <TabsTrigger value="pending">
            待审核
            {userStore.pendingUsers.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
                {userStore.pendingUsers.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>用户列表</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable columns={allColumns} data={users} keyExtractor={(item) => item.id} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle>待审核用户</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable columns={pendingColumns} data={userStore.pendingUsers} keyExtractor={(item) => item.id} />
              {userStore.pendingUsers.length === 0 && (
                <div className="text-center text-muted-foreground py-8">暂无待审核用户</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>用户名</Label>
              <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>密码</Label>
              <Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>显示名称</Label>
              <Input value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as User['role'] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                  <SelectItem value="senior">{ROLE_LABELS.senior}</SelectItem>
                  <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>取消</Button>
            <Button onClick={handleAddUser}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="确认删除"
        description={`确定要删除用户「${deleteTarget?.displayName}」吗？`}
        onConfirm={handleDelete}
        destructive
      />
    </div>
  );
}
