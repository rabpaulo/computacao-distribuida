# Roteiro de Testes — Resiliência, Pagamento PayPal e Logística IoT (Semanas 5-6)

Este roteiro cobre o que entrou nas semanas 5-6:

1. **Circuit Breaker** nas chamadas HTTP entre serviços
2. **Pagamento via PayPal (simulado)**, com aprovação do comprador
3. **Logística com IoT**: caminhões publicando telemetria por **MQTT**

> O PayPal aqui é **de mentira**. O contêiner `paypal-mock` imita o formato da
> API REST v2 do PayPal (OAuth, criar ordem, capturar). Nenhuma chamada sai para
> o PayPal real, nenhum dinheiro é movimentado e nenhum dado do comprador é
> coletado.

---

## Antes de começar

```bash
docker compose up --build -d
docker compose ps        # 13 contêineres "running"
```

| O quê | Onde |
|---|---|
| Loja | http://localhost:3000 |
| RabbitMQ (admin / admin) | http://localhost:15672 |
| Circuit breakers do orders-service | http://localhost:3003/circuit-breakers |
| Circuit breakers do payments-service | http://localhost:3004/circuit-breakers |
| Estado do simulador PayPal | http://localhost:3006/health |
| Broker MQTT | `localhost:1883` |

Logs úteis:

```bash
docker compose logs -f payments-service paypal-mock
docker compose logs -f logistics-service iot-simulator
```

Para ver as mensagens MQTT cruas (precisa do cliente `mosquitto_sub`, ou use o
que já vem no contêiner):

```bash
docker compose exec mosquitto mosquitto_sub -v -t 'districommerce/fleet/#'
```

---

## Fluxo completo

```
Checkout ──> orders-service (PENDING) ──order.created──> payments-service
                                                            │ OAuth + POST /v2/checkout/orders
                                                            v        [circuit breaker]
                                                        paypal-mock ──> PAYER_ACTION_REQUIRED
                                                            │
  Frontend: "Pagar com PayPal" ──> POST /payments/order/:id/paypal/approve
                                                            │ simulate-approval + capture
                                                            v        [circuit breaker]
                                         payment.approved / payment.rejected
                                                            │
orders-service (CONFIRMED) ──order.confirmed──> logistics-service
                                                            │ MQTT dispatch (QoS 1)
                                                            v
                                                 iot-simulator (caminhão)
                                     telemetria QoS 0 a cada 2s + eventos QoS 1
                                                            │
                                         Frontend: mapa, progresso, temperatura
```

---

## Cenário 1 — Compra completa com PayPal e entrega rastreada

1. Faça login, adicione um produto e finalize o pedido.
2. Abra **"Meus Pedidos"**. O badge mostra **Processando pagamento** e, em
   ~1 segundo, **Aguardando pagamento** com o botão **Pagar com PayPal**.
3. Clique no botão. Abre a tela de checkout simulada.
4. Clique em **Aprovar pagamento**.

**Esperado:**

| Momento | Tela |
|---|---|
| Logo após aprovar | 🟢 **Confirmado** |
| ~1-2 s depois | Caixa azul de entrega: **Despachado**, caminhão `truck-0X` |
| ~5 s depois | **Em trânsito**: barra de progresso andando, velocidade, temperatura do baú, ETA |
| ~60 s depois | **Entregue** com horário |

**Logs:**

```
[payments-service] Pedido ...: ordem PayPal 5O19... criada, aguardando aprovação do comprador.
[paypal-mock] Ordem 5O19... aprovada pelo comprador (simulação: APPROVE)
[paypal-mock] Ordem 5O19... capturada (captura 3C67...)
[orders-service] Evento order.confirmed publicado para o pedido ...
[logistics-service] Entrega ... aberta para o pedido ...
[logistics-service] Despacho MQTT: entrega ... -> truck-02
[iot-simulator][truck-02] PICKED_UP - entrega ...
[iot-simulator][truck-02] DELIVERED - entrega ...
```

---

## Cenário 2 — Cartão recusado e cancelamento

1. Faça outro pedido e abra **Pagar com PayPal**.
2. Clique em **Simular cartão recusado**.

**Esperado:** o pedido vira 🔴 **Pagamento recusado** com o motivo
`PayPal recusou o meio de pagamento (INSTRUMENT_DECLINED)`. O estoque volta
para o catálogo (transação compensatória da entrega anterior).

Repita com **Cancelar e voltar à loja**: o motivo passa a ser
`pagamento cancelado pelo comprador no PayPal`.

---

## Cenário 3 — Circuit breaker abrindo (PayPal fora do ar)

**O cenário principal da resiliência.**

Configuração do breaker (`docker-compose.yml`): janela das últimas 10
chamadas, avalia a partir de 5, abre com **50% de falha**, fica aberto **10 s**,
timeout de **3 s** por chamada. No compose o `payments-service` faz até **5**
retentativas de 5 s, ~25 s no total, para dar tempo do circuito fechar.

1. Coloque o PayPal simulado em modo de falha:

   ```bash
   curl -X POST localhost:3006/__admin/chaos \
     -H 'Content-Type: application/json' -d '{"mode":"error"}'
   ```

2. Faça **3 pedidos seguidos**. Cada `order.created` tenta criar a ordem no
   PayPal, falha e vai para a fila de retry do RabbitMQ.
3. Acompanhe o breaker:

   ```bash
   watch -n1 'curl -s localhost:3004/circuit-breakers | jq ".circuitBreakers[]"'
   ```

**Esperado:**

```
[circuit-breaker] "paypal-gateway": CLOSED -> OPEN
[payments-service][rabbitmq] Falha ao processar order.created (tentativa 2/3):
    gateway PayPal indisponível (tentativa 2): circuit breaker aberto. Reagendando em 5000ms.
```

- Com o circuito **OPEN**, as tentativas falham **na hora**, sem fazer chamada
  HTTP. O contador `rejectedCalls` sobe e o log do `paypal-mock` fica parado.
- No frontend, abra **Inspecionar Topologia** na barra do cluster: o
  `payments-service` mostra `circuit breaker → paypal-gateway OPEN`.
- Se um pedido já estava em **Aguardando pagamento**, clicar em **Aprovar**
  devolve na tela: *Gateway PayPal temporariamente indisponível (circuit breaker
  aberto). Tente novamente em Xs.*

4. Volte o PayPal ao normal:

   ```bash
   curl -X POST localhost:3006/__admin/chaos \
     -H 'Content-Type: application/json' -d '{"mode":"normal"}'
   ```

**Esperado:** passados 10 s o breaker vai para **HALF_OPEN**, deixa passar
2 chamadas de teste e, com elas OK, volta para **CLOSED**. As mensagens que
estavam na fila de retry são processadas e os pedidos chegam a **Aguardando
pagamento** sozinhos.

```
[circuit-breaker] "paypal-gateway": OPEN -> HALF_OPEN
[circuit-breaker] "paypal-gateway": HALF_OPEN -> CLOSED
```

> Se as retentativas do RabbitMQ se esgotarem com o circuito aberto, a
> mensagem vai para a DLQ (comportamento da entrega anterior). Para a demo,
> volte o modo normal em até ~15 s depois do primeiro pedido.

### Variação: timeout em vez de erro

`{"mode":"slow"}` faz o mock demorar 10 s. O breaker corta cada chamada em 3 s
(`CallTimeoutError`) e conta como falha — mostra que **lentidão** também abre o
circuito, não só erro.

### Variação: parar o contêiner

```bash
docker compose stop paypal-mock    # conexão recusada = falha
docker compose start paypal-mock
```

---

## Cenário 4 — Circuit breaker do catálogo (orders → products)

1. `docker compose stop products-service`
2. Faça 3 pedidos com 2 produtos diferentes cada.

**Esperado:** as primeiras chamadas de reserva de estoque falham; depois de
5 falhas o breaker `products-service` do `orders-service` abre e o checkout
para de esperar timeout — o pedido é aceito pelo **fallback** (segue sem
reserva) em milissegundos.

```
[circuit-breaker] "products-service": CLOSED -> OPEN
[orders-service] Fallback: pedido segue sem reserva de "Mouse" (circuit breaker aberto)
```

Confira em http://localhost:3003/circuit-breakers.

3. `docker compose start products-service` — em ~10 s volta a CLOSED.

**Estoque insuficiente não abre o circuito:** HTTP 409 é regra de negócio
(o serviço respondeu), então não conta como falha. Se um item do pedido não
tem estoque, os itens anteriores que já foram reservados são devolvidos e o
checkout responde 409.

---

## Cenário 5 — Caminhão perde sinal (Last Will + sessão persistente)

1. Com uma entrega **Em trânsito**, derrube a frota sem desligamento limpo:

   ```bash
   docker compose kill iot-simulator
   ```

   **Esperado:** o próprio broker publica o *Last Will* `online: false` em
   `districommerce/fleet/truck-0X/status`. O log mostra
   `[logistics-service][mqtt] Caminhão truck-0X OFFLINE` e o contador de
   caminhões online do cluster cai.

2. Faça um pedido e pague. A entrega fica em **Aguardando caminhão
   disponível** (`AWAITING_TRUCK`).

3. `docker compose start iot-simulator`

   **Esperado:** os caminhões voltam `ONLINE`, a entrega em espera é
   despachada e as que estavam em trânsito são **redespachadas** (o caminhão
   reiniciou e perdeu a memória da rota):

   ```
   [logistics-service] Despacho MQTT: entrega ... -> truck-01
   ```

---

## Cenário 6 — Alerta de temperatura do baú

O sensor simula picos de temperatura com 3% de chance por leitura durante uma
viagem. Acima de **30 °C** (`CARGO_TEMP_ALERT_C`):

```
[logistics-service] ALERTA: baú do caminhão truck-01 a 33.4°C (entrega ...)
```

No frontend o valor de temperatura fica vermelho. Para forçar, suba
`TEMP_SPIKE_PROBABILITY` para `0.3` no `iot-simulator` e
`docker compose up -d iot-simulator`.

---

## Tópicos MQTT e QoS

| Tópico | Direção | QoS | Retained | Por quê |
|---|---|---|---|---|
| `districommerce/fleet/{id}/status` | caminhão → nuvem | 1 | sim | Quem conecta depois já sabe quem está online. Também é o tópico do Last Will |
| `districommerce/fleet/{id}/telemetry` | caminhão → nuvem | 0 | não | Chega a cada 2 s; perder uma leitura não importa |
| `districommerce/fleet/{id}/events` | caminhão → nuvem | 1 | não | Coleta/entrega mudam estado, não podem se perder |
| `districommerce/fleet/{id}/dispatch` | nuvem → caminhão | 1 | não | Fica guardado na sessão persistente se o caminhão estiver offline |

O `logistics-service` assina telemetria e eventos com **shared subscription**
(`$share/logistics/...`): com 2 réplicas no Kubernetes, cada leitura é
processada por uma réplica só.

---

## Testes automatizados

```bash
npm install
npm test
```

| Serviço | Testes | Cobre |
|---|---|---|
| `users-service` | 9 | cadastro, login, JWT |
| `products-service` | 9 | catálogo, reserva atômica de estoque |
| `orders-service` | 23 | checkout, eventos, compensação de estoque, **circuit breaker** (estados, timeout, half-open, erro de negócio), `order.confirmed` |
| `payments-service` | 14 | ordem PayPal, aprovação, recusa, cancelamento, idempotência, **503 com breaker aberto** |
| `paypal-mock` | 6 | OAuth, criar/aprovar/capturar, recusa, idempotência por `PayPal-Request-Id`, caos |
| `logistics-service` | 8 | abertura e despacho de entrega, idempotência, entrega concluída, alerta de temperatura |
| `iot-simulator` | 5 | rota, haversine, sensor de temperatura |

---

## Ajustes

| Variável | Serviço | Padrão | Efeito |
|---|---|---|---|
| `CB_FAILURE_RATE_THRESHOLD` | orders, payments | `0.5` | Taxa de falha que abre o circuito |
| `CB_MINIMUM_CALLS` | orders, payments | `5` | Chamadas mínimas na janela antes de avaliar |
| `CB_RESET_TIMEOUT_MS` | orders, payments | `10000` | Tempo em OPEN antes do HALF_OPEN |
| `CB_CALL_TIMEOUT_MS` | orders, payments | `3000` | Timeout por chamada (conta como falha) |
| `PAYPAL_LATENCY_MS` | paypal-mock | `800` | Latência simulada do PayPal |
| `PAYPAL_FAILURE_RATE` | paypal-mock | `0.1` | Chance de 503 aleatório (aciona retry do RabbitMQ) |
| `PAYMENT_MAX_AMOUNT` | payments | `50000` | Acima disso recusa sem falar com o PayPal |
| `RABBITMQ_MAX_RETRIES` | payments | `5` | Retentativas do `order.created` antes da DLQ |
| `FLEET_SIZE` | iot-simulator | `3` | Quantidade de caminhões |
| `TRIP_DURATION_S` | iot-simulator | `60` | Duração de cada viagem |
| `TEMP_SPIKE_PROBABILITY` | iot-simulator | `0.03` | Chance de pico de temperatura por leitura |

---

## Limitações conhecidas

- **Fallback sem reserva:** com o `products-service` fora, o pedido é aceito
  sem baixar estoque (comportamento herdado da entrega 1, agora explícito como
  fallback do breaker). Se esse pedido for recusado depois, a devolução de
  estoque soma unidades que nunca saíram.
- **Ordem PayPal sem expiração:** um pedido em *Aguardando pagamento* fica
  assim até o comprador agir. O PayPal real expira a ordem; o mock não.
- **Estado do mock em memória:** reiniciar o `paypal-mock` perde as ordens
  criadas. Aprovar um pedido criado antes do restart resulta em recusa
  (`INVALID_RESOURCE_ID`).
- **Volta ao CD instantânea:** depois de uma entrega o caminhão "teleporta" de
  volta ao centro de distribuição para a próxima.
- **Mosquitto sem autenticação:** só para a demo. Em produção: usuário/senha
  por caminhão, ACL por tópico e TLS na porta 8883.
