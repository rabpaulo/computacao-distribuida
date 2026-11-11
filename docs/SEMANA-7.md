# Semana 7: CI/CD, Monitoramento e Testes de Carga

## Resumo do que foi feito

| Item | Entrega | Onde |
|---|---|---|
| CI/CD | Pipeline GitHub Actions: build, testes e publicação das imagens Docker no GHCR | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| Monitoramento | Endpoint `/metrics` em 6 serviços, Prometheus, Grafana e dashboard provisionado | `services/*/src/metrics.ts`, `infra/prometheus/`, `infra/grafana/`, `docker-compose.yml` |
| Testes de carga | Script k6 com perfis `smoke`, `load` e `stress` | `loadtest/k6/districommerce.js` |

## Como executar o projeto e os testes

Pré-requisitos: Docker Desktop ligado, Node.js 20+ e npm 10+.

### Testes unitários e build (os mesmos passos do CI)

```bash
npm ci               # instala as dependências de todos os workspaces
npm run build        # compila serviços e frontend
npm test             # roda os testes de todos os workspaces
npm test -w services/products-service   # apenas um serviço
```

Os testes unitários usam mocks e não precisam de banco ou Docker.

### Subir a stack completa

```bash
docker compose up --build -d
docker compose ps           # todos devem estar running/healthy
docker compose down         # para tudo (adicione -v para apagar os volumes)
```

### Verificação rápida (checklist)

1. `curl http://localhost:8000/metrics` retorna texto com `http_requests_total`.
2. Prometheus em http://localhost:9090/targets: 6 alvos `districommerce` em **UP**.
3. Grafana em http://localhost:3100, dashboard *DistriCommerce - Visão Geral*: "Serviços UP" = 6.
4. `PROFILE=smoke docker compose --profile loadtest run --rm k6` termina com todos os thresholds ✓.

No PowerShell, defina a variável antes: `$env:PROFILE="smoke"; docker compose --profile loadtest run --rm k6`.
Para voltar ao perfil padrão: `Remove-Item Env:PROFILE`.

## Status do CI/CD

O pipeline roda a cada push ou PR na `main`. O resultado aparece na aba **Actions** do repositório
(https://github.com/rabpaulo/computacao-distribuida/actions) e, depois do primeiro push na `main`,
as imagens ficam em **Packages** no perfil do repositório.

Como ler o resultado:
- ✅ `Build & Test` e as 9 execuções de `Docker (...)` verdes: tudo certo.
- ❌ em `Build & Test`: veja o log do passo que falhou (build ou teste).
- ❌ em `Docker (...)` na etapa de push: confira em *Settings > Actions > General > Workflow permissions* se está em **Read and write permissions**.

## 1. CI/CD (GitHub Actions)

Arquivo: `.github/workflows/ci.yml`

| Job | Quando | O que faz |
|---|---|---|
| `test` | push e PR na `main` | `npm ci`, `npm run build` e `npm test` em todos os workspaces (serviços + frontend) |
| `docker` | depois do `test` | Matriz com 9 imagens (8 serviços + frontend). Em PR só valida o build; em push na `main` publica no **GHCR** |

Imagens publicadas: `ghcr.io/<owner>/districommerce-<servico>` com as tags `latest` e `sha-<commit>`.
O login usa o `GITHUB_TOKEN` automático, sem secrets para configurar.
As actions de terceiros (`docker/*`) estão fixadas por SHA de commit, e o Dependabot (`.github/dependabot.yml`) abre PRs semanais para atualizá-las.

**Deploy no Kubernetes** (manual, a partir das imagens do GHCR):

```bash
kubectl apply -k k8s/
```

Os manifestos em `k8s/services/` apontam para `districommerce/<servico>:latest` (imagens locais do minikube).
Para usar as imagens do GHCR, troque o campo `image:` por `ghcr.io/<owner>/districommerce-<servico>:latest`.

## 2. Monitoramento (Prometheus + Grafana)

Cada serviço HTTP (gateway, users, products, orders, payments, logistics) expõe `GET /metrics`
(biblioteca `prom-client`, arquivo `src/metrics.ts`):

- `http_requests_total{method,route,status_code}`: throughput e erros
- `http_request_duration_seconds` (histograma): latência p50/p95/p99
- `http_requests_in_flight`: requisições em andamento
- métricas padrão do Node (CPU, memória RSS, event loop, GC)

| Ferramenta | URL | Login |
|---|---|---|
| Prometheus | http://localhost:9090 (veja *Status > Targets*) | |
| Grafana | http://localhost:3100 | admin / admin (padrão local; troque com `GRAFANA_ADMIN_PASSWORD`) |

Prometheus e Grafana só escutam em `127.0.0.1` (acessíveis apenas na própria máquina).

O dashboard **DistriCommerce - Visão Geral** já vem provisionado (`infra/grafana/dashboards/`):
serviços UP, throughput, erro 5xx, latência p95/p99 por serviço, top rotas, requisições em andamento, CPU e memória.

Configuração: `infra/prometheus/prometheus.yml` (coleta a cada 5s) e `infra/grafana/provisioning/`.

## 3. Testes de carga (k6)

Script: `loadtest/k6/districommerce.js`. Passa sempre pelo API Gateway.

Mix de tráfego por usuário virtual: 70% navegação (listar/detalhar produto), 20% login, 10% checkout (cria pedido e dispara a saga RabbitMQ).
No `setup()` o script cria um admin, um produto com estoque alto e 20 clientes.

Perfis (`PROFILE`):

| Perfil | Carga |
|---|---|
| `smoke` | 3 VUs por 20s, só para validar que funciona |
| `load` (padrão) | rampa até 20 VUs, patamar, pico de 50 VUs |
| `stress` | sobe até 300 VUs para achar o ponto de degradação |

Thresholds (o teste falha se violados): erro HTTP < 5%, p95 < 800 ms, checkout p95 < 1500 ms.

### Como rodar

```bash
docker compose up --build -d
# abra o Grafana (http://localhost:3100) no dashboard e deixe visível

PROFILE=smoke docker compose --profile loadtest run --rm k6   # validação rápida
docker compose --profile loadtest run --rm k6                 # perfil load
PROFILE=stress docker compose --profile loadtest run --rm k6  # perfil stress
```

O resumo final (p95, req/s, taxa de erro) sai no terminal e em `loadtest/results/summary.json`.

### O que registrar para a documentação (Semana 8)

1. Print do resumo do k6 (checks e thresholds).
2. Print do dashboard do Grafana durante o pico (throughput, p95 e erros).
3. Print de *Prometheus > Status > Targets* com todos os alvos UP.
4. Print da aba *Actions* do GitHub com o pipeline verde.

## Consultas úteis no Prometheus (Graph)

```promql
sum(rate(http_requests_total[1m])) by (service)                                        # throughput por serviço
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, service))   # p95
sum(rate(http_requests_total{status_code=~"5.."}[1m])) by (service)                    # erros 5xx
```

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Alvo DOWN no Prometheus | Serviço ainda subindo ou imagem antiga | `docker compose up --build -d` e aguarde |
| Grafana sem dados | Intervalo de tempo sem tráfego | Gere tráfego (k6) e use *Last 15 minutes* |
| Dashboard não atualizou após editar o JSON | Provisionamento carregado só na inicialização | `docker compose restart grafana` |
| k6 falha no `setup()` | Stack não está de pé ou gateway indisponível | `docker compose ps` e confira os logs do `api-gateway` |
| Porta 3000 ocupada | Frontend usa a 3000; o Grafana usa a 3100 | Não é conflito: acesse o Grafana em `:3100` |

## Resultados medidos (perfil `load`, 50 VUs, 2m30s)

| Métrica | Resultado | Limite |
|---|---|---|
| Requisições | 5613 (36,8 req/s), 0 falhas | erro < 5% |
| Latência p95 | 68,7 ms | < 800 ms |
| Checkout p95 | 17,4 ms (947 pedidos criados) | < 1500 ms |
| Checks | 5591 de 5591 | |

Os 6 serviços permaneceram UP e sem 5xx. O perfil `stress` (até 300 VUs) serve para achar o ponto de degradação.

> Os painéis de throughput e latência gerais usam só o gateway: somar todos os serviços contaria cada requisição mais de uma vez (gateway e serviço de destino).
