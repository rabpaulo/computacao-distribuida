# Manual do teste de carga (ponto de ruptura)

Como rodar, acompanhar e coletar os resultados do teste de carga progressivo do DistriCommerce.
Os resultados da execução feita na nuvem estão em [`RELATORIO-TESTE-DE-CARGA.md`](RELATORIO-TESTE-DE-CARGA.md).

## 1. O que o teste faz

Script: [`loadtest/k6/breakpoint.js`](../loadtest/k6/breakpoint.js). Ele reaproveita o fluxo de usuário de
`loadtest/k6/districommerce.js` e **passa sempre pelo API Gateway**:

- 70% navegação (listar produtos e detalhar um produto)
- 20% login
- 10% checkout (cria um pedido e dispara a saga RabbitMQ: pedido, pagamento, logística)
- Entre uma ação e outra, cada usuário virtual (VU) espera de 0,5 a 1,5 s.

O teste **sobe a carga em degraus** (`STEP_VUS` usuários a mais a cada `STEP_SECONDS` segundos) e **para sozinho** quando o
sistema colapsa. Cada degrau é medido separadamente (tag `level` = número de VUs do degrau).

| Critério | Regra | O que acontece |
|---|---|---|
| **SLO** (qualidade aceitável) | p95 < 800 ms **e** erros < 5% | O degrau é marcado `FORA DO SLO` se violar |
| **Colapso** | p95 > 5 s **ou** erros >= 30% | O teste é **abortado** (`abortOnFail`) |

No final o script imprime uma tabela por degrau e o resumo:

```
 usuarios | req/s ~ | p95 (ms) |  erros | situacao
       20 |      30 |       304 |    0.0% | OK
       25 |      25 |      1357 |    0.0% | FORA DO SLO
Maior patamar DENTRO do SLO: 20 usuários virtuais simultâneos
Primeiro degrau fora do SLO: 25 usuários virtuais
```

### Parâmetros

Passados com `-e NOME=valor` no comando do `docker compose run`.

| Variável | Padrão | Significado |
|---|---|---|
| `STEP_VUS` | `25` | VUs adicionados a cada degrau |
| `STEP_SECONDS` | `30` | Duração do degrau (5 s de subida + o resto sustentado) |
| `MAX_VUS` | `1500` | Teto do teste, caso o sistema aguente tudo |
| `BASE_URL` | `http://api-gateway:8000` | Alvo (já configurado no `docker-compose.yml`) |

Use degraus pequenos (`STEP_VUS=5`) para achar o ponto de ruptura com precisão, e degraus grandes para uma varredura rápida.

## 2. Pré-requisitos

- Stack no ar: `docker compose ps` com os serviços `Up`/`healthy`.
- O script `loadtest/k6/breakpoint.js` presente na máquina que roda o teste. Na VM ele chega pelo pipeline de CD
  (o passo *Copiar compose, infra e loadtest* do `.github/workflows/ci.yml`).
- Na VM, o compose precisa enxergar o arquivo de produção. Se o terminal for novo:
  `export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`

## 3. Rodar na VM (nuvem)

### 3.1 Preparar (uma vez)

```bash
cd ~/computacao-distribuida

# memória extra para a VM não travar no pico (só se `swapon --show` vier vazio)
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile

# o k6 roda como usuário não-root e precisa gravar os resultados
sudo chmod -R a+rwx loadtest/results
```

### 3.2 Iniciar o teste

Janela SSH 1:

```bash
cd ~/computacao-distribuida
nohup docker compose --profile loadtest run --no-deps --rm -T -e STEP_VUS=5 -e MAX_VUS=200 \
  k6 run /scripts/breakpoint.js > loadtest/results/breakpoint.log 2>&1 &
tail -f loadtest/results/breakpoint.log        # Ctrl+C sai do tail; o teste continua
```

- `nohup ... &` mantém o teste vivo se a aba do navegador fechar.
- `--no-deps` impede o compose de recriar os outros containers durante o teste.
- `-T` desliga o terminal interativo (necessário com `nohup`).

### 3.3 Registrar o consumo de CPU (opcional, recomendado)

Janela SSH 2, **antes** de iniciar o teste. Grava uma amostra por container a cada 5 s:

```bash
cd ~/computacao-distribuida
nohup bash -c 'while true; do docker stats --no-stream --format "$(date +%T),{{.Name}},{{.CPUPerc}},{{.MemUsage}}"; sleep 5; done' \
  > loadtest/results/docker-stats.csv 2>&1 &
echo $! > loadtest/results/docker-stats.pid
```

Ao terminar o teste, pare a coleta:

```bash
kill $(cat loadtest/results/docker-stats.pid)
```

Para ver ao vivo em vez de gravar: `docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"`.

### 3.4 Acompanhar no Grafana (opcional)

No PowerShell do seu computador (substitua os valores entre `<>`), deixe o túnel aberto e acesse http://localhost:3100:

```powershell
ssh -i <caminho-da-chave> -L 3100:localhost:3100 <usuario>@<IP-da-VM>
```

Dashboard *DistriCommerce - Visão Geral*: throughput, latência p95/p99, erros 5xx, CPU e memória por serviço.

### 3.5 Quando termina

O teste termina sozinho de duas formas: **abortado** (colapso, o caso esperado) ou **completo** (chegou em `MAX_VUS`).
No log aparece a mensagem `thresholds on metrics ... were crossed; at least one has abortOnFail enabled, stopping test prematurely`.
Isso **não é um erro do sistema**: é o critério de colapso funcionando. O código de saída do k6 será `99`.

## 4. Onde ficam os resultados e como baixar

Tudo fica na VM, em `~/computacao-distribuida/loadtest/results/`:

| Arquivo | Conteúdo |
|---|---|
| `breakpoint.log` | Saída completa do k6 (progresso a cada segundo + tabela final). É o **log** do teste |
| `breakpoint.txt` | Só a tabela final e o resumo |
| `breakpoint-summary.json` | Todas as métricas (para gráficos) |
| `docker-stats.csv` | CPU e memória por container, a cada 5 s (se você fez o passo 3.3) |

Se `breakpoint.txt` não existir, o `chmod` do passo 3.1 não foi feito (o log mostra `permission denied`).
A tabela continua no log: `sed -n '/PONTO DE RUPTURA/,/Último degrau/p' loadtest/results/breakpoint.log`

### Opção A: botão do SSH no navegador

Na janela do SSH, clique em **FAZER O DOWNLOAD DO ARQUIVO** e informe o caminho a partir da home:
`computacao-distribuida/loadtest/results/breakpoint.log`

### Opção B: `scp` no PowerShell

```powershell
scp -i <caminho-da-chave> "<usuario>@<IP-da-VM>:computacao-distribuida/loadtest/results/breakpoint*" .\docs\evidencias\
scp -i <caminho-da-chave> "<usuario>@<IP-da-VM>:computacao-distribuida/loadtest/results/docker-stats.csv" .\docs\evidencias\
```

### Guardar como evidência no repositório

O `.gitignore` **ignora** `*.log` e tudo em `loadtest/results/`, então os arquivos não vão pro git sozinhos.
Copie para `docs/evidencias/` e **renomeie o log para `.txt`** (ex.: `breakpoint-2026-11-17.log.txt`).
Os resultados ficam no disco da VM: **baixe antes de apagar a VM**.

## 5. Como interpretar

- **Maior patamar dentro do SLO** é a capacidade útil: quantos usuários ativos simultâneos o sistema atende com qualidade.
- **Primeiro degrau fora do SLO** é onde a experiência começa a degradar.
- **Último degrau alcançado** é onde o colapso foi detectado. Esse degrau é marcado `(parcial: teste abortado aqui)` quando o
  teste foi cortado no meio dele, e **o "OK" de um degrau parcial não prova nada** (poucos pedidos medidos).
- `req/s ~` é uma média aproximada (pedidos do degrau divididos pela duração), inclui os 5 s de subida e é apenas indicativa.
- **Erros baixos com p95 alto** significam saturação: o sistema não falha, ele enfileira.
- 1 VU equivale a **1 usuário ativo**, com pausa entre ações. Não é o mesmo que visitantes por dia.
- Compare com o `docker stats` do mesmo momento para achar o gargalo (qual container está no limite de CPU).

## 6. Rodar localmente (Docker Desktop)

```bash
docker compose up --build -d
docker compose --profile loadtest run --rm -e STEP_VUS=5 -e MAX_VUS=100 k6 run /scripts/breakpoint.js
```

Os perfis simples (`smoke`, `load`, `stress`) continuam em `loadtest/k6/districommerce.js`, veja [`SEMANA-7.md`](SEMANA-7.md).

## 7. Cuidados e problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `permission denied` ao gravar em `/results` | Pasta sem permissão para o usuário do k6 | `sudo chmod -R a+rwx loadtest/results` |
| `could not open script ... breakpoint.js` | O deploy ainda não copiou o arquivo | Espere o job *Deploy na VM* ficar verde e confira `ls loadtest/k6/` |
| O site fica lento ou cai durante o teste | É o objetivo do teste | Avise o grupo antes de rodar |
| SSH da VM cai no pico | VM sem CPU/memória sobrando | Console do Google Cloud: *Redefinir* a VM e depois `docker compose ps` |
| `docker compose` recria containers ao rodar o teste | Faltou o `--no-deps` | Use o comando do passo 3.2 |
| Teste aborta quase de imediato | Stack ainda subindo ou degrau inicial já ruim | Confirme `docker compose ps` e rode de novo com `STEP_VUS=5` |
| Tabela diferente a cada execução | Variação normal entre execuções | Repita 3 vezes e use a mediana |

O teste cria usuários, produtos e pedidos de teste nos bancos. Eles não atrapalham o uso normal.
`docker compose down -v` apaga **todos** os dados (inclusive os que não são de teste).

Para economizar crédito da nuvem, **pare a VM** quando não estiver usando.
