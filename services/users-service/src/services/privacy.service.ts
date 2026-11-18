import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middlewares/error.middleware';
import { publisher, ROUTING_KEYS } from '../messaging/publisher';
import { USER_COLUMNS, User } from '../models/user';

// Direitos do titular previstos na LGPD (art. 18) que este serviço atende:
//   - acesso e portabilidade: exportData()
//   - eliminação:             deleteAccount()
//   - correção:               PUT /users/profile (user.service)

export interface PersonalDataExport {
  exportedAt: string;
  policyVersion: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: Date;
    updated_at: Date;
    consent_at: Date | null;
    consent_version: string | null;
  };
}

export class PrivacyService {
  private async loadActiveUser(userId: string): Promise<User> {
    const result = await pool.query<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
    const user = result.rows[0];

    if (!user) throw new AppError(404, 'Usuário não encontrado');
    if (user.anonymized_at) throw new AppError(410, 'Esta conta foi removida');
    return user;
  }

  // Só os dados que ESTE serviço guarda. Pedidos, pagamentos, entregas e
  // notificações ficam em outros serviços; o frontend junta tudo num arquivo só,
  // chamando o endpoint "meus dados" de cada um.
  async exportData(userId: string): Promise<PersonalDataExport> {
    const user = await this.loadActiveUser(userId);

    return {
      exportedAt: new Date().toISOString(),
      policyVersion: env.PRIVACY_POLICY_VERSION,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
        consent_at: user.consent_at ?? null,
        consent_version: user.consent_version ?? null,
      },
    };
  }

  // Eliminação. A conta não some da tabela, é ANONIMIZADA, porque pedidos e
  // pagamentos antigos apontam para o id dela e precisam ser guardados por
  // obrigação legal/fiscal (LGPD, art. 16, I). Sem nome, e-mail e senha, aquele
  // id não identifica mais ninguém.
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.loadActiveUser(userId);

    // Pede a senha de novo: um token roubado não basta para apagar a conta
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new AppError(401, 'Senha incorreta');

    // 1) Avisa os outros serviços ANTES de anonimizar. Se o broker estiver fora,
    //    a exclusão falha inteira (503) em vez de apagar só metade dos dados.
    //    Se o passo 2 falhar depois, o pior caso é o cliente tentar de novo.
    try {
      await publisher.publish(ROUTING_KEYS.USER_DELETED, {
        eventId: randomUUID(),
        eventType: ROUTING_KEYS.USER_DELETED,
        occurredAt: new Date().toISOString(),
        userId: user.id,
      });
    } catch (err) {
      console.error('[users-service] Falha ao publicar user.deleted:', (err as Error).message);
      throw new AppError(
        503,
        'Não foi possível concluir a exclusão agora. Tente novamente em instantes.'
      );
    }

    // 2) Anonimiza. A senha vira um hash de valor aleatório que ninguém conhece
    //    (login impossível), e o e-mail fica livre para um novo cadastro.
    const unusableHash = await bcrypt.hash(randomUUID(), 10);
    await pool.query(
      `UPDATE users
       SET name = 'Usuário removido',
           email = $2,
           password_hash = $3,
           role = 'ROLE_CUSTOMER',
           consent_at = NULL,
           consent_version = NULL,
           anonymized_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND anonymized_at IS NULL`,
      [user.id, `removido-${user.id}@anonimizado.invalid`, unusableHash]
    );
  }
}

export const privacyService = new PrivacyService();
