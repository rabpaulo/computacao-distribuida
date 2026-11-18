import { env } from './config/env';
import { NotificationService } from './services/notification.service';
import { RealtimeHub } from './services/realtime.hub';

// Instâncias únicas do processo
export const hub = new RealtimeHub(env.SSE_MAX_CONNECTIONS_PER_USER);
export const notificationService = new NotificationService(hub);
