import { Router } from 'express';
import { authController, loginSchema, registerSchema } from '../controllers/auth.controller';
import { validateRequest } from '../middlewares/validate.middleware';

const router = Router();

router.post('/register', validateRequest(registerSchema), (req, res, next) => {
  authController.register(req, res, next);
});

router.post('/login', validateRequest(loginSchema), (req, res, next) => {
  authController.login(req, res, next);
});

export default router;
