import bcrypt from 'bcryptjs';
import { query } from '../db';
import type { AuthUser } from '../types';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'user' | 'admin';
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',
    [username],
  );
  return result.rows[0] ?? null;
}

export async function verifyPassword(user: UserRow, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash);
}

export async function ensureSeedUsers(adminPassword: string): Promise<void> {
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const userHash = await bcrypt.hash('user123', 10);
  await query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ('admin', $1, 'admin'), ('alice', $2, 'user')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [adminHash, userHash],
  );
}

export function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, role: row.role };
}
