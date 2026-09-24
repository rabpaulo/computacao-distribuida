# Especificação de Requisitos e Arquitetura - Plataforma DistriCommerce

## 1. Introdução e Visão Geral do Sistema

O **DistriCommerce** é uma plataforma distribuída de comércio eletrônico (e-commerce) projetada para alta disponibilidade, escalabilidade horizontal, desacoplamento e tolerância a falhas. 

O sistema foi concebido segundo os princípios fundamentais de **Sistemas Distribuídos**, adotando uma arquitetura de microsserviços em **TypeScript** (Node.js), persistência poliglota especializada (PostgreSQL para dados relacionais e ACID, MongoDB para catálogo de produtos flexível), conteinerização com **Docker** e orquestração via **Kubernetes**.

---

## 2. Requisitos de Sistemas Distribuídos

O DistriCommerce atende aos desafios clássicos de engenharia de software distribuído:

### 2.1 Escalabilidade Horizontal (Scale-Out)
- **Desacoplamento de Estado (Stateless Services):** Todos os serviços de backend são rigorosamente *stateless*. As sessões de usuários não são mantidas na memória dos processos da aplicação; a autenticação é fundamentada em tokens criptografados **JWT (JSON Web Tokens)** assinados.
- **Auto-escalonamento com Kubernetes:** Cada microsserviço é implantado em pods gerenciados por *Deployments* e balanceados por *Services* internos. As réplicas podem escalar dinamicamente via *Horizontal Pod Autoscaler* (HPA) com base em métricas de CPU e consumo de memória.

### 2.2 Tolerância a Falhas e Resiliência
- **Autocura (Self-Healing):** O orquestrador Kubernetes monitora continuamente a integridade dos processos por meio de **Liveness Probes** (para reinício automático de contêineres em pane) e **Readiness Probes** (para direcionar tráfego somente quando as dependências de banco de dados estiverem operacionais).
- **Graceful Shutdown:** Os servidores interceptam sinais de término (`SIGTERM`, `SIGINT`), suspendendo a recepção de novas conexões, finalizando as requisições em andamento e encerrando pools de conexão com os bancos de dados de forma ordenada.
- **Fail-Fast e Validação na Borda:** Todas as entradas de requisições são validadas de forma síncrona com esquemas rigorosos (Zod), rejeitando requisições malformadas imediatamente antes de tocar as camadas de persistência.

### 2.3 Persistência Poliglota e Particionamento de Dados (Database-per-Service)
- Cada microsserviço possui e controla exclusivamente a sua própria base de dados (padrão *Database-per-Service*):
  - **Serviço de Usuários:** Utiliza **PostgreSQL**, garantindo atomicidade, consistência e restrições estritas (unicidade de e-mail, integridade de credenciais).
  - **Serviço de Produtos:** Utiliza **MongoDB**, permitindo documentos semi-estruturados para atributos variáveis de produtos, tags e buscas eficientes.
- Nenhum serviço acessa diretamente o banco de dados de outro serviço; toda interação inter-serviços ocorre estritamente via APIs de rede (REST/gRPC/mensageria).

---

## 3. Requisitos Funcionais (RF)

### Módulo: Usuários e Autenticação (`users-service`)
- **[RF01] Cadastro de Usuários:** O sistema deve permitir que novos usuários se cadastrem fornecendo nome, e-mail válido e senha segura (mínimo de 6 caracteres). O e-mail deve ser único no sistema.
- **[RF02] Criptografia de Credenciais:** O sistema deve armazenar as senhas dos usuários utilizando hashing unidirecional seguro com salt (algoritmo bcrypt).
- **[RF03] Autenticação e Emissão de Token:** O sistema deve autenticar o usuário validando e-mail e senha, retornando um token de acesso JWT com tempo de expiração determinado contendo o identificador do usuário e suas permissões (roles).
- **[RF04] Consulta de Perfil:** Um usuário autenticado deve conseguir consultar seus próprios dados de perfil através de uma rota protegida.
- **[RF05] Atualização de Perfil:** O usuário autenticado deve conseguir atualizar seus dados cadastrais (como nome).
- **[RF06] Controle de Acesso Baseado em Perfis (RBAC):** O sistema deve suportar papéis de acesso diferenciados, especificamente `ROLE_CUSTOMER` (cliente padrão) e `ROLE_ADMIN` (administrador do sistema).

### Módulo: Catálogo de Produtos (`products-service`)
- **[RF07] Cadastro de Produtos:** Usuários com perfil administrativo (`ROLE_ADMIN`) devem poder cadastrar novos produtos informando nome, descrição, preço (valor positivo), categoria, quantidade em estoque inicial, imagens e atributos opcionais.
- **[RF08] Consulta e Listagem Paginada:** Qualquer cliente (autenticado ou anônimo) deve poder listar os produtos cadastrados com paginação controlada (`page`, `limit`).
- **[RF09] Filtro e Busca de Produtos:** A listagem deve permitir filtros opcionais por categoria, faixa de preço e busca textual por termos contidos no nome ou descrição do produto.
- **[RF10] Detalhes do Produto:** O sistema deve fornecer os dados completos de um produto específico através de seu identificador único.
- **[RF11] Atualização de Produtos:** Usuários com perfil administrativo devem poder alterar informações de produtos existentes (descrição, preço, categoria, etc.).
- **[RF12] Exclusão de Produtos:** Usuários com perfil administrativo devem poder excluir produtos do catálogo.
- **[RF13] Atualização e Reserva de Estoque:** O sistema deve expor um endpoint específico para ajuste/reserva atômica de unidades em estoque, permitindo incremento ou decremento seguro.

---

## 4. Requisitos Não-Funcionais (RNF)

- **[RNF01] Desempenho e Latência:** O tempo médio de resposta para leitura em endpoints de catálogo e perfil não deve exceder 200ms em condições normais de operação.
- **[RNF02] Segurança e Conformidade:**
  - Todas as senhas devem ser protegidas com hash e salt via `bcryptjs`.
  - Os tokens JWT devem ser assinados criptograficamente com algoritmos seguros (HMAC SHA-256) e possuir expiração configurável.
  - Headers HTTP de segurança devem ser aplicados (Helmet, CORS restritivo).
  - Execução dos contêineres Docker sob usuário sem privilégios de root (`node`).
- **[RNF03] Observabilidade e Saúde do Sistema:**
  - Cada microsserviço deve expor os endpoints `/health` (verificação de vivacidade da aplicação) e `/ready` (verificação de conectividade com as bases de dados e dependências).
  - Logs estruturados e informativos para facilitar auditoria e agregação futura em ELK ou Loki.
- **[RNF04] Portabilidade e Padronização de Infraestrutura:**
  - Todas as dependências e serviços devem ser executáveis através de `docker compose` em qualquer sistema operacional com Docker instalado.
  - Manifestos do Kubernetes devem ser declarativos, compatíveis com a API padrão do Kubernetes (v1/apps) e utilizáveis em Minikube, Kind ou nuvens públicas (AWS EKS / Azure AKS).
- **[RNF05] Manutenibilidade e Qualidade de Código:**
  - Todo o código fonte em **TypeScript 5.x** sob o modo estrito (`"strict": true`).
  - Arquitetura em camadas com separação clara de responsabilidades: *Controllers*, *Services*, *Models*, *Routes* e *Middlewares*.
  - Suíte de testes automatizados com cobertura para os fluxos principais de negócio e validações.

---

## 5. Arquitetura do Sistema e Modelo de Dados

### 5.1 Diagrama de Arquitetura da Entrega 1

```
                         +-----------------------------------+
                         |         Cliente HTTP / Postman    |
                         +-----------------+-----------------+
                                           |
                                 (Porta 80 / Ingress)
                                           |
                    +----------------------+----------------------+
                    |                                             |
             (Tráfego de Usuários)                       (Tráfego de Produtos)
             /api/v1/auth, /api/v1/users                 /api/v1/products
                    |                                             |
                    v                                             v
        +-----------------------+                     +-----------------------+
        |     users-service     |                     |   products-service    |
        |  (Node.js/TypeScript) |                     |  (Node.js/TypeScript) |
        |      Porta: 3001      |                     |      Porta: 3002      |
        +-----------+-----------+                     +-----------+-----------+
                    |                                             |
           (Driver PostgreSQL)                            (Driver Mongoose)
                    v                                             v
        +-----------------------+                     +-----------------------+
        |   PostgreSQL (ACID)   |                     |    MongoDB (NoSQL)    |
        |      Porta: 5432      |                     |      Porta: 27017     |
        |      Banco: users     |                     |    Banco: products    |
        +-----------------------+                     +-----------------------+
```

### 5.2 Modelo de Dados: Serviço de Usuários (PostgreSQL)

Tabela `users`:
```sql
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(190) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'ROLE_CUSTOMER',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

### 5.3 Modelo de Dados: Serviço de Produtos (MongoDB)

Coleção `products`:
```json
{
  "_id": "ObjectId('...')",
  "name": "Smartphone DistriPro 5G",
  "description": "Processador octa-core, 8GB RAM, 128GB",
  "price": 1899.99,
  "category": "Eletrônicos",
  "stock": 45,
  "active": true,
  "images": [
    "https://img.districommerce.local/products/p1-front.jpg"
  ],
  "attributes": {
    "marca": "DistriTech",
    "cor": "Preto Titânio",
    "garantia_meses": 12
  },
  "createdAt": "2026-09-23T18:00:00.000Z",
  "updatedAt": "2026-09-23T18:00:00.000Z"
}
```

---

## 6. Próximas Entregas e Evolução da Plataforma

- **Semanas 3-4:** Implementação do API Gateway centralizado, Mensageria assíncrona (RabbitMQ/Kafka) e Frontend Cliente em React.
- **Semanas 5-6:** Resiliência com Circuit Breaker, Pagamento assíncrono e Rastreamento de entregas IoT via MQTT.
- **Semana 7:** Pipeline de CI/CD (GitHub Actions), Monitoramento Prometheus/Grafana e Testes de Carga.
- **Semana 8:** Documentação final consolidada e demonstração completa.
