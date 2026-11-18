export type UserRole = 'ROLE_CUSTOMER' | 'ROLE_ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
  // LGPD: quando o titular aceitou a Política de Privacidade e qual versão.
  // Nulos em contas criadas antes da política existir.
  consent_at?: Date | null;
  consent_version?: string | null;
  // Preenchido quando o titular pediu a exclusão: os dados pessoais já foram apagados
  anonymized_at?: Date | null;
}

export type SafeUser = Omit<User, 'password_hash'>;

// Colunas lidas em todas as consultas de usuário. Fica num lugar só para não
// esquecer de uma delas quando o modelo ganhar um campo novo.
export const USER_COLUMNS =
  'id, name, email, password_hash, role, created_at, updated_at, consent_at, consent_version, anonymized_at';

export function toSafeUser(user: User): SafeUser {
  const { password_hash, ...safe } = user;
  return safe;
}
