import { useUserStore } from '@/stores/userStore';

export function useUsers() {
  const users = useUserStore((state) => state.users);
  const pendingUsers = useUserStore((state) => state.pendingUsers);
  const isLoading = useUserStore((state) => state.loading);
  const fetchUsers = useUserStore((state) => state.fetchUsers);
  const addUser = useUserStore((state) => state.addUser);
  const removeUser = useUserStore((state) => state.removeUser);
  const approveUser = useUserStore((state) => state.approveUser);
  const rejectUser = useUserStore((state) => state.rejectUser);
  const updateUserRole = useUserStore((state) => state.updateUserRole);
  const updateProfile = useUserStore((state) => state.updateProfile);
  const resetPassword = useUserStore((state) => state.resetPassword);

  return { users, pendingUsers, isLoading, fetchUsers, addUser, removeUser, approveUser, rejectUser, updateUserRole, updateProfile, resetPassword, refreshUsers: fetchUsers };
}
