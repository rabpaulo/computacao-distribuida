import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { env } from '../config/env';
import { Order, OrderItem } from '../models/order.model';
import { AppError } from '../middlewares/error.middleware';

export interface CreateOrderItemDTO {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
}

export interface CreateOrderDTO {
  userId: string;
  items: CreateOrderItemDTO[];
}

export class OrderService {
  async create(data: CreateOrderDTO, authToken?: string): Promise<Order> {
    if (!data.items || data.items.length === 0) {
      throw new AppError(400, 'O pedido deve conter ao menos um item');
    }

    const totalAmount = data.items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0
    );

    // Se houver token, tenta atualizar o estoque no products-service
    if (authToken) {
      for (const item of data.items) {
        try {
          const res = await fetch(`${env.PRODUCTS_SERVICE_URL}/api/v1/products/${item.productId}/stock`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ delta: -item.quantity }),
          });

          if (!res.ok && res.status === 409) {
            throw new AppError(409, `Estoque insuficiente para o produto "${item.productName}"`);
          }
        } catch (err: any) {
          if (err instanceof AppError) throw err;
          console.warn(`[orders-service] Aviso: Não foi possível atualizar estoque no products-service:`, err.message);
        }
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderId = uuidv4();
      const insertOrderQuery = `
        INSERT INTO orders (id, user_id, total_amount, status)
        VALUES ($1, $2, $3, 'CONFIRMED')
        RETURNING id, user_id, total_amount, status, created_at, updated_at
      `;
      const orderRes = await client.query(insertOrderQuery, [
        orderId,
        data.userId,
        totalAmount.toFixed(2),
      ]);

      const createdOrder = orderRes.rows[0];
      const itemsList: OrderItem[] = [];

      for (const item of data.items) {
        const itemId = uuidv4();
        const insertItemQuery = `
          INSERT INTO order_items (id, order_id, product_id, product_name, price, quantity)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, order_id, product_id, product_name, price, quantity
        `;
        const itemRes = await client.query(insertItemQuery, [
          itemId,
          orderId,
          item.productId,
          item.productName,
          item.price.toFixed(2),
          item.quantity,
        ]);
        itemsList.push(itemRes.rows[0]);
      }

      await client.query('COMMIT');

      return {
        id: createdOrder.id,
        user_id: createdOrder.user_id,
        total_amount: Number(createdOrder.total_amount),
        status: createdOrder.status,
        created_at: createdOrder.created_at,
        updated_at: createdOrder.updated_at,
        items: itemsList,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMyOrders(userId: string): Promise<Order[]> {
    const ordersQuery = `
      SELECT id, user_id, total_amount, status, created_at, updated_at
      FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const ordersRes = await pool.query(ordersQuery, [userId]);

    const orders: Order[] = [];

    for (const row of ordersRes.rows) {
      const itemsQuery = `
        SELECT id, order_id, product_id, product_name, price, quantity
        FROM order_items
        WHERE order_id = $1
      `;
      const itemsRes = await pool.query(itemsQuery, [row.id]);

      orders.push({
        id: row.id,
        user_id: row.user_id,
        total_amount: Number(row.total_amount),
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        items: itemsRes.rows.map((it) => ({
          ...it,
          price: Number(it.price),
        })),
      });
    }

    return orders;
  }

  async getById(orderId: string, userId: string, role?: string): Promise<Order> {
    const orderQuery = `
      SELECT id, user_id, total_amount, status, created_at, updated_at
      FROM orders
      WHERE id = $1
    `;
    const orderRes = await pool.query(orderQuery, [orderId]);

    if (orderRes.rows.length === 0) {
      throw new AppError(404, 'Pedido não encontrado');
    }

    const row = orderRes.rows[0];
    if (row.user_id !== userId && role !== 'ROLE_ADMIN') {
      throw new AppError(403, 'Acesso não autorizado a este pedido');
    }

    const itemsQuery = `
      SELECT id, order_id, product_id, product_name, price, quantity
      FROM order_items
      WHERE order_id = $1
    `;
    const itemsRes = await pool.query(itemsQuery, [orderId]);

    return {
      id: row.id,
      user_id: row.user_id,
      total_amount: Number(row.total_amount),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      items: itemsRes.rows.map((it) => ({
        ...it,
        price: Number(it.price),
      })),
    };
  }
}

export const orderService = new OrderService();
