import { Router } from 'express';
import {
  createOrderSchema,
  getOrderByIdSchema,
  orderController,
} from '../controllers/order.controller';
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';

const router = Router();

// Todas as rotas de pedidos requerem autenticação
router.use(authenticateToken);

router.post('/', validateRequest(createOrderSchema), (req, res, next) => {
  orderController.create(req, res, next);
});

router.get('/my-orders', (req, res, next) => {
  orderController.getMyOrders(req, res, next);
});

router.get('/:id', validateRequest(getOrderByIdSchema), (req, res, next) => {
  orderController.getById(req, res, next);
});

export default router;
