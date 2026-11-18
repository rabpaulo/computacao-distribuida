import {
  AppNotification,
  Order,
  Payment,
  PaymentMethod,
  Product,
  ServiceHealth,
  Shipment,
  User,
} from '../types';

const API_BASE = '/api/v1';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('districommerce_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const api = {
  // ==========================================
  // Produtos e Catálogo
  // ==========================================
  async getProducts(params?: {
    category?: string;
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }): Promise<{ products: Product[]; pagination: { total: number; page: number; totalPages: number } }> {
    const query = new URLSearchParams();
    if (params?.category) query.append('category', params.category);
    if (params?.search) query.append('search', params.search);
    if (params?.sort) query.append('sort', params.sort);
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));

    const res = await fetch(`${API_BASE}/products?${query.toString()}`);
    if (!res.ok) throw new Error('Falha ao carregar catálogo de produtos');
    const data = await res.json();
    return data.data;
  },

  async getProductById(id: string): Promise<Product> {
    const res = await fetch(`${API_BASE}/products/${id}`);
    if (!res.ok) throw new Error('Produto não encontrado');
    const data = await res.json();
    return data.data.product;
  },

  async createProduct(productData: Partial<Product>): Promise<Product> {
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(productData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao cadastrar produto');
    return data.data.product;
  },

  async updateStock(id: string, delta: number): Promise<{ currentStock: number }> {
    const res = await fetch(`${API_BASE}/products/${id}/stock`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ delta }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao atualizar estoque');
    return data.data;
  },

  // ==========================================
  // Autenticação e Usuários
  // ==========================================
  async register(payload: {
    name: string;
    email: string;
    password: string;
    role?: 'ROLE_CUSTOMER' | 'ROLE_ADMIN';
    // LGPD: consentimento explícito com a Política de Privacidade
    acceptTerms: boolean;
  }): Promise<{ user: User; token: string }> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro no cadastro de usuário');
    return data.data;
  },

  async login(payload: {
    email: string;
    password: string;
  }): Promise<{ user: User; token: string }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Credenciais inválidas');
    return data.data;
  },

  async getProfile(): Promise<User> {
    const res = await fetch(`${API_BASE}/users/profile`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao obter perfil');
    return data.data.user;
  },

  // Direito de correção (LGPD, art. 18, III)
  async updateProfileName(name: string): Promise<User> {
    const res = await fetch(`${API_BASE}/users/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'Não foi possível atualizar o nome');
    return data.data.user;
  },

  // ==========================================
  // LGPD: direitos do titular
  // ==========================================
  // Junta os dados que cada serviço guarda sobre o usuário num arquivo só
  // (acesso e portabilidade). Cada serviço devolve apenas o que é dele.
  async exportMyData(): Promise<Record<string, unknown>> {
    const get = async (path: string) => {
      const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || `Erro ${res.status}`);
      return body.data;
    };

    const [account, orders, payments, shipments, notifications] = await Promise.allSettled([
      get('/users/me/export'),
      get('/orders/my-orders'),
      get('/payments/my-payments'),
      get('/shipments/my-shipments'),
      get('/notifications?limit=100'),
    ]);

    // Sem os dados da conta o arquivo não faz sentido; o resto é "o que deu para juntar"
    if (account.status === 'rejected') {
      throw new Error(account.reason?.message || 'Não foi possível exportar seus dados');
    }

    const part = (result: PromiseSettledResult<unknown>) =>
      result.status === 'fulfilled'
        ? result.value
        : { erro: String((result.reason as Error)?.message || result.reason) };

    return {
      exportadoEm: new Date().toISOString(),
      conta: account.value,
      pedidos: part(orders),
      pagamentos: part(payments),
      entregas: part(shipments),
      notificacoes: part(notifications),
    };
  },

  async deleteMyAccount(password: string): Promise<void> {
    const res = await fetch(`${API_BASE}/users/me`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'Não foi possível excluir a conta');
  },

  // ==========================================
  // Notificações em tempo real
  // ==========================================
  async getNotifications(limit = 30): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
    const res = await fetch(`${API_BASE}/notifications?limit=${limit}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao carregar notificações');
    return data.data;
  },

  async markNotificationRead(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/notifications/${id}/read`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Erro ao marcar notificação como lida');
  },

  async markAllNotificationsRead(): Promise<void> {
    const res = await fetch(`${API_BASE}/notifications/read-all`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Erro ao marcar notificações como lidas');
  },

  // ==========================================
  // Pedidos e Checkout
  // ==========================================
  async createOrder(items: Array<{
    productId: string;
    productName: string;
    price: number;
    quantity: number;
  }>): Promise<Order> {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao processar pedido');
    return data.data.order;
  },

  async getMyOrders(): Promise<Order[]> {
    const res = await fetch(`${API_BASE}/orders/my-orders`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao carregar pedidos');
    return data.data.orders;
  },

  // ==========================================
  // Pagamentos (PayPal simulado)
  // ==========================================
  async getMyPayments(): Promise<Payment[]> {
    const res = await fetch(`${API_BASE}/payments/my-payments`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao carregar pagamentos');
    return data.data.payments;
  },

  // Comprador aprovou na tela do PayPal. DECLINE simula o cartão recusado.
  // `method` e so o rotulo escolhido na tela; dados de cartao nao saem do navegador.
  async approvePayPal(
    orderId: string,
    decision: 'APPROVE' | 'DECLINE',
    method: PaymentMethod = 'PAYPAL'
  ): Promise<Payment> {
    const res = await fetch(`${API_BASE}/payments/order/${orderId}/paypal/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ decision, method }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao confirmar pagamento no PayPal');
    return data.data.payment;
  },

  async cancelPayPal(orderId: string): Promise<Payment> {
    const res = await fetch(`${API_BASE}/payments/order/${orderId}/paypal/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao cancelar pagamento');
    return data.data.payment;
  },

  // ==========================================
  // Logística / Rastreamento IoT
  // ==========================================
  async getMyShipments(): Promise<Shipment[]> {
    const res = await fetch(`${API_BASE}/shipments/my-shipments`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao carregar entregas');
    return data.data.shipments;
  },

  // ==========================================
  // Monitoramento do Cluster / API Gateway
  // ==========================================
  async getClusterHealth(): Promise<{ gateway: string; services: ServiceHealth[] }> {
    try {
      const res = await fetch('/services');
      if (!res.ok) throw new Error('Status degradado');
      return await res.json();
    } catch {
      return {
        gateway: 'OFFLINE',
        services: [
          { name: 'users-service', url: 'http://localhost:3001', status: 'OFFLINE' },
          { name: 'products-service', url: 'http://localhost:3002', status: 'OFFLINE' },
          { name: 'orders-service', url: 'http://localhost:3003', status: 'OFFLINE' },
          { name: 'payments-service', url: 'http://localhost:3004', status: 'OFFLINE' },
          { name: 'logistics-service', url: 'http://localhost:3005', status: 'OFFLINE' },
          { name: 'notifications-service', url: 'http://localhost:3007', status: 'OFFLINE' },
        ],
      };
    }
  },
};

// ============================================================================
// Notificações em tempo real (Server-Sent Events)
// ============================================================================
// Usamos fetch em vez de EventSource porque o EventSource não deixa mandar o
// header Authorization, e o JWT não pode ir na URL (aparece em log de proxy).

export interface NotificationStreamHandlers {
  // O servidor abriu o canal: bom momento de sincronizar a lista (pega o que se perdeu offline)
  onReady: () => void;
  onNotification: (notification: AppNotification) => void;
  // Token recusado (expirado ou conta removida): não adianta reconectar
  onAuthError: () => void;
  onStatusChange?: (connected: boolean) => void;
}

function dispatchFrame(frame: string, handlers: NotificationStreamHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // comentário (heartbeat)
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (event === 'ready') {
    handlers.onReady();
  } else if (event === 'notification' && dataLines.length > 0) {
    try {
      handlers.onNotification(JSON.parse(dataLines.join('\n')) as AppNotification);
    } catch {
      console.warn('Notificação com formato inválido ignorada');
    }
  }
}

// Mantém a conexão aberta e reconecta sozinho (2s, 4s... até 30s).
// Devolve a função que encerra tudo.
export function openNotificationStream(token: string, handlers: NotificationStreamHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;

  const run = async () => {
    let attempt = 0;

    while (!stopped) {
      try {
        const res = await fetch(`${API_BASE}/notifications/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });

        if (res.status === 401 || res.status === 403) {
          handlers.onAuthError();
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        attempt = 0;
        handlers.onStatusChange?.(true);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Cada evento termina com uma linha em branco
          let end = buffer.indexOf('\n\n');
          while (end !== -1) {
            dispatchFrame(buffer.slice(0, end), handlers);
            buffer = buffer.slice(end + 2);
            end = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (stopped) return;
      }

      handlers.onStatusChange?.(false);
      if (stopped) return;

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5))));
    }
  };

  void run();

  return () => {
    stopped = true;
    controller.abort();
  };
}
