import { Router } from 'express';
import {
  listNotificationsSchema,
  notificationController,
  notificationIdSchema,
} from '../controllers/notification.controller';
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';

const router = Router();

// Toda notificação é do próprio usuário: só entra com JWT válido
router.use(authenticateToken);

// Tempo real (Server-Sent Events). Precisa vir antes das rotas com :id
router.get('/stream', (req, res) => {
  notificationController.stream(req, res);
});

router.get('/', validateRequest(listNotificationsSchema), (req, res, next) => {
  void notificationController.list(req, res, next);
});

router.post('/read-all', (req, res, next) => {
  void notificationController.markAllRead(req, res, next);
});

router.post('/:id/read', validateRequest(notificationIdSchema), (req, res, next) => {
  void notificationController.markRead(req, res, next);
});

export default router;
