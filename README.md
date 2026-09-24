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
+---------+----------+      +---------+----------+      +---------+----------+
          |                           |                           |
          v                           v                           v
+--------------------+      +--------------------+      +--------------------+
|  PostgreSQL (ACID) |      |   MongoDB (NoSQL)  |      |  PostgreSQL (ACID) |
|    (Porta 5432)    |      |   (Porta 27017)    |      |    (Porta 5432)    |
+--------------------+      +--------------------+      +--------------------+
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
│   └── orders-service/                    # Pedidos e Processamento de Checkout (Porta 3003)
│       ├── Dockerfile
│       ├── src/ (Orders, Estoque, Postgres)
│       └── tests/
│
├── k8s/                                   # Manifestos Kubernetes declarativos (Kustomize)
│   ├── namespace.yaml
│   ├── configmaps/
│   ├── secrets/
│   ├── databases/ (PostgreSQL, MongoDB)
│   ├── services/ (API Gateway, Users, Products, Orders, Frontend)
│   ├── ingress.yaml
│   └── kustomization.yaml
│
├── docker-compose.yml                     # Orquestração local completa (7 contêineres)
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

Sobe todos os 7 contêineres automaticamente:
- PostgreSQL (5432)
- MongoDB (27017)
- Users Service (3001)
- Products Service (3002)
- Orders Service (3003)
- API Gateway (8000)
- Frontend React (3000)

```bash
# 1. Na raiz do projeto, compile e inicie todos os contêineres:
docker compose up --build -d

# 2. Acompanhe os logs em tempo real:
docker compose logs -f

# 3. Acesse a aplicação no navegador:
# http://localhost:3000
```

---

### Opção 2: Execução Local em Modo Desenvolvedor (Hot Reload)

1. **Instale as dependências de todos os workspaces:**
   ```bash
   npm install
   ```

2. **Inicie os bancos de dados em segundo plano:**
   ```bash
   docker compose up -d postgres mongodb
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

## 🧪 Execução de Testes Automatizados

A suíte de testes automatizados com Vitest e Supertest cobre validações, regras de autenticação JWT, cálculo e reserva atômica de estoque:

```bash
# Executar todos os testes de todos os serviços:
npm test
```

---

## 💻 Demonstração das Funcionalidades no Frontend

Ao abrir `http://localhost:3000`, você terá acesso a:
1. **Monitor de Cluster Distribuído:** Barra superior que exibe o status de saúde em tempo real do API Gateway e dos nós de backend.
2. **Vitrine Dinâmica de Produtos:** Carregada automaticamente do MongoDB com busca por termos, filtros por categoria (Informática, Eletrônicos, Áudio, etc.) e ordenação por preço.
3. **Carrinho de Compras Interativo (Drawer):** Adição de produtos, controle de quantidade com bloqueio por limite de estoque disponível e cálculo automático do total.
4. **Autenticação Descentralizada (JWT):** Modal de login e cadastro com opção de alternar entre conta de **Cliente** e **Administrador**.
5. **Painel do Administrador:** Usuários com `ROLE_ADMIN` visualizam o botão "Novo Produto", permitindo cadastrar novos itens diretamente no catálogo do MongoDB.
6. **Checkout e Histórico de Pedidos:** Finalização de compra que deduz o estoque no MongoDB e armazena o pedido com seus itens no PostgreSQL, consultável a qualquer momento no modal "Meus Pedidos".
