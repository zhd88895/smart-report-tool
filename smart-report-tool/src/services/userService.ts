import { User } from '@/types';
import { getAllUsers, getUserById, putUser, removeUser } from './db';

export async function getAllUsersService(): Promise<User[]> {
  return getAllUsers();
}

export async function getUserByIdService(id: string): Promise<User | undefined> {
  return getUserById(id);
}

export async function createUser(user: User): Promise<string> {
  return putUser(user);
}

export async function updateUser(user: User): Promise<string> {
  return putUser(user);
}

export async function deleteUser(id: string): Promise<void> {
  return removeUser(id);
}

export async function usernameExists(username: string, excludeId?: string): Promise<boolean> {
  const users = await getAllUsers();
  return users.some((u) => u.username === username && u.id !== excludeId);
}

export async function approveUser(userId: string): Promise<void> {
  const user = await getUserById(userId);
  if (user) {
    user.status = 'active';
    await putUser(user);
  }
}

export async function rejectUser(userId: string): Promise<void> {
  const user = await getUserById(userId);
  if (user) {
    user.status = 'rejected';
    await putUser(user);
  }
}

export async function updateUserRole(userId: string, newRole: User['role']): Promise<void> {
  const user = await getUserById(userId);
  if (user) {
    user.role = newRole;
    await putUser(user);
  }
}

export async function getPendingUsers(): Promise<User[]> {
  const users = await getAllUsers();
  return users.filter((u) => u.status === 'pending');
}
