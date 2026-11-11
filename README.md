# DistriCommerce - Plataforma de E-Commerce Distribuída

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-20+-2496ED.svg)](https://www.docker.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28+-326CE5.svg)](https://kubernetes.io/)

Este repositório contém o projeto da **Plataforma de E-Commerce Distribuída "DistriCommerce"**, desenvolvido como projeto final da disciplina de **Sistemas Distribuídos** (Prof. Ildo Vieira).

A plataforma adota uma arquitetura de microsserviços desacoplada, orientada a contêineres e desenvolvida inteiramente em **TypeScript (Node.js)** no Backend e **React + TypeScript + Vite** no Frontend, com persistência poliglota especializada (**PostgreSQL** para dados relacionais/ACID e **MongoDB** para catálogo NoSQL semi-estruturado).

---

## 🎯 Arquitetura da Solução

```
+-------------------------------------------------------------------------+
|                  Navegador Web / Cliente (Porta 3000)                   |
|                  React 18 + TypeScript + Vite + Nginx                   |
+------------------------------------+------------------------------------+
                                     | (REST HTTP / JSON)
                                     v
+-------------------------------------------------------------------------+
|                       API Gateway (Porta 8000)                          |
|         TypeScript / Express Proxy (CORS, Roteamento, Health)           |
+-------+----------------------------+----------------------------+-------+
        |                            |                            |
        v                            v                            v
+--------------------+      +--------------------+      +--------------------+
|   users-service    |      |  products-service  |      |   orders-service   |
| (Porta 3001 / JWT) |      | (Porta 3002 / CRUD)|      | (Porta 3003 / Cart)|
+---------+----------+      +---------+----------+      +----+----------+----+
          |                           |                      |          ^
          v                           v                      |          |
+--------------------+      +--------------------+           |          |
|  PostgreSQL (ACID) |      |   MongoDB (NoSQL)  |           |          |
|    (Porta 5432)    |      |   (Porta 27017)    |           |          |
+--------------------+      +--------------------+           |          |
                                                             |          |
                      (REST / sincrono)  --------------------- | ------- |
                      (AMQP  / assincrono)                     v         |
                                              +------------------------------+
                                              |   RabbitMQ (Porta 5672)      |
                                              |   Painel: localhost:15672    |
                                              |                              |
                                              | districommerce.events (topic)|
                                              |  |- payments.order-created   |
                                              |  |- orders.payment-processed |
                                              |  +- districommerce.dlq       |
                                              +---------------+--------------+
                                                   |                     ^
                                      order.created|                     |payment.approved
                                                   v                     |payment.rejected
                                              +------------------------------+
                                              |      payments-service        |
                                              |   (Porta 3004 / Consumer)    |
                                              +---------------+--------------+
                                                              v
                                                   +--------------------+
                                                   |  PostgreSQL (ACID) |
                                                   |     (payments)     |
                                                   +--------------------+
```

### Comunicação Síncrona vs. Assíncrona

| Interação | Modelo | Tecnologia | Por quê |
|---|---|---|---|
| Frontend → Gateway → serviços | Síncrona | REST / HTTP | O cliente precisa da resposta imediata (catálogo, login, histórico) |
| orders-service → payments-service | **Assíncrona** | **RabbitMQ (AMQP 0-9-1)** | O gateway de pagamento é lento e pode falhar: travar o checkout nele seria acoplamento temporal |
| payments-service → orders-service | **Assíncrona** | **RabbitMQ (AMQP 0-9-1)** | O resultado chega quando estiver pronto; o pedido transiciona de status sozinho |
| orders-service → products-service | Síncrona | REST / HTTP + **Circuit Breaker** | A reserva de estoque precisa ser validada antes de aceitar o pedido |
| payments-service → PayPal (simulado) | Síncrona | REST / HTTP + **Circuit Breaker** | Dependência externa: lenta e instável, precisa falhar rápido quando cair |
| orders-service → logistics-service | **Assíncrona** | RabbitMQ (`order.confirmed`) | Pedido pago vira entrega sem acoplar os dois serviços |
| logistics-service ⇄ caminhões | **Assíncrona** | **MQTT** (Mosquitto) | Dispositivos IoT com rede instável: protocolo leve, QoS, Last Will |

### Semana 7: CI/CD, Monitoramento e Testes de Carga

Pipeline no GitHub Actions, Prometheus + Grafana (http://localhost:3100) e testes de carga com k6. Detalhes e comandos em [`docs/SEMANA-7.md`](docs/SEMANA-7.md).

### Semanas 5-6: Resiliência, PayPal e IoT

```
                     Circuit Breaker                  Circuit Breaker
orders-service ──────[products-service]──> products   payments-service ──[paypal-gateway]──> paypal-mock :3006
     │                                                       ^   (OAuth, /v2/checkout/orders, capture)
     │ order.confirmed (RabbitMQ)                            │ POST /payments/order/:id/paypal/approve
     v                                                   Frontend ("Pagar com PayPal")
logistics-service :3005 ──MQTT dispatch (QoS 1)──> Mosquitto :1883 <──telemetria (QoS 0)── iot-simulator
     ^                                                   │          ──eventos (QoS 1)───── (truck-01..03)
     └────────── status retained + Last Will ────────────┘
```

---

## 📁 Estrutura do Repositório

```text
comp-dist/
├── docs/
│   └── requisitos.md                      # Especificação de Requisitos e Arquitetura
│
├── frontend/                              # Aplicação Frontend em React + TypeScript
│   ├── Dockerfile                         # Multi-stage com build Vite e servidor Nginx
│   ├── nginx.conf                         # Proxy e fallback para SPA
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── components/                    # Navbar, ProductGrid, CartDrawer, Modais
│       ├── context/                       # AuthContext e CartContext
│       └── services/api.ts                # Conexão unificada com o API Gateway
│
├── services/
│   ├── api-gateway/                       # API Gateway e Proxy Centralizado (Porta 8000)
│   │   ├── Dockerfile
│   │   └── src/server.ts
│   │
│   ├── users-service/                     # Autenticação e Perfis (Porta 3001)
│   │   ├── Dockerfile
│   │   ├── src/ (Auth, JWT, Bcrypt, Postgres)
│   │   └── tests/
│   │
│   ├── products-service/                  # Catálogo de Produtos e Estoque (Porta 3002)
│   │   ├── Dockerfile
│   │   ├── src/ (Mongoose, Busca, Categorias, Seed)
│   │   └── tests/
│   │
│   ├── orders-service/                    # Pedidos e Processamento de Checkout (Porta 3003)
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── clients/products.client.ts # Chamadas ao products-service via circuit breaker
│   │   │   ├── resilience/circuit-breaker.ts
│   │   │   ├── (Orders, Estoque, Postgres)
│   │   │   └── messaging/                 # Producer order.created + Consumer payment.*
│   │   │       ├── config.ts              # Exchanges, filas e routing keys
│   │   │       ├── events.ts              # Contratos dos eventos (DTO + Zod)
│   │   │       ├── broker.ts              # Cliente AMQP: topologia, retry, DLQ, reconexão
│   │   │       ├── order.publisher.ts     # Publica order.created
│   │   │       └── payment.consumer.ts    # Consome payment.approved / payment.rejected
│   │   └── tests/
│   │
│   ├── payments-service/                  # Pagamento Assíncrono (Porta 3004)
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── paypal/paypal.client.ts    # Cliente da API PayPal v2 (simulada) + circuit breaker
│   │   │   ├── resilience/                # Circuit breaker (mesmo arquivo do orders-service)
│   │   │   └── messaging/
│   │   │       ├── order.consumer.ts      # Consome order.created e cria a ordem PayPal
│   │   │       └── payment.publisher.ts   # Publica payment.approved / payment.rejected
│   │   └── tests/
│   │
│   ├── paypal-mock/                       # Simulador da API REST v2 do PayPal (Porta 3006)
│   │
│   ├── logistics-service/                 # Entregas + rastreamento IoT (Porta 3005)
│   │   └── src/
│   │       ├── iot/topics.ts              # Contrato de tópicos MQTT (igual no simulador)
│   │       ├── iot/fleet.gateway.ts       # Cliente MQTT: status, telemetria, eventos, despacho
│   │       ├── messaging/order.consumer.ts# Consome order.confirmed
│   │       └── services/shipment.service.ts
│   │
│   └── iot-simulator/                     # Frota de caminhões (GPS, temperatura, combustível) via MQTT
│
├── k8s/                                   # Manifestos Kubernetes declarativos (Kustomize)
│   ├── namespace.yaml
│   ├── configmaps/
│   ├── secrets/
│   ├── databases/ (PostgreSQL, MongoDB)
│   ├── messaging/ (RabbitMQ + painel de administração)
│   ├── iot/ (Mosquitto, iot-simulator)
│   ├── services/ (API Gateway, Users, Products, Orders, Payments, Frontend)
│   ├── ingress.yaml
│   └── kustomization.yaml
│
├── infra/mosquitto/mosquitto.conf         # Configuração do broker MQTT
├── docker-compose.yml                     # Orquestração local completa (13 contêineres)
├── package.json                           # Configuração do Workspace raiz
└── README.md
```

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- **Node.js** v20+ e **npm** v10+
- **Docker** e **Docker Compose**
- *(Opcional)* **Minikube** ou cluster **Kubernetes** com `kubectl`

---

### Opção 1: Execução Completa com Docker Compose (Recomendado)

Sobe todos os 13 contêineres automaticamente:
- PostgreSQL (5432)
- MongoDB (27017)
- **RabbitMQ (5672 / painel em 15672)**
- Users Service (3001)
- Products Service (3002)
- Orders Service (3003)
- **Payments Service (3004)**
- **PayPal Mock (3006)** — simulador, não fala com o PayPal real
- **Mosquitto MQTT (1883)**
- **Logistics Service (3005)**
- **IoT Simulator** (3 caminhões, sem porta)
- API Gateway (8000)
- Frontend React (3000)

```bash
# 1. Na raiz do projeto, compile e inicie todos os contêineres:
docker compose up --build -d

# 2. Acompanhe os logs em tempo real:
docker compose logs -f

# 3. Acesse a aplicação no navegador:
# http://localhost:3000

# 4. Painel de administração do RabbitMQ (usuário admin / senha admin):
# http://localhost:15672
```

---

### Opção 2: Execução Local em Modo Desenvolvedor (Hot Reload)

1. **Instale as dependências de todos os workspaces:**
   ```bash
   npm install
   ```

2. **Inicie os bancos de dados e o broker em segundo plano:**
   ```bash
   docker compose up -d postgres mongodb rabbitmq mosquitto
   ```

3. **Inicie os serviços do backend em terminais separados (ou use os scripts dedicados):**
   ```bash
   # Terminal 1 - API Gateway (Porta 8000)
   npm run gateway:dev

   # Terminal 2 - Users Service (Porta 3001)
   npm run users:dev

   # Terminal 3 - Products Service (Porta 3002)
   npm run products:dev

   # Terminal 4 - Orders Service (Porta 3003)
   npm run orders:dev

   # Terminal 5 - Payments Service (Porta 3004) + simulador PayPal (Porta 3006)
   npm run payments:dev
   npm run paypal-mock:dev

   # Terminal 6 - Logistics Service (Porta 3005) + frota IoT
   npm run logistics:dev
   npm run iot:dev
   ```

4. **Inicie o Frontend React (Porta 3000):**
   ```bash
   npm run frontend:dev
   ```
   Acesse: **`http://localhost:3000`**

---

### Opção 3: Implantação no Kubernetes (Minikube / Nuvem)

Deploy declarativo em comando único via Kustomize:

```bash
# 1. Iniciar minikube com suporte a ingress:
minikube start
minikube addons enable ingress

# 2. Aplicar todos os manifestos:
kubectl apply -k k8s/

# 3. Verificar pods em execução:
kubectl get pods -n districommerce -w
```

---

## 📨 Mensageria Assíncrona (RabbitMQ)

O pagamento do pedido **não** acontece dentro da requisição HTTP do checkout. O
`orders-service` grava o pedido como `PENDING`, publica o evento `order.created`
e responde `201` imediatamente. O `payments-service` consome o evento, processa
o pagamento e publica o resultado de volta, o que faz o pedido transicionar
para `CONFIRMED` ou `CANCELLED`.

### Topologia

Declarada de forma idempotente por ambos os serviços no boot
(`services/*/src/messaging/broker.ts`), então qualquer um pode subir primeiro:

| Objeto | Tipo | Função |
|---|---|---|
| `districommerce.events` | exchange `topic` | Exchange principal de eventos de domínio |
| `districommerce.retry` | exchange `topic` | Alimenta a fila de retentativa com TTL |
| `districommerce.dlx` | exchange `topic` | Dead Letter Exchange |
| `payments.order-created` | fila | Consumida pelo `payments-service` (`order.created`) |
| `payments.order-created.retry` | fila com TTL | Espera 5s e devolve a mensagem ao exchange principal |
| `orders.payment-processed` | fila | Consumida pelo `orders-service` (`payment.*`) |
| `orders.payment-processed.retry` | fila com TTL | Retentativa do consumidor de pagamentos do `orders-service` |
| `logistics.order-confirmed` | fila | Consumida pelo `logistics-service` (`order.confirmed`) |
| `logistics.order-confirmed.retry` | fila com TTL | Retentativa do `logistics-service` |
| `districommerce.dlq` | fila | Falhas terminais, preservadas para inspeção manual |

### Fluxo completo

```text
1. POST /api/v1/orders            -> orders-service grava o pedido como PENDING
2.                                -> publica order.created (publisher confirm)
3. RabbitMQ                       -> entrega na fila payments.order-created
4. payments-service               -> processa o pagamento (gateway simulado)
5a. sucesso                       -> publica payment.approved
5b. recusa por regra de negócio   -> publica payment.rejected
5c. falha transitória do gateway  -> lança erro, mensagem vai para a fila de retry
6. RabbitMQ                       -> entrega na fila orders.payment-processed
7. orders-service                 -> pedido vira CONFIRMED ou CANCELLED
8. Frontend                       -> badge do histórico atualiza (polling de 3s)
```

### Resiliência

- **Publisher confirms:** o publish só resolve quando o broker confirma o aceite.
- **Retentativa com atraso:** a falha no consumer republica a mensagem no
  `districommerce.retry`, cuja fila tem `x-message-ttl` de 5s e dead-letter de
  volta para o exchange principal. Até 3 tentativas (`RABBITMQ_MAX_RETRIES`).
- **Dead Letter Queue:** esgotadas as tentativas, a mensagem vai para
  `districommerce.dlq` com os headers `x-error-message` e `x-failed-service`.
- **Idempotência:** índice único em `payments.order_id` impede cobrança dupla
  numa reentrega *at-least-once*; o `UPDATE ... WHERE status = 'PENDING'` do
  `orders-service` impede transição de status repetida.
- **Reconexão automática:** queda do broker dispara reconexão com backoff
  exponencial e os consumidores são reatachados sozinhos.
- **Degradação controlada:** com o broker fora, o publish falha rápido e o
  checkout ainda responde `201`. O pedido fica `PENDING` e `/ready` do
  `orders-service` passa a responder `207 DEGRADED`.

### Gateway de pagamento

Desde as semanas 5-6 o pagamento passa pelo **PayPal simulado** (ver seção
própria abaixo). A falha transitória que aciona a retentativa vem do
`paypal-mock` (`PAYPAL_FAILURE_RATE`, padrão `0.1`); a recusa por valor
continua em `PAYMENT_MAX_AMOUNT` (padrão `50000`) no `payments-service`.

### Como demonstrar

```bash
# 1. Subir tudo:
docker compose up --build -d

# 2. Abrir o painel do RabbitMQ (admin / admin):
#    http://localhost:15672  -> aba "Queues"

# 3. Acompanhar os dois lados da fila:
docker compose logs -f orders-service payments-service

# 4. No frontend (http://localhost:3000): logar, adicionar ao carrinho,
#    finalizar o pedido e abrir "Meus Pedidos". Clicar em "Pagar com PayPal"
#    e aprovar. O badge vira "Confirmado" e a entrega começa a ser rastreada.

# 5. Demonstrar a retentativa: ligar o modo caos do PayPal simulado
curl -X POST localhost:3006/__admin/chaos -H 'Content-Type: application/json' -d '{"mode":"error"}'
#    Os logs do payments-service mostram "Reagendando em 5000ms" e a fila
#    payments.order-created.retry acumula mensagens no painel.

# 6. Demonstrar recusa definitiva: montar um carrinho acima de R$ 50.000.
#    O pedido vira CANCELLED, sem retentativa.

# 7. Demonstrar tolerância a falhas: parar o broker e finalizar um pedido.
docker compose stop rabbitmq     # checkout ainda responde 201, pedido fica PENDING
docker compose start rabbitmq    # serviços reconectam sozinhos
```

### Consultar pagamentos pela API

```bash
# Histórico de pagamentos do usuário autenticado:
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/payments/my-payments

# Pagamento de um pedido específico:
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/payments/order/$ORDER_ID
```

---

## 🛡️ Circuit Breaker

Implementação própria (sem dependência), no modelo do **Resilience4J**, em
`services/*/src/resilience/circuit-breaker.ts` — o mesmo arquivo no
`orders-service` e no `payments-service`.

```
CLOSED ──(taxa de falha ≥ 50% nas últimas 10 chamadas, mín. 5)──> OPEN
OPEN ──(10 s)──> HALF_OPEN ──(2 chamadas de teste OK)──> CLOSED
                     └──────(qualquer falha)──────────> OPEN
```

| Breaker | Onde | Protege | Fallback com o circuito aberto |
|---|---|---|---|
| `products-service` | `orders-service` | Reserva/devolução de estoque | Checkout segue sem reserva, na hora, sem esperar timeout |
| `paypal-gateway` | `payments-service` | OAuth, criar ordem, captura | `order.created` vai para a fila de retry sem chamada HTTP; aprovação responde **503** com o tempo para tentar de novo |

- **Timeout por chamada** (`CB_CALL_TIMEOUT_MS`, 3 s): lentidão conta como falha.
- **Erro de negócio não abre o circuito:** estoque insuficiente (409) e recusa
  do PayPal (4xx, ex. `INSTRUMENT_DECLINED`) significam que o serviço
  respondeu. Só rede, timeout e 5xx contam.
- **Observável:** `GET /circuit-breakers` e `/health` de cada serviço; o
  monitor do cluster no frontend mostra o estado ao vivo.
- **Combina com o retry do RabbitMQ:** o broker reentrega a mensagem e o
  breaker impede que cada reentrega martele o gateway caído.

Parâmetros: `CB_SLIDING_WINDOW_SIZE`, `CB_MINIMUM_CALLS`,
`CB_FAILURE_RATE_THRESHOLD`, `CB_RESET_TIMEOUT_MS`, `CB_HALF_OPEN_MAX_CALLS`,
`CB_CALL_TIMEOUT_MS`.

---

## 💳 Pagamento PayPal (simulado)

> **Não é uma integração real.** O contêiner `paypal-mock` imita o formato da
> API REST v2 do PayPal para o `payments-service` ter uma dependência externa
> de verdade (que cai, demora e falha). Nada sai para o PayPal, nenhum valor é
> cobrado e nenhum dado do comprador é coletado.

```text
1. order.created          -> payments-service: OAuth2 client credentials (POST /v1/oauth2/token)
2.                        -> POST /v2/checkout/orders  (PayPal-Request-Id: create-<pedido>)
3.                        -> pagamento PENDING_APPROVAL, pedido segue PENDING
4. Frontend               -> "Pagar com PayPal" abre a tela de checkout simulada
5a. Aprovar               -> simulate-approval + POST /v2/checkout/orders/:id/capture -> APPROVED -> payment.approved
5b. Simular recusa        -> capture responde 422 INSTRUMENT_DECLINED            -> REJECTED -> payment.rejected
5c. Cancelar              ->                                                       REJECTED -> payment.rejected
```

| Endpoint (via gateway) | Descrição |
|---|---|
| `POST /api/v1/payments/order/:orderId/paypal/approve` | Corpo `{"decision": "APPROVE" \| "DECLINE"}` |
| `POST /api/v1/payments/order/:orderId/paypal/cancel` | Comprador desistiu |
| `GET /api/v1/payments/my-payments` | Inclui `paypal_order_id` e `paypal_capture_id` |

- **Idempotência ponta a ponta:** `PayPal-Request-Id` derivado do pedido faz a
  reentrega do RabbitMQ devolver a mesma ordem; o `UPDATE ... WHERE status =
  'PENDING_APPROVAL'` impede captura dupla com dois cliques.
- **Modo caos do mock:** `POST localhost:3006/__admin/chaos` com
  `{"mode": "normal" | "error" | "slow", "failureRate": 0.3, "latencyMs": 500}`.

---

## 🚚 Logística com IoT (MQTT)

Pedido confirmado vira entrega: o `orders-service` publica `order.confirmed`,
o `logistics-service` abre a entrega, escolhe o caminhão online menos ocupado e
despacha por MQTT. Os caminhões (`iot-simulator`) publicam GPS, velocidade,
temperatura do baú e combustível a cada 2 s.

| Tópico | Direção | QoS | Observação |
|---|---|---|---|
| `districommerce/fleet/{id}/status` | caminhão → nuvem | 1 | **Retained** + **Last Will** (`online: false` quando cai sem aviso) |
| `districommerce/fleet/{id}/telemetry` | caminhão → nuvem | 0 | Alta frequência; perder uma leitura não importa |
| `districommerce/fleet/{id}/events` | caminhão → nuvem | 1 | `PICKED_UP`, `DELIVERED` |
| `districommerce/fleet/{id}/dispatch` | nuvem → caminhão | 1 | **Sessão persistente**: chega mesmo se o caminhão estava offline |

- **Escala horizontal:** telemetria e eventos usam *shared subscription*
  (`$share/logistics/...`), então duas réplicas dividem as mensagens sem
  processar em dobro.
- **Auto-recuperação:** caminhão que volta online recebe as entregas que
  estavam esperando (`AWAITING_TRUCK`) e as que ele perdeu ao reiniciar.
- **Alerta de sensor:** baú acima de `CARGO_TEMP_ALERT_C` (30 °C) gera evento
  `TEMPERATURE_ALERT` na linha do tempo da entrega.
- **Frontend:** "Meus Pedidos" mostra etapas, barra de progresso, mini-mapa da
  rota e leituras dos sensores, atualizando a cada 3 s.

| Endpoint (via gateway) | Descrição |
|---|---|
| `GET /api/v1/shipments/my-shipments` | Entregas do usuário |
| `GET /api/v1/shipments/order/:orderId` | Entrega + linha do tempo de eventos |
| `GET /api/v1/shipments/fleet` | Estado da frota em tempo real |

Roteiro passo a passo: **[docs/ROTEIRO-DE-TESTES-ENTREGA-3.md](docs/ROTEIRO-DE-TESTES-ENTREGA-3.md)**.

---

## 🧪 Execução de Testes Automatizados

A suíte de testes automatizados com Vitest e Supertest cobre validações, regras de autenticação JWT, cálculo e reserva atômica de estoque, o fluxo de pagamento assíncrono (publicação do evento, idempotência em reentrega, recusa por regra de negócio, falha transitória e checkout com o broker indisponível) e, desde as semanas 5-6, a máquina de estados do circuit breaker, o fluxo PayPal simulado e a logística IoT:

```bash
# Executar todos os testes de todos os serviços:
npm test
```

> Para validar a mensageria na prática (fila enchendo, retentativa, broker
> caindo), siga o **[Roteiro de Testes](docs/ROTEIRO-DE-TESTES.md)**.

---

## 💻 Demonstração das Funcionalidades no Frontend

Ao abrir `http://localhost:3000`, você terá acesso a:
1. **Monitor de Cluster Distribuído:** Barra superior que exibe o status de saúde em tempo real do API Gateway e dos nós de backend.
2. **Vitrine Dinâmica de Produtos:** Carregada automaticamente do MongoDB com busca por termos, filtros por categoria (Informática, Eletrônicos, Áudio, etc.) e ordenação por preço.
3. **Carrinho de Compras Interativo (Drawer):** Adição de produtos, controle de quantidade com bloqueio por limite de estoque disponível e cálculo automático do total.
4. **Autenticação Descentralizada (JWT):** Modal de login e cadastro com opção de alternar entre conta de **Cliente** e **Administrador**.
5. **Histórico de Pedidos com Status Assíncrono:** Após o checkout o pedido aparece como **"Processando pagamento"**. O modal reconsulta o `orders-service` a cada 3 segundos e o badge muda para **"Confirmado"** ou **"Pagamento recusado"** quando o `payments-service` responde pela fila — é a mensageria visível na interface.
5. **Painel do Administrador:** Usuários com `ROLE_ADMIN` visualizam o botão "Novo Produto", permitindo cadastrar novos itens diretamente no catálogo do MongoDB.
6. **Checkout e Histórico de Pedidos:** Finalização de compra que deduz o estoque no MongoDB e armazena o pedido com seus itens no PostgreSQL, consultável a qualquer momento no modal "Meus Pedidos".
