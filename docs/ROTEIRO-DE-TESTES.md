# Roteiro de Testes — Mensageria Assíncrona (Entrega 2)

Guia para validar a integração com RabbitMQ sem precisar conhecer o código.
Cada cenário diz o que fazer, o que deve acontecer e onde olhar.

---

## Antes de começar

**Precisa ter:** Docker Desktop instalado e rodando (ícone da baleia verde).

```bash
cd computacao-distribuida
docker compose up --build -d
```

A primeira vez demora 10-15 minutos. Depois sobe em segundos.

Confira se os 9 containers estão de pé:

```bash
docker compose ps
```

Todos devem aparecer como `running`.

### Onde olhar

| O quê | Endereço | Login |
|---|---|---|
| Loja | http://localhost:3000 | `admin@admin.com` / `admin123` |
| Painel do RabbitMQ | http://localhost:15672 | `admin` / `admin` |

> Se o login não existir, cadastre pelo site. Qualquer e-mail fictício serve,
> não há validação. A senha precisa ter 6 caracteres ou mais. Marque
> **Administrador** se quiser cadastrar produtos.

### Acompanhar os logs

Deixe rodando em um terminal separado durante os testes:

```bash
docker compose logs -f orders-service payments-service
```

---

## Como funciona (resumo)

```
Cliente finaliza o pedido
        |
        v
orders-service grava como PENDING e responde na hora
        |
        | publica "order.created"
        v
   [ RabbitMQ ]
        |
        v
payments-service processa o pagamento
        |
        | publica "payment.approved" ou "payment.rejected"
        v
   [ RabbitMQ ]
        |
        v
orders-service muda o pedido para CONFIRMED ou CANCELLED
```

O ponto principal: **os dois serviços nunca se chamam diretamente**. Toda a
conversa passa pela fila. É isso que permite um cair sem derrubar o outro.

---

## Cenário 1 — Pagamento aprovado

**O básico. Comece por aqui.**

1. Entre em http://localhost:3000 e faça login
2. Adicione qualquer produto ao carrinho (valor abaixo de R$ 50.000)
3. Finalize o pedido
4. Abra **"Meus Pedidos"**

**Esperado:**

| Momento | Badge |
|---|---|
| Logo após finalizar | 🟡 **Processando pagamento** |
| Depois de ~2 segundos | 🟢 **Confirmado** |

A tela atualiza sozinha, sem recarregar a página.

**Nos logs:**

```
[orders-service] Evento order.created publicado para o pedido ...
[payments-service] Processando pagamento do pedido ... (tentativa 1)
[payments-service] Evento payment.approved publicado ...
[orders-service] Pedido ... atualizado para CONFIRMED
```

---

## Cenário 2 — Pagamento recusado

**Mostra que a recusa também é decidida pela fila, não no checkout.**

O limite autorizado é **R$ 50.000**. Para passar dele:

1. Adicione **6 unidades do Notebook Dell XPS** (6 × R$ 11.499,90 = R$ 68.999,40)
2. Finalize o pedido

**Esperado:**

| Momento | Badge |
|---|---|
| Logo após finalizar | 🟡 **Processando pagamento** |
| Depois de ~2 segundos | 🔴 **Pagamento recusado** |

**Importante:** confira o estoque do notebook antes e depois. Ele cai quando
você finaliza e **volta** quando o pagamento é recusado. Essa devolução é uma
transação compensatória — sem ela o produto ficaria preso num pedido que nunca
se concretizou.

---

## Cenário 3 — Retentativa automática

**Mostra o sistema se recuperando de falha sozinho.**

O `payments-service` simula um gateway instável: **30% dos pagamentos falham**
de propósito na primeira tentativa. Quando isso acontece, a mensagem volta pra
fila e é reprocessada 5 segundos depois, até 3 vezes.

1. Faça **5 ou 6 pedidos seguidos** (produto barato, valor não importa)
2. Observe os logs

**Esperado** — em algum deles vai aparecer:

```
[payments-service] Falha ao processar order.created (tentativa 1/3):
    gateway de pagamento indisponivel. Reagendando em 5000ms.
[payments-service] Processando pagamento do pedido ... (tentativa 2)
[payments-service] Evento payment.approved publicado ...
```

O pedido demora mais pra confirmar, mas **confirma**. Ninguém precisou intervir.

No painel do RabbitMQ, a fila `payments.order-created.retry` fica com 1
mensagem durante esses 5 segundos.

---

## Cenário 4 — Serviço de pagamento cai

**Este é o cenário mais importante da entrega. É o que justifica usar fila.**

1. Derrube o serviço de pagamentos:

   ```bash
   docker compose stop payments-service
   ```

2. No site, faça **5 pedidos**. Todos respondem normalmente e ficam em
   🟡 **Processando pagamento**

3. Abra o painel do RabbitMQ → aba **"Queues and Streams"**

   A fila `payments.order-created` mostra:

   | Ready | Consumers |
   |---|---|
   | **5** | **0** |

   As mensagens estão guardadas. Ninguém para consumir, mas **nada se perdeu**.

4. Clique na fila `payments.order-created` → desça até **"Get messages"** →
   **"Get Message(s)"**. Aparece o JSON do evento com `orderId`, `userId`,
   `totalAmount` e os itens.

5. Religue o serviço:

   ```bash
   docker compose start payments-service
   ```

6. Atualize o painel e olhe o site

**Esperado:** a fila esvazia em poucos segundos (5 → 0) e todos os pedidos
viram 🟢 **Confirmado** sozinhos.

> **A frase da apresentação:** *"o serviço de pagamento ficou fora do ar, mas
> nenhum pedido se perdeu — o broker segurou tudo e reprocessou quando ele
> voltou."*

### Dica para ficar visível

O painel atualiza a cada 5 segundos no mínimo (não existe opção de 1 segundo),
e uma mensagem leva só ~2 segundos pra ser processada. Por isso, no fluxo
normal, você nunca pega a fila com mensagem dentro.

Para a apresentação, **derrube o consumidor e faça vários pedidos** — aí a
fila enche de verdade e dá pra mostrar.

---

## Cenário 5 — Broker cai

**Mostra que a loja continua funcionando mesmo sem a fila.**

1. Derrube o RabbitMQ:

   ```bash
   docker compose stop rabbitmq
   ```

2. Verifique a saúde do serviço de pedidos:

   ```bash
   curl http://localhost:3003/ready
   ```

   **Esperado:** HTTP **207** com `"status":"DEGRADED"` e
   `"messaging":"DISCONNECTED"`

3. Faça um pedido no site

   **Esperado:** o checkout **responde normalmente**. O pedido fica em
   🟡 **Processando pagamento** e não trava.

   > Isso é proposital: o pedido já está salvo, e derrubar a compra do cliente
   > porque o broker caiu seria pior do que deixar o pagamento para depois.

4. Religue:

   ```bash
   docker compose start rabbitmq
   ```

5. Espere ~30 segundos e verifique de novo:

   ```bash
   curl http://localhost:3003/ready
   ```

   **Esperado:** volta para HTTP **200** / `"status":"READY"`

**Nos logs:** `Conexão encerrada pelo broker. Reconectando...` seguido de
`Conectado e topologia declarada.` Ninguém reiniciou nada na mão.

---

## Cenário 6 — Dead Letter Queue

**Mostra o que acontece quando nem a retentativa resolve.**

Se um pagamento falhar as 3 tentativas, a mensagem vai para a
`districommerce.dlq` em vez de ficar rodando em círculo pra sempre.

Isso acontece naturalmente de vez em quando (0,3⁴ ≈ 1% de chance por pedido).
Para forçar, suba a taxa de falha para 100%:

```bash
docker compose stop payments-service
```

Edite o `docker-compose.yml`, na seção `payments-service`:

```yaml
PAYMENT_FAILURE_RATE: 1
```

```bash
docker compose up -d payments-service
```

Faça 1 pedido e espere ~20 segundos.

**Esperado** nos logs:

```
Falha ao processar order.created (tentativa 1/3) ... Reagendando em 5000ms
Falha ao processar order.created (tentativa 2/3) ... Reagendando em 5000ms
Falha ao processar order.created (tentativa 3/3) ... Reagendando em 5000ms
Falha definitiva em order.created após 3 retentativas. Enviando para districommerce.dlq.
```

No painel, a fila `districommerce.dlq` fica com 1 mensagem. Clique nela →
**"Get messages"** → veja os headers:

| Header | Conteúdo |
|---|---|
| `x-error-message` | o motivo da falha |
| `x-failed-service` | qual serviço desistiu |
| `x-failed-at` | quando |
| `x-retry-count` | quantas tentativas |

**Não esqueça de voltar** `PAYMENT_FAILURE_RATE` para `0.3` depois.

> **Limitação conhecida:** um pedido que cai na DLQ fica em `PENDING` para
> sempre. A DLQ existe justamente para que alguém olhe e decida o que fazer,
> mas não há hoje nenhuma rotina que resolva isso automaticamente.

---

## Testes automatizados

Não precisam de Docker. Rodam direto:

```bash
npm install
npm test --workspaces
```

**Esperado:** 37 testes passando.

| Serviço | Testes | Cobre |
|---|---|---|
| `users-service` | 9 | cadastro, login, JWT |
| `products-service` | 9 | catálogo, reserva atômica de estoque |
| `orders-service` | 11 | checkout, publicação do evento, devolução de estoque, broker fora |
| `payments-service` | 8 | aprovação, recusa, falha transitória, idempotência |

---

## Ajustes para a demonstração

Dá pra mudar o comportamento do gateway simulado pelo `docker-compose.yml`,
na seção `payments-service`:

| Variável | Padrão | Para quê |
|---|---|---|
| `PAYMENT_LATENCY_MS` | `2000` | Latência do gateway. Suba para 8000 se quiser tempo de mostrar o PENDING na tela |
| `PAYMENT_FAILURE_RATE` | `0.3` | Chance de falha. Use `0` para demo previsível, `1` para forçar a DLQ |
| `PAYMENT_MAX_AMOUNT` | `50000` | Limite da recusa. Abaixe para `1000` se quiser recusar compras pequenas |
| `RABBITMQ_MAX_RETRIES` | `3` | Tentativas antes da DLQ |
| `RABBITMQ_RETRY_DELAY_MS` | `5000` | Espera entre tentativas |

Depois de mudar:

```bash
docker compose up -d payments-service
```

---

## Problemas comuns

**Os containers não sobem**
Docker Desktop precisa estar aberto e com o ícone verde. No Windows, exige
virtualização habilitada na BIOS (nas placas AMD a opção chama **SVM Mode**).

**O pedido fica em PENDING e não sai**
O `payments-service` provavelmente está parado. Confira com `docker compose ps`
e veja os logs com `docker compose logs payments-service`.

**O painel do RabbitMQ não abre**
Use a porta **15672**, não a 5672. A 5672 é o protocolo AMQP, não tem tela.

**A loja não mostra produtos**
O catálogo é populado automaticamente no primeiro boot do `products-service`.
Se estiver vazio, reinicie com `docker compose restart products-service`.

**Quero zerar tudo e começar do começo**

```bash
docker compose down -v    # o -v apaga também os bancos
docker compose up --build -d
```

---

## Desligar

```bash
docker compose down
```

Os dados ficam salvos. Para apagar os bancos junto, use `docker compose down -v`.
