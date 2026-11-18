# Notificações em tempo real e LGPD

Duas funcionalidades novas: o cliente é **avisado na hora** sobre o andamento do pedido, e o titular exerce os
**direitos da LGPD** (acessar, corrigir, levar e excluir os próprios dados).

## 1. Notificações em tempo real

### Como funciona

```
 orders-service ─── order.created, order.confirmed ───┐
 payments-service ─ payment.approved / rejected ──────┤
 logistics-service ─ shipment.assigned / in_transit / │   RabbitMQ
                     delivered ───────────────────────┼─► exchange districommerce.events (topic)
 users-service ──── user.deleted ─────────────────────┘        │
                                                               ▼  fila notifications.events (retry + DLQ)
                                                     ┌──────────────────────┐
                                                     │ notifications-service │──► PostgreSQL
                                                     │  (porta 3007)         │    notifications, order_owners
                                                     └──────────┬───────────┘
                                                                │ Server-Sent Events (JWT no header)
                                          API Gateway ─► nginx ─► Caddy ─► navegador (sino + aviso na tela)
```

Os serviços que publicam **não sabem que o notifications-service existe**: cada um só publica o que aconteceu no seu
domínio. É o mesmo desacoplamento do restante da mensageria.

| Evento | Quem publica | Notificação para o cliente |
|---|---|---|
| `order.created` | orders-service | "Pedido recebido" |
| `payment.approved` | payments-service | "Pagamento aprovado" |
| `payment.rejected` | payments-service | "Pagamento recusado" (com o motivo) |
| `order.confirmed` | orders-service | "Pedido confirmado" |
| `shipment.assigned` | logistics-service | "Entrega despachada" |
| `shipment.in_transit` | logistics-service | "Pedido a caminho" |
| `shipment.delivered` | logistics-service | "Pedido entregue" |
| `user.deleted` | users-service | (nenhuma) apaga os dados do titular |

**Por que Server-Sent Events e não WebSocket?** A comunicação é só do servidor para o cliente. SSE usa HTTP comum,
passa por gateway, nginx e Caddy sem configuração de upgrade e reconecta sozinho. O cliente envia o JWT no header
`Authorization` (usando `fetch`, não `EventSource`), então o token **não aparece na URL** nem nos logs dos proxies.

### API (tudo exige JWT)

| Método e rota | O que faz |
|---|---|
| `GET /api/v1/notifications/stream` | Abre o canal SSE (eventos `ready` e `notification`) |
| `GET /api/v1/notifications?limit=30&unread=true` | Lista as do usuário e a contagem de não lidas |
| `POST /api/v1/notifications/:id/read` | Marca uma como lida |
| `POST /api/v1/notifications/read-all` | Marca todas como lidas |

Toda consulta é filtrada pelo usuário do token: ninguém lê nem marca a notificação de outra pessoa.

### Garantias e decisões

- **Sem duplicar:** cada notificação guarda o `eventId` do evento (`UNIQUE`). Se o broker reentregar, nada é duplicado.
- **Pagamento não traz `userId`:** o serviço guarda quem é o dono de cada pedido (tabela `order_owners`, vinda de
  `order.created`). Se o evento de pagamento chegar antes, o broker reagenda (retry) e, esgotadas as tentativas, vai
  para a DLQ.
- **Não perde o que aconteceu offline:** ao (re)conectar, o navegador recebe `ready` e lista de novo.
- **Falha de notificação não derruba a entrega:** o logistics-service publica os eventos de status em modo "melhor
  esforço" (se o RabbitMQ cair, a entrega segue normalmente).
- **Conexão viva:** o servidor manda um comentário SSE a cada 20 s, o nginx e o Caddy não seguram a resposta em buffer
  e a conexão fecha quando o token expira. Cada usuário pode ter até 5 abas abertas.
- **Pedidos atualizam na hora:** se "Meus pedidos" estiver aberto, a tela recarrega quando chega uma notificação.

### Limitação conhecida

As conexões SSE ficam na **memória do processo**. Com várias réplicas, o evento seria consumido por uma só e apenas os
clientes ligados a ela receberiam o aviso na hora (os outros veem ao reconectar). Por isso o `notifications-service`
roda com **1 réplica e sem HPA**. Para escalar seria preciso um fan-out entre réplicas (por exemplo, Redis Pub/Sub).

## 2. LGPD

### Direitos do titular (art. 18) implementados

| Direito | Onde | Como |
|---|---|---|
| Consentimento | Cadastro | Checkbox "Li e aceito a Política de Privacidade" (obrigatório). O servidor grava **quando** e **qual versão** |
| Transparência | Rodapé e cadastro | Política de Privacidade (dados, finalidades, base legal, retenção, direitos) |
| Acesso e portabilidade | Menu da conta, "Privacidade" | **Baixar meus dados**: JSON com conta, pedidos, pagamentos, entregas e notificações |
| Correção | Menu da conta, "Privacidade" | Editar o nome |
| Eliminação | Menu da conta, "Privacidade" | **Excluir minha conta**, pedindo a senha de novo |
| Minimização | notifications-service | Notificações com mais de 90 dias são apagadas sozinhas (a cada 6 h) |

### API

| Método e rota | O que faz |
|---|---|
| `POST /api/v1/auth/register` | Agora exige `acceptTerms: true` (nada de `"true"`, ausente ou `false`) |
| `GET /api/v1/users/me/export` | Dados da conta, consentimento e versão da política |
| `PUT /api/v1/users/profile` | Correção do nome (já existia) |
| `DELETE /api/v1/users/me` | Exclui a conta. Corpo: `{ "password": "..." }` |

### Como a exclusão funciona

1. Confere a senha (um token roubado não basta para apagar a conta).
2. Publica `user.deleted` no RabbitMQ. **Se o broker estiver fora, responde 503 e não apaga nada**, para não deixar a
   exclusão pela metade.
3. **Anonimiza** a conta: nome vira "Usuário removido", o e-mail vira `removido-<id>@anonimizado.invalid`, a senha vira
   um hash aleatório (login impossível) e o consentimento é limpo. O e-mail original fica livre para um novo cadastro.
4. O notifications-service, ao receber `user.deleted`, apaga as notificações e os vínculos de pedido do titular.

A linha do usuário **não é removida**, é anonimizada, porque pedidos e pagamentos antigos apontam para o `id` dela e
precisam ser guardados por obrigação legal e fiscal (LGPD, art. 16, I). Sem nome, e-mail e senha, esse `id` não
identifica mais ninguém.

### Pontos de atenção (limites desta entrega)

- **Token antigo continua válido até expirar (24 h).** O JWT é sem estado: depois da exclusão, o token emitido antes
  ainda é aceito pelos outros serviços (o users-service passa a responder 410 no perfil e o frontend encerra a sessão).
  Em produção, usar lista de revogação (por exemplo, Redis).
- **O evento `user.deleted` precisa de uma fila ligada.** Se o notifications-service nunca tiver subido, a mensagem não
  tem destino. A retenção de 90 dias limpa os dados de qualquer forma.
- **O e-mail de contato da Política de Privacidade** (`privacidade@districommerce.com`, em
  `frontend/src/components/PrivacyPolicyModal.tsx`) é apenas ilustrativo: o sistema não envia nem recebe e-mail, e a
  caixa pode não existir. Num cenário real, troque por um contato monitorado.
- **A versão da política** está em dois lugares que precisam andar juntos: `PRIVACY_POLICY_VERSION` no
  `users-service` (variável de ambiente) e no `PrivacyPolicyModal.tsx`.
- **Fora do escopo, mas relevante para a nota de segurança:** o cadastro aceita `role: "ROLE_ADMIN"` vindo do cliente,
  ou seja, qualquer pessoa pode se registrar como administradora (o script de carga e a demonstração dependem disso).

## 3. O que foi alterado no projeto

| Área | Mudança |
|---|---|
| Novo serviço | `services/notifications-service` (porta 3007): consumidor RabbitMQ, SSE, REST, métricas, testes |
| users-service | Consentimento no cadastro, `GET /users/me/export`, `DELETE /users/me`, publicador de eventos |
| logistics-service | Publica `shipment.assigned`, `shipment.in_transit` e `shipment.delivered` |
| api-gateway | Rota `/api/v1/notifications`, serviço novo no `/services`, métricas sem contar o SSE |
| Frontend | Sino, avisos na tela, checkbox de consentimento, política, central de privacidade |
| Infra | `docker-compose.yml` e `.prod.yml`, `ci.yml` (matriz e deploy), Prometheus, manifestos K8s, nginx e Caddy sem buffer para SSE |
| Testes | notifications-service (31), users-service (+11 de LGPD), logistics-service (+4) |
| k6 | O `register` do `districommerce.js` envia `acceptTerms: true` |

## 4. Como testar

Suba tudo (`docker compose up --build -d`) e abra http://localhost:3000.

1. **Consentimento:** em "Criar Cadastro", o botão fica desabilitado até marcar o aceite. Clique em "Política de
   Privacidade" para ler.
2. **Notificações ao vivo:** logado, faça um pedido e pague. O sino ganha o contador e aparecem avisos na tela:
   *Pedido recebido, Pagamento aprovado, Pedido confirmado, Entrega despachada, Pedido a caminho, Pedido entregue*.
3. **Pelo terminal** (substitua o token):
   ```bash
   curl -N -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/notifications/stream
   ```
4. **Exportar e excluir:** no menu da conta, "Privacidade". Depois de excluir, tentar entrar com o e-mail antigo falha, e
   no RabbitMQ (http://localhost:15672) a fila `notifications.events` mostra a mensagem `user.deleted` consumida.
5. **Os testes automatizados:** `npm test -w services/notifications-service`, `-w services/users-service`,
   `-w services/logistics-service`.
