import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { env } from '../config/env';
import { Order, OrderItem, OrderStatus } from '../models/order.model';
import { AppError } from '../middlewares/error.middleware';
import { orderPublisher } from '../messaging/order.publisher';
import { adjustStock, StockConflictError } from '../clients/products.client';
import { CircuitOpenError } from '../resilience/circuit-breaker';

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

    // Reserva o estoque no products-service antes de gravar o pedido
    if (authToken) {
      await this.reserveStock(data.items, authToken);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderId = uuidv4();
      // Nasce PENDING e so muda quando o pagamento responder pela fila
      const insertOrderQuery = `
        INSERT INTO orders (id, user_id, total_amount, status)
        VALUES ($1, $2, $3, 'PENDING')
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

      const order: Order = {
        id: createdOrder.id,
        user_id: createdOrder.user_id,
        total_amount: Number(createdOrder.total_amount),
        status: createdOrder.status,
        created_at: createdOrder.created_at,
        updated_at: createdOrder.updated_at,
        items: itemsList,
      };

      // So publica depois do COMMIT, senao o payments-service pode pegar
      // um pedido que acabou em ROLLBACK
      await orderPublisher.publishOrderCreated(order);

      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Aplica o resultado do pagamento que chegou pela fila.
  // O WHERE status = 'PENDING' deixa a operacao idempotente: se o broker
  // reentregar a mesma mensagem, o UPDATE nao pega nada e nada muda.
  async applyPaymentResult(
    orderId: string,
    status: Extract<OrderStatus, 'CONFIRMED' | 'CANCELLED'>,
    reason?: string
  ): Promise<boolean> {
    const query = `
      UPDATE orders
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND status = 'PENDING'
      RETURNING id
    `;
    const result = await pool.query(query, [status, orderId]);

    if (result.rowCount === 0) {
      return false;
    }

    if (status === 'CANCELLED') {
      console.warn(
        `[orders-service] Pedido ${orderId} cancelado por recusa de pagamento` +
          (reason ? `: ${reason}` : '.')
      );
      // O estoque foi reservado no checkout, antes do pagamento. Como o
      // pagamento nao passou, precisamos devolver as unidades.
      await this.restoreStock(orderId);
    }

    return true;
  }

  // Devolve ao catalogo as unidades reservadas por um pedido cancelado.
  // Best-effort: se o products-service estiver fora, registra e segue, senao
  // o pedido ficaria preso num estado inconsistente so por causa disso.
  private async restoreStock(orderId: string): Promise<void> {
    const itemsRes = await pool.query(
      'SELECT product_id, product_name, quantity FROM order_items WHERE order_id = $1',
      [orderId]
    );

    if (itemsRes.rowCount === 0) {
      return;
    }

    // Aqui nao existe usuario logado, a chamada vem do consumidor da fila.
    // Entao o proprio servico assina um token curto com o segredo
    // compartilhado para falar com o products-service.
    const serviceToken = jwt.sign(
      { userId: 'orders-service', email: 'orders-service@districommerce', role: 'ROLE_ADMIN' },
      env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    for (const item of itemsRes.rows) {
      try {
        const res = await adjustStock(item.product_id, item.quantity, serviceToken);

        if (!res.ok) {
          console.warn(
            `[orders-service] products-service recusou a devolucao de ${item.quantity}x ` +
              `"${item.product_name}" (HTTP ${res.status})`
          );
          continue;
        }

        console.log(
          `[orders-service] Devolvido ao estoque: ${item.quantity}x "${item.product_name}"`
        );
      } catch (err: any) {
        console.warn(
          `[orders-service] Falha ao devolver estoque de "${item.product_name}":`,
          err.message
        );
      }
    }
  }

  // Reserva item a item. Se um item nao tiver estoque, devolve o que ja foi
  // reservado dos anteriores (compensacao) e recusa o pedido.
  //
  // Se o products-service estiver fora (ou o circuit breaker aberto), o
  // fallback e seguir com o checkout sem reserva: a venda nao para por causa
  // do catalogo. Com o breaker aberto isso acontece na hora, sem esperar o
  // timeout de cada item.
  private async reserveStock(items: CreateOrderItemDTO[], authToken: string): Promise<void> {
    const reserved: CreateOrderItemDTO[] = [];

    for (const item of items) {
      try {
        const res = await adjustStock(item.productId, -item.quantity, authToken);
        if (res.ok) reserved.push(item);
      } catch (err: any) {
        if (err instanceof StockConflictError) {
          await this.releaseReserved(reserved, authToken);
          throw new AppError(409, `Estoque insuficiente para o produto "${item.productName}"`);
        }

        const motivo =
          err instanceof CircuitOpenError
            ? 'circuit breaker aberto'
            : err.message;
        console.warn(
          `[orders-service] Fallback: pedido segue sem reserva de "${item.productName}" (${motivo})`
        );
      }
    }
  }

  private async releaseReserved(items: CreateOrderItemDTO[], authToken: string): Promise<void> {
    for (const item of items) {
      try {
        await adjustStock(item.productId, item.quantity, authToken);
      } catch (err: any) {
        console.warn(
          `[orders-service] Falha ao desfazer reserva de "${item.productName}":`,
          err.message
        );
      }
    }
  }

  // Carrega o pedido com itens, sem checagem de dono. Uso interno (eventos).
  async findWithItems(orderId: string): Promise<Order | null> {
    const orderRes = await pool.query(
      `SELECT id, user_id, total_amount, status, created_at, updated_at FROM orders WHERE id = $1`,
      [orderId]
    );
    if (orderRes.rows.length === 0) return null;

    const row = orderRes.rows[0];
    const itemsRes = await pool.query(
      `SELECT id, order_id, product_id, product_name, price, quantity FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    return {
      id: row.id,
      user_id: row.user_id,
      total_amount: Number(row.total_amount),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      items: itemsRes.rows.map((it) => ({ ...it, price: Number(it.price) })),
    };
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
