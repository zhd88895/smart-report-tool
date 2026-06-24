import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, CheckCircle, XCircle, Pencil, KeyRound, Search, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useUsers } from '@/hooks/useUsers';
import { useAuthStore } from '@/stores/authStore';
import { User, ScriptRegion } from '@/types';
import { formatDate } from '@/utils/formatters';
import { ROLE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/constants/roles';
import { toast } from 'sonner';

export default function UsersPage() {
  const { users, pendingUsers, addUser, removeUser, approveUser, rejectUser, updateUserRole, updateProfile, resetPassword, refreshUsers } = useUsers();
  const { user: currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteConfirm2, setDeleteConfirm2] = useState(false); // 二次确认
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [pwdTarget, setPwdTarget] = useState<User | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', role: 'member' as User['role'], region: '华南区' });
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');

  const REGION_LIST: ScriptRegion[] = ['全部', '华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];

  useEffect(() => { refreshUsers(); }, []);

  const adminCount = users.filter((u) => u.role === 'admin').length;

  const ROLE_WEIGHT: Record<string, number> = { admin: 0, senior: 1, member: 2 };

  const filteredUsers = useMemo(() => {
    let result = users.filter((u) => {
      const matchSearch = !userSearch ||
        u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.displayName || '').toLowerCase().includes(userSearch.toLowerCase());
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchStatus = statusFilter === 'all' || u.status === statusFilter;
      const matchRegion = regionFilter === 'all' || (u.region || '全部') === regionFilter;
      return matchSearch && matchRole && matchStatus && matchRegion;
    });
    // 排序：管理员 > 高级成员 > 普通成员，同角色按创建时间倒序
    result.sort((a, b) => {
      const w = (ROLE_WEIGHT[a.role] ?? 9) - (ROLE_WEIGHT[b.role] ?? 9);
      if (w !== 0) return w;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return result;
  }, [users, userSearch, roleFilter, statusFilter, regionFilter]);

  // ── 删除逻辑 ──
  const canDelete = (target: User): string | null => {
    if (!currentUser) return null;
    // 不能删其他管理员
    if (target.role === 'admin' && target.id !== currentUser.id) {
      return '不能删除其他管理员账号';
    }
    // 最后一个管理员不能自删
    if (target.id === currentUser.id && target.role === 'admin' && adminCount <= 1) {
      return '系统中至少需要保留一个管理员，不能删除自己';
    }
    return null;
  };

  const handleDeleteClick = (target: User) => {
    const reason = canDelete(target);
    if (reason) { toast.error(reason); return; }
    // 自删需要二次确认
    if (target.id === currentUser?.id) {
      setDeleteTarget(target);
      setDeleteConfirm2(false);
    } else {
      setDeleteTarget(target);
      setDeleteConfirm2(true); // 非自删直接可删
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setDeleteConfirm2(false);
    await removeUser(target.id);
    toast.success('用户已删除');
    refreshUsers();
    // 如果删的是自己，退出登录
    if (target.id === currentUser?.id) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
  };

  const getDeleteDescription = () => {
    if (!deleteTarget) return '';
    if (deleteTarget.id === currentUser?.id) {
      return `⚠️ 您正在删除自己的账户「${deleteTarget.displayName}」。删除后将立即退出登录。此操作不可撤销，是否继续？`;
    }
    return `确定要删除用户「${deleteTarget.displayName}」吗？`;
  };

  // ── 编辑逻辑 ──
  const openEdit = (target: User) => {
    setEditTarget(target);
    setEditDisplayName(target.displayName || '');
    setEditRegion(target.region || '全部');
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    const updates: { displayName?: string; region?: string } = {};
    if (editDisplayName !== editTarget.displayName) updates.displayName = editDisplayName;
    if (editRegion !== (editTarget.region || '全部')) updates.region = editRegion;
    if (Object.keys(updates).length > 0) {
      const res = await updateProfile(editTarget.id, updates);
      if (!res.success) { toast.error(res.error || '保存失败'); return; }
      toast.success('修改已保存');
      refreshUsers();
    }
    setEditTarget(null);
  };

  const handleResetPassword = async () => {
    if (!pwdTarget || !resetPwd.trim()) { toast.error('请输入新密码'); return; }
    if (resetPwd.length < 6) { toast.error('密码至少6位'); return; }
    const res = await resetPassword(pwdTarget.id, resetPwd.trim());
    if (!res.success) { toast.error(res.error || '密码重置失败'); return; }
    toast.success(`已重置 ${pwdTarget.displayName} 的密码`);
    setPwdTarget(null);
    setResetPwd('');
  };

  // ── 其他 ──
  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.displayName) {
      toast.error('请填写完整信息');
      return;
    }
    const result = await addUser(newUser);
    if (!result.success) { toast.error(result.error || '创建失败'); return; }
    setShowAddDialog(false);
    setNewUser({ username: '', password: '', displayName: '', role: 'member', region: '华南区' });
    toast.success('用户创建成功');
    refreshUsers();
  };

  const handleApprove = async (userId: string) => { await approveUser(userId); toast.success('用户已批准'); refreshUsers(); };
  const handleReject = async (userId: string) => { await rejectUser(userId); toast.success('用户已拒绝'); refreshUsers(); };
  const handleRoleChange = async (userId: string, newRole: User['role']) => { await updateUserRole(userId, newRole); toast.success('角色已更新'); refreshUsers(); };

  const allColumns = [
    { key: 'username', header: '用户名' },
    { key: 'displayName', header: '显示名称' },
    {
      key: 'role',
      header: '角色',
      render: (item: User) => (
        <Select value={item.role} onValueChange={(v) => handleRoleChange(item.id, v as User['role'])}>
          <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
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
        item.id === currentUser?.id ? (
          <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary font-medium">当前用户</span>
        ) : (
          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[item.status]}`}>{STATUS_LABELS[item.status]}</span>
        )
      ),
    },
    { key: 'region', header: '区域', render: (item: User) => <span className="text-sm">{item.region || '全部'}</span> },
    { key: 'createdAt', header: '创建时间', render: (item: User) => formatDate(item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      render: (item: User) => (
        item.id === currentUser?.id ? null : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" title="编辑用户" onClick={() => openEdit(item)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" title="重置密码" onClick={() => { setPwdTarget(item); setResetPwd(''); }}>
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" title="删除用户" onClick={() => handleDeleteClick(item)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )
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
          <Plus className="mr-2 h-4 w-4" />添加用户
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">全部用户</TabsTrigger>
          <TabsTrigger value="pending">
            待审核{pendingUsers.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">{pendingUsers.length}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <Card>
            <CardHeader><CardTitle>用户列表</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* 搜索 + 筛选 */}
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="搜索用户名或显示名称..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 text-xs shrink-0"
                    disabled={!userSearch && roleFilter === 'all' && statusFilter === 'all' && regionFilter === 'all'}
                    onClick={() => { setUserSearch(''); setRoleFilter('all'); setStatusFilter('all'); setRegionFilter('all'); }}
                  >
                    <XIcon className="h-3.5 w-3.5 mr-1" />清除筛选
                  </Button>
                </div>
                <div className="flex gap-3 flex-wrap items-center">
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[130px] h-9">
                      <SelectValue placeholder="全部角色" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部角色</SelectItem>
                      <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                      <SelectItem value="senior">{ROLE_LABELS.senior}</SelectItem>
                      <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[130px] h-9">
                      <SelectValue placeholder="全部状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="active">已激活</SelectItem>
                      <SelectItem value="pending">待审核</SelectItem>
                      <SelectItem value="rejected">已拒绝</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger className="w-[130px] h-9">
                      <SelectValue placeholder="全部区域" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部区域</SelectItem>
                      {REGION_LIST.filter((r) => r !== '全部').map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DataTable columns={allColumns} data={filteredUsers} keyExtractor={(item) => item.id} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="pending">
          <Card>
            <CardHeader><CardTitle>待审核用户</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={pendingColumns} data={pendingUsers} keyExtractor={(item) => item.id} />
              {pendingUsers.length === 0 && <div className="text-center text-muted-foreground py-8">暂无待审核用户</div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 添加用户 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加用户</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>用户名</Label><Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} /></div>
            <div className="space-y-2"><Label>密码</Label><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></div>
            <div className="space-y-2"><Label>显示名称</Label><Input value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} /></div>
            <div className="space-y-2"><Label>角色</Label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as User['role'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                  <SelectItem value="senior">{ROLE_LABELS.senior}</SelectItem>
                  <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>区域</Label>
              <Select value={newUser.region} onValueChange={(v) => setNewUser({ ...newUser, region: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGION_LIST.map((r) => (
                    <SelectItem key={r} value={r} disabled={r === '全部'}>{r}</SelectItem>
                  ))}
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

      {/* 编辑用户 */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑用户 - {editTarget?.username}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>显示名称</Label>
              <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>区域</Label>
              <Select value={editRegion} onValueChange={setEditRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGION_LIST.map((r) => (
                    <SelectItem key={r} value={r} disabled={r === '全部' && editTarget?.role !== 'admin' && currentUser?.role !== 'admin'}>
                      {r}{r === '全部' && editTarget?.role !== 'admin' ? ' (仅管理员)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
            <Button onClick={handleEditSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码 */}
      <Dialog open={!!pwdTarget} onOpenChange={() => { setPwdTarget(null); setResetPwd(''); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>重置密码 - {pwdTarget?.displayName}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>新密码</Label>
              <Input type="text" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} placeholder="至少6位" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwdTarget(null); setResetPwd(''); }}>取消</Button>
            <Button onClick={handleResetPassword}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认（支持二次确认） */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => { setDeleteTarget(null); setDeleteConfirm2(false); }}
        title={deleteTarget?.id === currentUser?.id ? '⚠️ 删除自己的账户' : '确认删除'}
        description={getDeleteDescription()}
        onConfirm={deleteConfirm2 ? confirmDelete : () => setDeleteConfirm2(true)}
        destructive
        confirmText={deleteConfirm2 ? '确认删除' : '继续'}
      />
    </div>
  );
}
