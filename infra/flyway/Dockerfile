# Migrations do banco relacional (PostgreSQL). A imagem leva os arquivos SQL
# dentro, então cada versão do sistema carrega as migrations que ela precisa:
# o deploy puxa a imagem nova e o Flyway aplica só o que falta.
#
# Configuração (URL, usuário, senha) vem de variáveis FLYWAY_* no compose/K8s.
FROM flyway/flyway:10.22.0-alpine

COPY sql /flyway/sql

# Padrão do compose e do K8s: aplicar as migrations pendentes e sair
CMD ["migrate"]
