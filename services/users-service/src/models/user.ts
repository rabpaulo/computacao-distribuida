export type UserRole = 'ROLE_CUSTOMER' | 'ROLE_ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

export type SafeUser = Omit<User, 'password_hash'>;

export function toSafeUser(user: User): SafeUser {
  const { password_hash, ...safe } = user;
  return safe;
}
