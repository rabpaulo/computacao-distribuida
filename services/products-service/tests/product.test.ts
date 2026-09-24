import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { ProductModel } from '../src/models/product.model';
import { env } from '../src/config/env';

// Mock do Mongoose e do módulo de banco de dados
vi.mock('../src/config/database', () => ({
  connectDatabase: vi.fn().mockResolvedValue(undefined),
  disconnectDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/models/product.model', () => {
  const mockProductInstance = {
    save: vi.fn(),
  };

  const MockProductModel: any = vi.fn().mockImplementation(() => mockProductInstance);
  MockProductModel.find = vi.fn();
  MockProductModel.findById = vi.fn();
  MockProductModel.findByIdAndUpdate = vi.fn();
  MockProductModel.findByIdAndDelete = vi.fn();
  MockProductModel.findOneAndUpdate = vi.fn();
  MockProductModel.countDocuments = vi.fn();

  return {
    ProductModel: MockProductModel,
  };
});

describe('Products Service - Testes Unitários e de Integração', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { userId: 'admin-123', email: 'admin@districommerce.com', role: 'ROLE_ADMIN' },
    env.JWT_SECRET
  );

  const customerToken = jwt.sign(
    { userId: 'customer-123', email: 'customer@districommerce.com', role: 'ROLE_CUSTOMER' },
    env.JWT_SECRET
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Probes (/health e /ready)', () => {
    it('deve responder status UP em /health', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.service).toBe('products-service');
    });

    it('deve responder status READY em /ready quando conectado', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');
      expect(res.body.database).toBe('CONNECTED');
    });
  });

  describe('Listagem e Consulta de Produtos (/api/v1/products)', () => {
    it('deve listar produtos com paginação sem exigir autenticação', async () => {
      const mockProducts = [
        {
          id: 'prod-1',
          name: 'Notebook Dell XPS',
          price: 9500,
          category: 'Informática',
          stock: 10,
        },
      ];

      (ProductModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockProducts),
          }),
        }),
      });
      (ProductModel.countDocuments as any).mockResolvedValue(1);

      const res = await request(app).get('/api/v1/products?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.products).toHaveLength(1);
      expect(res.body.data.pagination.total).toBe(1);
    });

    it('deve retornar detalhes de um produto pelo ID', async () => {
      const mockProduct = {
        id: 'prod-123',
        name: 'Fone Bluetooth',
        price: 250,
        category: 'Acessórios',
        stock: 50,
      };

      (ProductModel.findById as any).mockResolvedValue(mockProduct);

      const res = await request(app).get('/api/v1/products/prod-123');
      expect(res.status).toBe(200);
      expect(res.body.data.product.name).toBe('Fone Bluetooth');
    });
  });

  describe('Criação e Gestão de Produtos (Admin Only)', () => {
    it('deve rejeitar criação de produto por usuário não autenticado', async () => {
      const res = await request(app).post('/api/v1/products').send({
        name: 'Monitor 4K',
        description: 'Monitor 32 polegadas IPS',
        price: 2200,
        category: 'Monitores',
        stock: 15,
      });

      expect(res.status).toBe(401);
    });

    it('deve rejeitar criação de produto por cliente sem privilégio de ADMIN', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Monitor 4K',
          description: 'Monitor 32 polegadas IPS',
          price: 2200,
          category: 'Monitores',
          stock: 15,
        });

      expect(res.status).toBe(403);
    });

    it('deve permitir criação de produto quando requisitado por ADMIN com dados válidos', async () => {
      const productPayload = {
        name: 'Teclado Mecânico RGB',
        description: 'Switches ópticos lineares, keycaps PBT double-shot',
        price: 499.9,
        category: 'Periféricos',
        stock: 30,
      };

      const savedProduct = { id: 'prod-new-1', ...productPayload };
      // mock constructor instance save
      const mockInstance = {
        save: vi.fn().mockResolvedValue(savedProduct),
      };
      (ProductModel as any).mockImplementation(() => mockInstance);

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(productPayload);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.product.name).toBe('Teclado Mecânico RGB');
    });

    it('deve validar e rejeitar produtos com preço negativo', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Produto Preço Negativo',
          description: 'Descrição de teste',
          price: -50,
          category: 'Testes',
          stock: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });
  });

  describe('Alteração de Estoque (/api/v1/products/:id/stock)', () => {
    it('deve atualizar o estoque atômica e positivamente', async () => {
      const mockUpdated = {
        id: 'prod-stock-1',
        stock: 25,
      };
      (ProductModel.findOneAndUpdate as any).mockResolvedValue(mockUpdated);

      const res = await request(app)
        .patch('/api/v1/products/prod-stock-1/stock')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ delta: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data.currentStock).toBe(25);
    });
  });
});
