/**
 * 用户数据仓储
 *
 * 提供用户表的增删改查，所有密码字段由调用方处理。
 *
 * @module db/repositories/userRepository
 */

import { getAsync, allAsync, runAsync, withTransaction } from '../database';
import type { User, SafeUser } from '../../services/userService';

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    role: row.role,
    displayName: row.display_name,
    status: row.status,
    region: row.region,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    loginAttempts: row.login_attempts ?? 0,
    lockedUntil: row.locked_until,
  };
}

function omitPassword(user: User): SafeUser {
  const { password: _, ...safe } = user;
  return safe as SafeUser;
}

export const userRepository = {
  async findAll(filter?: { status?: string; region?: string; role?: string }): Promise<SafeUser[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.region) {
      conditions.push('region = ?');
      params.push(filter.region);
    }
    if (filter?.role) {
      conditions.push('role = ?');
      params.push(filter.role);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await allAsync(`SELECT * FROM users ${where} ORDER BY created_at DESC`, params);
    return rows.map(rowToUser).map(omitPassword);
  },

  async findById(id: string): Promise<User | null> {
    const row = await getAsync('SELECT * FROM users WHERE id = ?', [id]);
    return row ? rowToUser(row) : null;
  },

  async findByUsername(username: string): Promise<User | null> {
    const row = await getAsync('SELECT * FROM users WHERE username = ?', [username]);
    return row ? rowToUser(row) : null;
  },

  async create(user: User): Promise<SafeUser> {
    await runAsync(
      `INSERT INTO users (id, username, password, role, display_name, status, region, created_at, last_login_at, login_attempts, locked_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.username,
        user.password,
        user.role,
        user.displayName,
        user.status,
        user.region,
        user.createdAt,
        user.lastLoginAt || null,
        user.loginAttempts || 0,
        user.lockedUntil || null,
      ]
    );
    return omitPassword(user);
  },

  async update(id: string, data: Partial<User>): Promise<SafeUser | null> {
    const fields: string[] = [];
    const values: any[] = [];

    const mapping: Record<string, string> = {
      username: 'username',
      password: 'password',
      role: 'role',
      displayName: 'display_name',
      status: 'status',
      region: 'region',
      createdAt: 'created_at',
      lastLoginAt: 'last_login_at',
      loginAttempts: 'login_attempts',
      lockedUntil: 'locked_until',
    };

    for (const [key, dbKey] of Object.entries(mapping)) {
      if (key in data && (data as any)[key] !== undefined) {
        fields.push(`${dbKey} = ?`);
        values.push((data as any)[key]);
      }
    }

    if (fields.length === 0) return this.findById(id).then((u) => (u ? omitPassword(u) : null));

    values.push(id);
    await runAsync(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    const updated = await this.findById(id);
    return updated ? omitPassword(updated) : null;
  },

  async delete(id: string): Promise<void> {
    await runAsync('DELETE FROM users WHERE id = ?', [id]);
  },

  async existsAdmin(): Promise<boolean> {
    const row = await getAsync("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    return !!row;
  },
};
