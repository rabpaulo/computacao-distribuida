# Aba de monitoramento (admin)

Logado como **administrador**, a barra do site ganha o botão **Monitoramento**. Ele abre uma janela com três abas, e
cada uma mostra a tela original da ferramenta **dentro do site**:

| Aba | Ferramenta | Para que serve |
|---|---|---|
| Grafana | Painéis | Requisições, latência, erros, CPU e memória por serviço (abre direto no dashboard do projeto) |
| Prometheus | Métricas | Consultas (PromQL) e, em *Status > Targets*, os serviços monitorados |
| RabbitMQ | Mensageria | Filas, mensagens em fluxo, consumidores e a fila de falhas (DLQ). Login: `admin` / `admin` |

Há também **Recarregar** e **Nova aba** (abre a ferramenta sozinha no navegador).

## Como funciona

```
 navegador (iframe) ─► Caddy ─► nginx do frontend ─► API Gateway ─► Grafana     /tools/grafana/
                                  (location /tools/)   (src/tools.ts) ─► Prometheus  /tools/prometheus/
                                                                       ─► RabbitMQ    /tools/rabbitmq/
```

As ferramentas ficam no **mesmo endereço do site**, em `/tools/*`. Por isso o navegador as trata como parte do
DistriCommerce e permite mostrá-las num iframe. O gateway (`services/api-gateway/src/tools.ts`) só repassa o tráfego.

Cada ferramenta foi configurada para viver nesse subcaminho:

| Ferramenta | Configuração | O gateway... |
|---|---|---|
| Grafana | `GF_SERVER_SERVE_FROM_SUB_PATH`, `GF_SERVER_ROOT_URL`, `GF_SECURITY_ALLOW_EMBEDDING`, acesso anônimo como *Viewer* | mantém o prefixo |
| Prometheus | `--web.external-url` com o caminho e `--web.route-prefix=/` | **remove** o prefixo |
| RabbitMQ | `management.path_prefix = /tools/rabbitmq` (`infra/rabbitmq/20-management-prefix.conf`) | mantém o prefixo |

Detalhes que importam:

- O gateway **não troca o cabeçalho `Host`** (`changeOrigin: false`) e o nginx repassa o `Host` com a porta. O Grafana
  compara o `Origin` do navegador com o `Host` e recusa as consultas dos painéis se forem diferentes.
- As rotas `/tools` são montadas **antes do helmet**. O Content-Security-Policy padrão dele bloqueia os scripts do
  Grafana e do RabbitMQ e a tela ficaria em branco.
- O WebSocket do Grafana Live está desligado (`GF_LIVE_MAX_CONNECTIONS=0`): o gateway não repassa `upgrade`, e os painéis
  funcionam sem ele.
- O botão só aparece para quem tem o perfil `ROLE_ADMIN`.

## Acesso (decisão de escopo)

**Não há checagem de autenticação nas rotas `/tools/*`.** O botão é escondido de quem não é admin, mas quem souber o
endereço (`/tools/grafana/`, etc.) abre as telas diretamente. O Prometheus não tem senha, o Grafana abre como
visualizador e o RabbitMQ usa `admin` / `admin`. Foi uma escolha consciente para este projeto (endereço conhecido só
pela turma). **Não deixe assim em um ambiente real.**

## Endereços diretos

| | Pelo site (qualquer ambiente) | Direto, só na VM/máquina local |
|---|---|---|
| Grafana | `/tools/grafana/` | `http://localhost:3100/tools/grafana/` |
| Prometheus | `/tools/prometheus/` | `http://localhost:9090/graph` |
| RabbitMQ | `/tools/rabbitmq/` | `http://localhost:15672/tools/rabbitmq/` |

> O endereço antigo do RabbitMQ (`http://localhost:15672/`) deixou de responder: a tela agora vive sob o prefixo.

## Como conferir depois do deploy

1. Entre no site com uma conta **admin** e clique em **Monitoramento**.
2. **Grafana:** o dashboard "DistriCommerce - Visão Geral" aparece com gráficos. Gráficos vazios com a mensagem
   *origin not allowed* indicam que o `Host` chegou diferente do `Origin`.
3. **Prometheus:** em *Status > Targets*, todos os serviços em **UP** (inclusive `notifications-service`).
4. **RabbitMQ:** faça login com `admin` / `admin` e veja a fila `notifications.events`.

Se uma aba ficar **em branco**, abra **Nova aba** e veja o que a ferramenta responde sozinha:

| Sintoma | Causa provável | O que olhar |
|---|---|---|
| RabbitMQ dá 404 em `/tools/rabbitmq/` | O arquivo `20-management-prefix.conf` não foi lido | `docker compose exec rabbitmq cat /etc/rabbitmq/conf.d/20-management-prefix.conf` e `docker compose logs rabbitmq` |
| Prometheus abre mas sem estilo ou links quebrados | O prefixo não está sendo removido/gerado | Os flags `--web.external-url` e `--web.route-prefix` em `docker compose ps prometheus` |
| Grafana pede login ou redireciona para `localhost` | `GF_SERVER_ROOT_URL` errado para o ambiente | No `docker-compose.prod.yml` deve ser `https://districommerce.duckdns.org/tools/grafana/` |
| "Recusou conectar" em qualquer aba | Algum header impedindo iframe | Console do navegador (F12): mensagens `X-Frame-Options` ou `frame-ancestors` |
| 502/504 numa aba | A ferramenta está fora do ar | `docker compose ps` |

## Limites

- Os **logs de texto** dos serviços não aparecem aqui: nenhuma das três ferramentas os agrega. Seria preciso adicionar o
  Loki (ou ELK) como uma quarta aba.
- Em Kubernetes (`k8s/`) estas rotas não funcionam: Grafana e Prometheus não têm manifestos lá. É recurso do Docker
  Compose.
