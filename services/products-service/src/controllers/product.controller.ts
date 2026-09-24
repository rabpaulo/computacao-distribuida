import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { productService } from '../services/product.service';

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(200),
    description: z.string().min(5, 'Descrição deve ter pelo menos 5 caracteres').max(3000),
    price: z.number().positive('Preço deve ser um valor positivo'),
    category: z.string().min(2, 'Categoria é obrigatória'),
    stock: z.number().int().min(0, 'Estoque não pode ser negativo'),
    active: z.boolean().optional().default(true),
    images: z.array(z.string().url('URL de imagem inválida')).optional().default([]),
    attributes: z.record(z.any()).optional().default({}),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID do produto é obrigatório'),
  }),
  body: z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().min(5).max(3000).optional(),
    price: z.number().positive().optional(),
    category: z.string().min(2).optional(),
    stock: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    images: z.array(z.string().url()).optional(),
    attributes: z.record(z.any()).optional(),
  }),
});

export const getProductByIdSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID do produto é obrigatório'),
  }),
});

export const listProductsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    category: z.string().optional(),
    search: z.string().optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z.enum(['price_asc', 'price_desc', 'newest']).optional().default('newest'),
  }),
});

export const updateStockSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID do produto é obrigatório'),
  }),
  body: z.object({
    delta: z.number().int({ message: 'Delta de estoque deve ser um número inteiro' }),
  }),
});

export class ProductController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await productService.create(req.body);
      res.status(201).json({
        status: 'success',
        message: 'Produto cadastrado com sucesso',
        data: { product },
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await productService.list(req.query as any);
      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await productService.getById(req.params.id);
      res.status(200).json({
        status: 'success',
        data: { product },
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await productService.update(req.params.id, req.body);
      res.status(200).json({
        status: 'success',
        message: 'Produto atualizado com sucesso',
        data: { product },
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await productService.delete(req.params.id);
      res.status(200).json({
        status: 'success',
        message: 'Produto removido com sucesso',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { delta } = req.body;
      const product = await productService.updateStock(req.params.id, delta);
      res.status(200).json({
        status: 'success',
        message: `Estoque do produto ${delta >= 0 ? 'incrementado' : 'decrementado'} com sucesso`,
        data: {
          productId: product.id,
          currentStock: product.stock,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const productController = new ProductController();
