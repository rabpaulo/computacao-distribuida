import { Router } from 'express';
import {
  getUserByIdSchema,
  updateProfileSchema,
  userController,
} from '../controllers/user.controller';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';

const router = Router();

// Todas as rotas de usuários requerem autenticação JWT
router.use(authenticateToken);

// Consulta de perfil próprio
router.get('/profile', (req, res, next) => {
  userController.getProfile(req, res, next);
});

// Atualização de perfil próprio
router.put('/profile', validateRequest(updateProfileSchema), (req, res, next) => {
  userController.updateProfile(req, res, next);
});

// Listagem de usuários (apenas para ADMIN)
router.get('/', requireRole(['ROLE_ADMIN']), (req, res, next) => {
  userController.list(req, res, next);
});

// Consulta por ID (próprio usuário ou ADMIN)
router.get('/:id', validateRequest(getUserByIdSchema), (req, res, next) => {
  userController.getById(req, res, next);
});

export default router;
