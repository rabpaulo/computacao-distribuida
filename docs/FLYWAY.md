# Migrations do banco com Flyway

O schema do PostgreSQL é criado e evoluído por **migrations versionadas** (arquivos SQL numerados), aplicadas pelo
**Flyway**. Os serviços deixaram de criar tabelas por conta própria.

## 1. Por que mudou

| Antes | Agora |
|---|---|
| Cada serviço rodava `CREATE TABLE IF NOT EXISTS` ao subir | O Flyway aplica `infra/flyway/sql/V1__...`, `V2__...` uma vez e **na ordem** |
| Não havia histórico: ninguém sabia a versão do schema de cada banco | A tabela `flyway_schema_history` registra o que foi aplicado, quando e com que resultado |
| O `IF NOT EXISTS` não altera uma tabela que já existe: mudar uma coluna exigia mexer na mão ou escrever `ALTER` solto no código | Mudar o schema é **adicionar um arquivo novo** (`V7__...`) |
| Ambientes podiam divergir sem ninguém perceber | O Flyway valida o checksum: editar uma migration já aplicada **falha** em vez de passar batido |

## 2. Estrutura

```
infra/flyway/
├── Dockerfile                    imagem flyway/flyway:10.22.0-alpine + os arquivos SQL
└── sql/
    ├── V1__usuarios.sql          users (+ colunas de consentimento LGPD)         -> users-service
    ├── V2__pedidos.sql           orders, order_items                              -> orders-service
    ├── V3__pagamentos.sql        payments (+ colunas do PayPal)                   -> payments-service
    ├── V4__entregas.sql          shipments, shipment_events                       -> logistics-service
    ├── V5__notificacoes.sql      notifications, order_owners                      -> notifications-service
    └── V6__indices_de_listagem.sql   índices compostos de "Meus pedidos/pagamentos/entregas"
```

A V6 é a primeira migration de **evolução** (não cria tabela, só melhora consultas). É o caso que o Flyway resolve:
nenhum serviço precisou mudar para o índice existir.

## 3. Como funciona

```
 docker compose up
        │
        ├─► postgres (healthy)
        │        │
        │        ▼
        ├─► flyway ── aplica as migrations pendentes ── grava em flyway_schema_history ── termina (exit 0)
        │                                                          │
        │        ┌─────────────────────────────────────────────────┘
        ▼        ▼  service_completed_successfully
   users, orders, payments, logistics, notifications
        │
        └─ no start: waitForSchema() confere a versão do schema e só então abre a porta
```

- No Compose, os cinco serviços têm `depends_on: flyway: condition: service_completed_successfully`. Se o Flyway
  falhar, **os serviços não sobem** e o erro aparece na hora (em vez de aparecer como 500 em produção).
- Cada serviço declara a **versão mínima** do schema de que depende (`REQUIRED_SCHEMA_VERSION` no
  `src/config/database.ts`: users 1, orders 2, payments 3, logistics 4, notifications 5). Se a migration seguinte
  mudar algo que um serviço usa, basta subir esse número e ele passa a recusar bancos que ainda não a receberam.
- Fora do Compose (Kubernetes, ou rodando um serviço na mão), o serviço espera até 90 s o schema chegar na versão
  exigida. Passando disso, encerra com a mensagem: `Aplique as migrations: docker compose run --rm flyway`.

## 4. Banco que já existia

O banco da nuvem foi criado **antes** do Flyway (as tabelas vinham dos serviços). O Flyway não aceita um schema não
vazio sem histórico, então usamos:

```
FLYWAY_BASELINE_ON_MIGRATE=true
FLYWAY_BASELINE_VERSION=0
```

Ele registra o estado atual como "versão 0" e aplica a V1 em diante. Por isso as migrations V1 a V6 usam
`IF NOT EXISTS` e `ADD COLUMN IF NOT EXISTS`: onde a tabela já existe, elas não fazem nada; num banco novo, criam tudo.
**Migrations novas (V7 em diante) não precisam desse cuidado**, porque já nascem com o Flyway no controle.

## 5. Como adicionar uma mudança de schema

1. Crie `infra/flyway/sql/V7__descricao_curta.sql` (próximo número, sem buracos). Exemplo:
   ```sql
   ALTER TABLE users ADD COLUMN telefone VARCHAR(20);
   ```
2. Se algum serviço passa a **depender** dessa mudança, suba o `REQUIRED_SCHEMA_VERSION` dele para 7.
3. Faça commit e push. O CI roda o teste de consistência, publica a imagem `districommerce-flyway` e o deploy aplica a V7.

Regras (algumas são checadas pelo teste `services/users-service/tests/migrations.test.ts` no CI):

- **Nunca edite uma migration que já foi aplicada.** O Flyway compara o checksum e recusa. Para corrigir, crie uma nova.
- Nome no padrão `V<número>__<descricao_minuscula>.sql` (dois underscores), versões **inteiras**, únicas e sem buracos.
- Não use `${...}` no SQL: o Flyway trata como variável e tentaria substituir.
- Não há desfazer automático (o *undo* é da edição paga). Uma mudança errada se corrige com outra migration.

## 6. Como mostrar funcionando

Depois de subir o sistema:

```bash
# O que o Flyway fez (aplicou a V1..V6, ou "Schema is up to date" nas vezes seguintes)
docker compose logs flyway

# O histórico no banco
docker compose exec postgres psql -U postgres -d districommerce_users -c \
  "SELECT installed_rank, version, description, success, installed_on FROM flyway_schema_history ORDER BY installed_rank;"

# Os serviços confirmando a versão do schema
docker compose logs users-service | grep "Schema na versão"
```

Na tabela aparecem a linha do **baseline** (versão 0, "<< Flyway Baseline >>", só em bancos que já existiam) e uma
linha por migration, de V1 a V6, com `success = t`.

Para ver o Flyway **barrando** algo: edite qualquer migration já aplicada e rode `docker compose run --rm flyway`. Ele
falha com `Validate failed: ... checksum mismatch`.

## 7. CI/CD e Kubernetes

- O CI constrói e publica a imagem `ghcr.io/<owner>/districommerce-flyway` junto com as dos serviços (mesma tag do commit).
- No deploy, o `docker compose pull` baixa a imagem nova e o `up -d` **recria** o container do Flyway (a tag mudou), que
  aplica o que faltar antes dos serviços serem recriados. Se uma migration falhar, o deploy falha nesse passo e os
  serviços antigos continuam no ar.
- No Kubernetes, `k8s/databases/flyway-job.yaml` é um Job com a mesma imagem. Como Job é imutável, apague o anterior
  antes de aplicar de novo: `kubectl -n districommerce delete job flyway-migrate --ignore-not-found`.

## 8. Limites

- **Só o PostgreSQL.** O MongoDB (catálogo) não tem schema relacional, então não passa pelo Flyway.
- **Um banco compartilhado.** Users, orders, payments, logistics e notifications usam o banco `districommerce_users`
  (cada serviço só mexe nas próprias tabelas), então existe **um** histórico de migrations para todos. Separar em um
  banco por serviço exigiria um Flyway (e um histórico) para cada um.
- **Sem desfazer automático**, como dito acima.
- **Desenvolvimento sem Docker:** quem roda um serviço na mão precisa aplicar as migrations antes
  (`docker compose run --rm flyway`), senão o serviço espera e desiste depois de 90 s.
