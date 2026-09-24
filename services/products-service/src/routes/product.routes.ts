import { Router } from 'express';
import {
  createProductSchema,
  getProductByIdSchema,
  listProductsQuerySchema,
  productController,
  updateProductSchema,
  updateStockSchema,
} from '../controllers/product.controller';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';

const router = Router();

// Rotas públicas (Leitura do Catálogo por clientes/visitantes)
router.get('/', validateRequest(listProductsQuerySchema), (req, res, next) => {
  productController.list(req, res, next);
});

router.get('/:id', validateRequest(getProductByIdSchema), (req, res, next) => {
  productController.getById(req, res, next);
});

// Rotas de Gestão Administrativa do Catálogo (ROLE_ADMIN)
router.post(
  '/',
  authenticateToken,
  requireRole(['ROLE_ADMIN']),
  validateRequest(createProductSchema),
  (req, res, next) => {
    productController.create(req, res, next);
  }
);

router.put(
  '/:id',
  authenticateToken,
  requireRole(['ROLE_ADMIN']),
  validateRequest(updateProductSchema),
  (req, res, next) => {
    productController.update(req, res, next);
  }
);

router.delete(
  '/:id',
  authenticateToken,
  requireRole(['ROLE_ADMIN']),
  validateRequest(getProductByIdSchema),
  (req, res, next) => {
    productController.delete(req, res, next);
  }
);

// Rota de alteração de estoque (pode ser chamada pelo serviço de checkout/pedidos autenticado)
router.patch(
  '/:id/stock',
  authenticateToken,
  validateRequest(updateStockSchema),
  (req, res, next) => {
    productController.updateStock(req, res, next);
  }
);

export default router;
