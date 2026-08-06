import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, CheckCircle, XCircle, Pencil, KeyRound, Search, X as XIcon, Users as UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/common/DataTable';
import { AdminPasswordDialog } from '@/components/common/AdminPasswordDialog';
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
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [editRole, setEditRole] = useState<User['role']>('member');
  const [pwdTarget, setPwdTarget] = useState<User | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', role: 'member' as User['role'], region: '华南区' });

  // ── 管理员密码二次验证（敏感操作确认后才弹出） ──
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyDesc, setVerifyDesc] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  /** 待执行的敏感操作：返回 true 表示成功（关闭验证弹窗），false 保持弹窗供重试 */
  const pendingActionRef = useRef<((adminPassword: string) => Promise<boolean>) | null>(null);

  const requireAdminPassword = (description: string, action: (adminPassword: string) => Promise<boolean>) => {
    setVerifyDesc(description);
    pendingActionRef.current = action;
    setVerifyOpen(true);
  };

  const handleVerifyConfirm = async (pwd: string) => {
    if (!pendingActionRef.current) return;
    setVerifyLoading(true);
    try {
      const ok = await pendingActionRef.current(pwd);
      if (ok) {
        setVerifyOpen(false);
        pendingActionRef.current = null;
      }
    } finally {
      setVerifyLoading(false);
    }
  };
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');

  const REGION_LIST: ScriptRegion[] = ['全部', '华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];

  useEffect(() => { refreshUsers(); }, []);

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

  // ── 删除逻辑（后端强制：删除他人需验证当前管理员密码，管理员账户不可删除） ──
  const handleDeleteClick = (target: User) => {
    if (target.role === 'admin') { toast.error('不能删除管理员账户'); return; }
    setDeleteTarget(target);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    requireAdminPassword(`即将删除用户「${target.displayName}」（${target.username}），此操作不可撤销。`, async (pwd) => {
      const res = await removeUser(target.id, pwd);
      if (!res.success) { toast.error(res.error || '删除失败'); return false; }
      toast.success('用户已删除');
      refreshUsers();
      return true;
    });
  };

  // ── 编辑逻辑 ──
  const openEdit = (target: User) => {
    setEditTarget(target);
    setEditDisplayName(target.displayName || '');
    setEditRegion(target.region || '全部');
    setEditRole(target.role);
  };

  const handleEditSave = () => {
    if (!editTarget) return;
    const target = editTarget;
    const roleChanged = editRole !== target.role;
    const updates: { displayName?: string; region?: string } = {};
    if (editDisplayName !== target.displayName) updates.displayName = editDisplayName;
    if (editRegion !== (target.region || '全部')) updates.region = editRegion;

    if (!roleChanged && Object.keys(updates).length === 0) {
      toast.info('没有需要保存的修改');
      setEditTarget(null);
      return;
    }

    setEditTarget(null);
    requireAdminPassword(`即将保存对用户「${target.displayName}」的修改。`, async (pwd) => {
      // 角色变更走独立的敏感操作接口
      if (roleChanged) {
        const roleRes = await updateUserRole(target.id, editRole, pwd);
        if (!roleRes.success) { toast.error(roleRes.error || '角色修改失败'); return false; }
      }
      if (Object.keys(updates).length > 0) {
        const res = await updateProfile(target.id, { ...updates, adminPassword: pwd });
        if (!res.success) { toast.error(res.error || '保存失败'); return false; }
      }
      toast.success('修改已保存');
      refreshUsers();
      return true;
    });
  };

  const handleResetPassword = () => {
    if (!pwdTarget || !resetPwd.trim()) { toast.error('请输入新密码'); return; }
    if (resetPwd.length < 6) { toast.error('密码至少6位'); return; }
    const target = pwdTarget;
    const newPwd = resetPwd.trim();
    setPwdTarget(null);
    setResetPwd('');
    requireAdminPassword(`即将重置用户「${target.displayName}」的登录密码。`, async (pwd) => {
      const res = await resetPassword(target.id, newPwd, pwd);
      if (!res.success) { toast.error(res.error || '密码重置失败'); return false; }
      toast.success(`已重置 ${target.displayName} 的密码`);
      return true;
    });
  };

  // ── 其他 ──
  const handleAddUser = () => {
    if (!newUser.username || !newUser.password || !newUser.displayName) {
      toast.error('请填写完整信息');
      return;
    }
    const payload = { ...newUser };
    setShowAddDialog(false);
    setNewUser({ username: '', password: '', displayName: '', role: 'member', region: '华南区' });
    requireAdminPassword(`即将创建用户「${payload.displayName}」（${payload.username}）。`, async (pwd) => {
      const result = await addUser({ ...payload, adminPassword: pwd });
      if (!result.success) { toast.error(result.error || '创建失败'); return false; }
      toast.success('用户创建成功');
      refreshUsers();
      return true;
    });
  };

  const handleApprove = async (userId: string) => { await approveUser(userId); toast.success('用户已批准'); refreshUsers(); };
  const handleReject = async (userId: string) => { await rejectUser(userId); toast.success('用户已拒绝'); refreshUsers(); };

  const allColumns = [
    { key: 'username', header: '用户名' },
    { key: 'displayName', header: '显示名称' },
    {
      key: 'role',
      header: '角色',
      minWidth: 90,
      render: (item: User) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
          item.role === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}>
          {ROLE_LABELS[item.role]}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      minWidth: 84,
      render: (item: User) => (
        item.id === currentUser?.id ? (
          <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary font-medium">当前用户</span>
        ) : (
          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[item.status]}`}>{STATUS_LABELS[item.status]}</span>
        )
      ),
    },
    { key: 'region', header: '区域', minWidth: 64, render: (item: User) => <span className="text-sm">{item.region || '全部'}</span> },
    { key: 'createdAt', header: '创建时间', minWidth: 140, render: (item: User) => formatDate(item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      minWidth: 110,
      hideable: false,
      render: (item: User) => (
        item.id === currentUser?.id ? null : (
          <div className="flex gap-1">
            {/* 管理员账户只能被重置密码，不能编辑/删除 */}
            {item.role !== 'admin' && (
              <Button variant="ghost" size="icon" className="h-8 w-8" title="编辑用户" onClick={() => openEdit(item)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" title="重置密码" onClick={() => { setPwdTarget(item); setResetPwd(''); }}>
              <KeyRound className="h-4 w-4" />
            </Button>
            {item.role !== 'admin' && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="删除用户" onClick={() => handleDeleteClick(item)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      ),
    },
  ];

  const pendingColumns = [
    { key: 'username', header: '用户名' },
    { key: 'displayName', header: '显示名称' },
    { key: 'createdAt', header: '申请时间', minWidth: 140, render: (item: User) => formatDate(item.createdAt) },
    {
      key: 'actions',
      header: '操作',
      minWidth: 76,
      hideable: false,
      render: (item: User) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="批准" onClick={() => handleApprove(item.id)}>
            <CheckCircle className="h-4 w-4 text-primary" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="拒绝" onClick={() => handleReject(item.id)}>
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <UsersIcon className="h-6 w-6" />用户管理
        </h2>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-1 h-4 w-4" />添加用户
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">全部用户</TabsTrigger>
          <TabsTrigger value="pending">
            待审核{pendingUsers.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-destructive text-destructive-foreground text-xs rounded-full">{pendingUsers.length}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader className="pt-4 pb-2">
              <div className="flex items-center gap-3 flex-wrap">
                <CardTitle className="text-base shrink-0">用户列表</CardTitle>
                {/* 搜索框 + 清除筛选：上移与标题同行 */}
                <div className="relative flex-1 min-w-[200px] max-w-[400px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="搜索用户名或显示名称..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs shrink-0"
                  disabled={!userSearch && roleFilter === 'all' && statusFilter === 'all' && regionFilter === 'all'}
                  onClick={() => { setUserSearch(''); setRoleFilter('all'); setStatusFilter('all'); setRegionFilter('all'); }}
                >
                  <XIcon className="h-3.5 w-3.5 mr-1" />清除筛选
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 筛选项 + 列设置（同行，列设置靠右） */}
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
                {/* 「列设置」按钮的外部容器：DataTable 通过 Portal 渲染到这里，靠右对齐 */}
                <div id="users-all-toolbar" className="ml-auto shrink-0" />
              </div>
              <DataTable columns={allColumns} data={filteredUsers} keyExtractor={(item) => item.id} tableId="users-all" tableClassName="text-[15px]" toolbarContainerId="users-all-toolbar" />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardHeader className="pt-4 pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">待审核用户</CardTitle>
                <div id="users-pending-toolbar" className="shrink-0" />
              </div>
            </CardHeader>
            <CardContent>
              <DataTable columns={pendingColumns} data={pendingUsers} keyExtractor={(item) => item.id} tableId="users-pending" tableClassName="text-[15px]" toolbarContainerId="users-pending-toolbar" />
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

      {/* 编辑用户（角色修改也在这里进行，需验证当前管理员密码） */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑用户 - {editTarget?.username}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>显示名称</Label>
              <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as User['role'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                  <SelectItem value="senior">{ROLE_LABELS.senior}</SelectItem>
                  <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>区域</Label>
              <Select value={editRegion} onValueChange={setEditRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGION_LIST.map((r) => (
                    <SelectItem key={r} value={r} disabled={r === '全部' && editRole !== 'admin'}>
                      {r}{r === '全部' && editRole !== 'admin' ? ' (仅管理员)' : ''}
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

      {/* 重置密码（确认后触发管理员密码验证） */}
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

      {/* 删除确认（确认后触发管理员密码验证） */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除用户「{deleteTarget?.displayName}」（{deleteTarget?.username}）吗？此操作不可撤销。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={confirmDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 管理员密码二次验证（所有敏感操作共用） */}
      <AdminPasswordDialog
        open={verifyOpen}
        description={verifyDesc}
        loading={verifyLoading}
        onOpenChange={setVerifyOpen}
        onConfirm={handleVerifyConfirm}
      />
    </div>
  );
}
