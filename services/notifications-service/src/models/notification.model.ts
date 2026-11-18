export type NotificationLevel = 'info' | 'success' | 'error';

export interface NotificationRow {
  id: string;
  user_id: string;
  event_id: string;
  type: string;
  level: NotificationLevel;
  title: string;
  message: string;
  order_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

// O que a API devolve: sem user_id nem event_id (detalhes internos)
export interface NotificationDTO {
  id: string;
  type: string;
  level: NotificationLevel;
  title: string;
  message: string;
  order_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

export function toDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    title: row.title,
    message: row.message,
    order_id: row.order_id,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}
