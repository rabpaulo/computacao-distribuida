# Relatório do teste de carga: ponto de ruptura na nuvem

Teste de carga progressivo, executado **dentro do servidor na nuvem**, aumentando os usuários até o sistema colapsar.
Para repetir o teste, veja o [manual](TESTE-DE-CARGA.md).

## 1. Objetivo

Descobrir quantos usuários simultâneos o DistriCommerce atende **com qualidade aceitável**, em que ponto a experiência degrada
e em que ponto o sistema colapsa, identificando o gargalo.

## 2. Ambiente

| Item | Valor |
|---|---|
| Nuvem | Google Cloud, Compute Engine |
| Máquina | `e2-medium`: 2 vCPU (núcleo compartilhado), 4 GB de RAM |
| Sistema | Ubuntu 22.04 LTS, disco permanente equilibrado de 30 GB |
| Região | `southamerica-east1-c` (São Paulo) |
| Execução | Docker Compose, 16 containers (8 serviços + frontend, Postgres, MongoDB, RabbitMQ, Mosquitto, Caddy, Prometheus, Grafana) |
| Publicação | Pipeline CI/CD: GitHub Actions publica as imagens no GHCR e faz o deploy na VM por SSH |
| Ferramenta de carga | k6 (`grafana/k6:0.54.0`), **rodando na própria VM**, na rede interna do compose |
| Alvo | API Gateway (`http://api-gateway:8000`), sem passar por Caddy nem pelo frontend |
| Data | 17/11/2026 (horário de Brasília) |

## 3. Metodologia

- Script: `loadtest/k6/breakpoint.js` (detalhes no [manual](TESTE-DE-CARGA.md)).
- Tráfego por usuário virtual (VU): 70% navegação, 20% login, 10% checkout (cria pedido e dispara a saga RabbitMQ). Pausa de 0,5 a 1,5 s entre ações.
- A carga sobe em **degraus**. Cada degrau tem 5 s de subida e o restante sustentado, e é medido separadamente.
- **SLO:** p95 < 800 ms e erros < 5%.
- **Colapso (aborta o teste):** p95 > 5 s ou erros >= 30%.
- Coleta de CPU: `docker stats` observado durante o teste.

Foram feitas **duas execuções**: uma varredura grossa (degraus de 25 VUs) e uma fina (degraus de 5 VUs).

## 4. Resultados

### 4.1 Execução fina (degraus de 5 VUs, teto de 200)

| Usuários (VUs) | req/s (aprox.) | p95 (ms) | Erros | Situação |
|---:|---:|---:|---:|---|
| 5 | 8 | 144 | 0,0% | OK |
| 10 | 15 | 243 | 0,0% | OK |
| 15 | 23 | 220 | 0,0% | OK |
| **20** | **30** | **304** | 0,0% | **OK (último dentro do SLO)** |
| 25 | 25 | 1357 | 0,0% | Fora do SLO |
| 30 | 38 | 1104 | 0,0% | Fora do SLO |
| 35 | 27 | 6594 | 0,0% | **Colapso** (p95 > 5 s), teste abortado |

O degrau de 40 VUs foi cortado logo no início pelo aborto (3 req/s, p95 de 501 ms) e **não deve ser considerado**:
são poucos pedidos medidos.

- **Maior patamar dentro do SLO: 20 usuários virtuais simultâneos.**
- **Primeiro degrau fora do SLO: 25.**
- **Colapso detectado em 35.**
- O teste durou cerca de 3 min 38 s até o aborto (2978 iterações completas, 39 interrompidas).
- Evidências: [tabela](evidencias/breakpoint-2026-11-17-execucao-fina-tabela.txt) e
  [log completo do k6](evidencias/breakpoint-2026-11-17-execucao-fina.log.txt). Esse log foi gerado pela versão do script anterior
  à correção do degrau parcial, por isso a linha de 40 VUs aparece como `OK`.

### 4.2 Execução grossa (degraus de 25 VUs, teto de 1500)

| Usuários (VUs) | req/s (aprox.) | p95 (ms) | Erros | Situação |
|---:|---:|---:|---:|---|
| 25 | 30 | 962 | 0,0% | Fora do SLO |
| 50 | 44 | 4584 | 0,0% | Fora do SLO |
| 75 | (cortado) | 5391 | 0,0% | Colapso, teste abortado |

O teste durou cerca de 1 min 14 s até o aborto. Esta execução **não tem arquivo salvo**: os números vêm da saída do terminal
(o resumo final não foi gravado por falta de permissão na pasta `loadtest/results`).

### 4.3 Consumo de CPU (amostras do `docker stats`)

Cada coluna é **uma amostra instantânea**, não uma média. 100% equivale a 1 vCPU, então a VM tem 200% disponíveis.

| Container | ~15 VUs | ~30 VUs | ~35 VUs | Após o teste |
|---|---:|---:|---:|---:|
| `users-service` | 25% | 68% | **119%** | 1% |
| `mongodb` | 6% | 68% | **82%** | **92%** |
| `products-service` | 26% | 12% | **77%** | 1% |
| `payments-service` | 8% | 4% | 33% | 1% |
| `api-gateway` | 15% | 11% | 21% | 6% |
| k6 | 6% | 6% | 10% | (encerrado) |
| `rabbitmq` | 1% | 9% | 2% | 0% |

Os demais containers (frontend, orders, logistics, paypal-mock, iot-simulator, Postgres, Mosquitto, Caddy, Prometheus, Grafana)
ficaram abaixo de 6% em todas as amostras.

## 5. Análise

1. **Capacidade útil: cerca de 20 usuários simultâneos** dentro do SLO. Acima disso a latência passa do limite.
2. **O sistema satura, não falha.** Os erros HTTP ficaram em **0% em todos os degraus**. Quando a carga passa da capacidade, as
   requisições entram em fila e a latência explode (p95 de 6,6 s com 35 VUs), mas nenhuma é rejeitada.
3. **A vazão estaciona** em torno de 30 a 38 req/s e deixa de acompanhar o número de usuários. É o sinal clássico de saturação.
4. **O gargalo é CPU.** Com 35 VUs, a soma dos containers passa de 350% (users 119%, MongoDB 82%, products 77%, payments 33%,
   gateway 21%, k6 10%), contra 200% disponíveis na VM. Os maiores consumidores:
   - `users-service`: o login usa bcrypt (hash proposital e pesado em CPU), e 20% do tráfego é login.
   - `mongodb` e `products-service`: cerca de 70% do tráfego é navegação no catálogo.
5. **Os resultados variam entre execuções.** Com 25 VUs o p95 foi 962 ms na execução grossa e 1357 ms na fina. A execução grossa não
   colapsou em 50 VUs (p95 de 4,6 s, perto do limite), e a fina colapsou em 35. Isso é esperado com núcleo compartilhado e cada
   configuração rodada uma vez. Por isso o resultado deve ser lido como **ordem de grandeza (20 a 30 usuários)**, não como um valor exato.

## 6. Comparação com a execução local

O [`SEMANA-7.md`](SEMANA-7.md) registra a mesma stack rodando no computador de desenvolvimento (perfil `load`, 50 VUs): **p95 de 68,7 ms**,
36,8 req/s e 0 falhas. Na VM, o p95 com 25 VUs já passa de 960 ms.

A diferença é de **hardware**, não do código: a VM `e2-medium` tem 2 vCPUs compartilhadas, bem menos CPU que um computador
de desenvolvimento. Os testes não são diretamente comparáveis (máquinas diferentes e perfis diferentes), mas mostram que a
capacidade do sistema depende diretamente da CPU disponível.

## 7. Limitações

- **O k6 roda na mesma VM** e consome CPU (6 a 10% nas amostras), então a capacidade real do sistema é um pouco maior que a medida.
- **Núcleo compartilhado:** a e2-medium pode limitar a CPU em uso sustentado.
- **16 containers na mesma VM**, incluindo Prometheus e Grafana, que também consomem recursos.
- **Uma execução por configuração**, sem repetições. Há variação entre execuções (seção 5).
- A coleta de CPU foi por **amostras visuais** do `docker stats`, não por série contínua.
- Os testes exercitam a **API pelo gateway**. O frontend, o Caddy e o HTTPS não entram na medição.
- "Usuário" aqui é um usuário **ativo e simultâneo** com pausa entre ações, não visitantes por dia.
- O tráfego usa um único produto de teste e poucos clientes (20) no pool de login.

## 8. Conclusões

- A stack atende com qualidade até **cerca de 20 usuários simultâneos** nesta VM, degrada a partir de **25** e colapsa em **35 a 50**.
- O comportamento sob sobrecarga é **degradação gradual sem erros**, e não queda abrupta.
- O fator limitante é **CPU**, concentrada em `users-service` (login), `mongodb` e `products-service`.

## 9. Recomendações

| Ação | Por quê |
|---|---|
| Mais vCPUs (VM maior ou Kubernetes com autoescala horizontal, como o projeto prevê) | A CPU é o limite. É a forma mais direta de elevar a capacidade |
| Índices no MongoDB e cache do catálogo (Redis, também previsto no projeto) | Reduz a CPU da navegação, que é a maior parte do tráfego |
| Escalar o `users-service` horizontalmente ou ajustar o custo do bcrypt | O login consome mais de 1 vCPU sozinho no pico |
| Rodar o k6 (e, se possível, Prometheus e Grafana) fora da VM do sistema testado | Mede a capacidade real, sem interferência |

## 10. Pendências em aberto

- **MongoDB com ~92% de CPU logo após o fim do teste**, com os outros containers ociosos. Não investigado. Pode ser fila acumulada
  ou consulta sem índice. Vale conferir com `docker stats --no-stream` alguns minutos depois e `db.currentOp()` no `mongosh`.
- **Repetir o teste 3 vezes** e usar a mediana, para reduzir a variação.
- **Completar as evidências** em `docs/evidencias/`. Já estão o log e a tabela da execução fina. Faltam o `docker-stats.csv`
  (coleta contínua de CPU), a saída da execução grossa e prints do Grafana durante o pico. Veja a seção 4 do [manual](TESTE-DE-CARGA.md).
- **Teste de contraprova:** redimensionar a VM para mais vCPUs, rodar de novo e comparar com a tabela da seção 4.1.
