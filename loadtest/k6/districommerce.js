// Teste de carga do DistriCommerce (k6) - passa SEMPRE pelo API Gateway.
//
// Perfis (variável PROFILE):  smoke | load (padrão) | stress
// Alvo (variável BASE_URL):   http://localhost:8000 (padrão)
//
// Fluxo simulado por usuário virtual (VU):
//   70% navegação  -> GET /api/v1/products (+ detalhe de um produto)
//   20% login      -> POST /api/v1/auth/login
//   10% checkout   -> POST /api/v1/orders (dispara a saga RabbitMQ pedido -> pagamento -> logística)
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const PROFILE = __ENV.PROFILE || 'load';
const POOL_SIZE = 20; // clientes pré-criados no setup (evita medir o custo do bcrypt no registro)

const checkoutLatency = new Trend('checkout_duration', true);
const businessErrors = new Rate('business_errors');

const PROFILES = {
  smoke: { stages: [{ duration: '20s', target: 3 }] },
  load: {
    stages: [
      { duration: '30s', target: 20 }, // rampa de subida
      { duration: '1m', target: 20 }, // patamar sustentado
      { duration: '30s', target: 50 }, // pico
      { duration: '30s', target: 0 }, // rampa de descida
    ],
  },
  stress: {
    stages: [
      { duration: '30s', target: 50 },
      { duration: '1m', target: 150 },
      { duration: '1m', target: 300 },
      { duration: '30s', target: 0 },
    ],
  },
};

export const options = {
  stages: PROFILES[PROFILE].stages,
  thresholds: {
    http_req_failed: ['rate<0.05'], // < 5% de erros
    http_req_duration: ['p(95)<800'], // p95 abaixo de 800ms
    checkout_duration: ['p(95)<1500'],
    business_errors: ['rate<0.05'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };
const authHeaders = (token) => ({
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
});

function register(name, email, role) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/register`,
    JSON.stringify({ name, email, password: 'senha-k6-123', role }),
    json
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Falha ao registrar ${email}: ${res.status} ${res.body}`);
  }
  return res.json('data.token');
}

// Roda uma vez antes do teste: cria admin, produto com estoque grande e pool de clientes.
export function setup() {
  const run = `${Date.now()}`;
  const adminToken = register('Admin K6', `admin-${run}@k6.test`, 'ROLE_ADMIN');

  const created = http.post(
    `${BASE_URL}/api/v1/products`,
    JSON.stringify({
      name: `Produto de carga ${run}`,
      description: 'Produto criado pelo teste de carga com estoque alto',
      price: 99.9,
      category: 'loadtest',
      stock: 10000000,
    }),
    authHeaders(adminToken)
  );
  if (created.status !== 201) {
    throw new Error(`Falha ao criar produto: ${created.status} ${created.body}`);
  }
  const product = created.json('data.product');

  const users = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const email = `cliente-${run}-${i}@k6.test`;
    users.push({ email, token: register(`Cliente K6 ${i}`, email, 'ROLE_CUSTOMER') });
  }
  return { product: { id: product.id, name: product.name, price: product.price }, users };
}

export default function (data) {
  const user = data.users[(__VU - 1) % data.users.length];
  const dice = Math.random();

  if (dice < 0.7) {
    group('navegação', () => {
      const list = http.get(`${BASE_URL}/api/v1/products?limit=10`);
      check(list, { 'listagem 200': (r) => r.status === 200 });
      const detail = http.get(`${BASE_URL}/api/v1/products/${data.product.id}`);
      check(detail, { 'detalhe 200': (r) => r.status === 200 });
    });
  } else if (dice < 0.9) {
    group('login', () => {
      const res = http.post(
        `${BASE_URL}/api/v1/auth/login`,
        JSON.stringify({ email: user.email, password: 'senha-k6-123' }),
        json
      );
      const ok = check(res, { 'login 200': (r) => r.status === 200 });
      businessErrors.add(!ok);
    });
  } else {
    group('checkout', () => {
      const res = http.post(
        `${BASE_URL}/api/v1/orders`,
        JSON.stringify({
          items: [
            { productId: data.product.id, productName: data.product.name, price: data.product.price, quantity: 1 },
          ],
        }),
        authHeaders(user.token)
      );
      checkoutLatency.add(res.timings.duration);
      const ok = check(res, { 'pedido criado (201)': (r) => r.status === 201 });
      businessErrors.add(!ok);
    });
  }

  sleep(Math.random() * 1 + 0.5);
}
