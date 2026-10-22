import { Order, Product, ServiceHealth, User } from '../types';

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
        ],
      };
    }
  },
};
