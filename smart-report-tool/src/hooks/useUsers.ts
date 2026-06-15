import { useUserStore } from '@/stores/userStore';

export function useUsers() {
  const users = useUserStore((state) => state.users);
  const isLoading = useUserStore((state) => state.loading);
  const fetchUsers = useUserStore((state) => state.fetchUsers);
  const addUser = useUserStore((state) => state.addUser);
  const removeUser = useUserStore((state) => state.removeUser);

  return {
    users,
    isLoading,
    fetchUsers,
    addUser,
    removeUser,
    refreshUsers: fetchUsers,
  };
}
