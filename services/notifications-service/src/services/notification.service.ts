import { randomUUID } from 'node:crypto';
import { pool } from '../config/database';
import { notificationsCreated } from '../metrics';
import {
  NotificationDTO,
  NotificationLevel,
  NotificationRow,
  toDTO,
} from '../models/notification.model';
import { RealtimeHub } from './realtime.hub';

const COLUMNS = 'id, user_id, event_id, type, level, title, message, order_id, read_at, created_at';

export interface NewNotification {
  // Id do evento do broker: garante uma única notificação por evento
  eventId: string;
  userId: string;
  type: string;
  level: NotificationLevel;
  title: string;
  message: string;
  orderId?: string;
}

export class NotificationService {
  constructor(private readonly hub: RealtimeHub) {}

  // Grava e já empurra para as abas abertas do usuário. Devolve null quando o
  // evento já tinha virado notificação (reentrega do broker).
  async create(data: NewNotification): Promise<NotificationDTO | null> {
    const result = await pool.query<NotificationRow>(
      `INSERT INTO notifications (id, user_id, event_id, type, level, title, message, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        data.userId,
        data.eventId,
        data.type,
        data.level,
        data.title,
        data.message,
        data.orderId ?? null,
      ]
    );

    if (result.rowCount === 0) return null;

    const dto = toDTO(result.rows[0]);
    notificationsCreated.inc({ type: data.type });
    this.hub.publish(data.userId, dto);
    return dto;
  }

  async list(
    userId: string,
    options: { limit: number; unreadOnly: boolean }
  ): Promise<{ notifications: NotificationDTO[]; unreadCount: number }> {
    const rows = await pool.query<NotificationRow>(
      `SELECT ${COLUMNS} FROM notifications
       WHERE user_id = $1 ${options.unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [userId, options.limit]
    );

    const unread = await pool.query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId]
    );

    return {
      notifications: rows.rows.map(toDTO),
      unreadCount: Number(unread.rows[0]?.total ?? 0),
    };
  }

  // O filtro por user_id impede marcar a notificação de outra pessoa
  async markRead(userId: string, id: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await pool.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL',
      [userId]
    );
    return result.rowCount ?? 0;
  }

  async rememberOrderOwner(orderId: string, userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO order_owners (order_id, user_id) VALUES ($1, $2)
       ON CONFLICT (order_id) DO NOTHING`,
      [orderId, userId]
    );
  }

  async findOrderOwner(orderId: string): Promise<string | null> {
    const result = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM order_owners WHERE order_id = $1',
      [orderId]
    );
    return result.rows[0]?.user_id ?? null;
  }

  // LGPD (eliminação): apaga tudo que este serviço guarda sobre o titular
  async deleteUserData(userId: string): Promise<{ notifications: number; orders: number }> {
    const notifications = await pool.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    const orders = await pool.query('DELETE FROM order_owners WHERE user_id = $1', [userId]);
    return { notifications: notifications.rowCount ?? 0, orders: orders.rowCount ?? 0 };
  }

  // LGPD (minimização): não guardamos aviso de pedido além do necessário
  async purgeOlderThan(days: number): Promise<number> {
    const result = await pool.query(
      `DELETE FROM notifications WHERE created_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval`,
      [String(days)]
    );
    // Depois de tanto tempo nenhum evento de pagamento daquele pedido vai chegar
    await pool.query(
      `DELETE FROM order_owners WHERE created_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval`,
      [String(days)]
    );
    return result.rowCount ?? 0;
  }
}
