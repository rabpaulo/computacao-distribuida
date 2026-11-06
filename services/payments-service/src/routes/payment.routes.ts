import { Router } from 'express';
import {
  approvePayPalSchema,
  getPaymentByOrderSchema,
  paymentController,
} from '../controllers/payment.controller';
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';

const router = Router();

// Tudo aqui exige login
router.use(authenticateToken);

router.get('/my-payments', (req, res, next) => {
  paymentController.listMine(req, res, next);
});

router.get('/order/:orderId', validateRequest(getPaymentByOrderSchema), (req, res, next) => {
  paymentController.getByOrder(req, res, next);
});

// Fluxo PayPal simulado
router.post('/order/:orderId/paypal/approve', validateRequest(approvePayPalSchema), (req, res, next) => {
  paymentController.approvePayPal(req, res, next);
});

router.post('/order/:orderId/paypal/cancel', validateRequest(getPaymentByOrderSchema), (req, res, next) => {
  paymentController.cancelPayPal(req, res, next);
});

export default router;
