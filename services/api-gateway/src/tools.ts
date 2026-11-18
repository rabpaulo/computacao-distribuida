import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export interface ToolTargets {
  grafana: string;
  prometheus: string;
  rabbitmq: string;
}

// Telas de monitoramento exibidas na aba "Monitoramento" do site (visível para admin).
// Cada ferramenta é servida num subcaminho do próprio site, então o navegador a
// trata como parte do DistriCommerce e ela pode ser mostrada dentro de um iframe.
//
// Cada uma precisa estar configurada para viver sob o seu prefixo (veja o
// docker-compose.yml). O que muda entre elas é se o gateway tira o prefixo ou não:
//   Grafana     GF_SERVER_SERVE_FROM_SUB_PATH  -> espera o prefixo   (mantém)
//   Prometheus  --web.route-prefix=/           -> espera a raiz      (remove)
//   RabbitMQ    management.path_prefix         -> espera o prefixo   (mantém)
//
// O Host da requisição NÃO é trocado (changeOrigin: false): o Grafana compara o
// cabeçalho Origin do navegador com o Host e recusa as consultas dos painéis
// (POST) se eles forem diferentes.
//
// Importante: este router é montado ANTES do helmet no server.ts. O helmet
// aplica um Content-Security-Policy que bloqueia os scripts embutidos do
// Grafana e do RabbitMQ, e a tela ficaria em branco.
export function createToolsRouter(targets: ToolTargets): Router {
  const router = Router();

  router.use(
    createProxyMiddleware({
      target: targets.grafana,
      pathFilter: '/tools/grafana',
      changeOrigin: false,
      logger: console,
    })
  );

  router.use(
    createProxyMiddleware({
      target: targets.prometheus,
      pathFilter: '/tools/prometheus',
      pathRewrite: { '^/tools/prometheus': '' },
      changeOrigin: false,
      logger: console,
    })
  );

  router.use(
    createProxyMiddleware({
      target: targets.rabbitmq,
      pathFilter: '/tools/rabbitmq',
      changeOrigin: false,
      logger: console,
    })
  );

  return router;
}
