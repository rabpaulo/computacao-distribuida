import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { createToolsRouter } from '../src/tools';

// Sobe um "Grafana", um "Prometheus" e um "RabbitMQ" de mentira que apenas
// anotam o que o gateway mandou para eles. Assim dá para provar, sem Docker,
// que cada ferramenta recebe o caminho certo (com ou sem o prefixo).

interface Seen {
  url: string;
  host: string | undefined;
  authorization: string | undefined;
}

function startStub(name: string): Promise<{ server: http.Server; seen: Seen[]; url: string }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({
      url: req.url ?? '',
      host: req.headers.host,
      authorization: req.headers.authorization,
    });
    res.setHeader('Content-Type', 'text/plain');
    res.end(`${name}:${req.url}`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, seen, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('API Gateway - telas de monitoramento em /tools', () => {
  let grafana: Awaited<ReturnType<typeof startStub>>;
  let prometheus: Awaited<ReturnType<typeof startStub>>;
  let rabbitmq: Awaited<ReturnType<typeof startStub>>;
  let app: express.Express;

  beforeAll(async () => {
    [grafana, prometheus, rabbitmq] = await Promise.all([
      startStub('grafana'),
      startStub('prometheus'),
      startStub('rabbitmq'),
    ]);
    app = express();
    app.use(
      createToolsRouter({
        grafana: grafana.url,
        prometheus: prometheus.url,
        rabbitmq: rabbitmq.url,
      })
    );
    app.use((_req, res) => {
      res.status(404).send('fora do /tools');
    });
  });

  afterAll(async () => {
    await Promise.all(
      [grafana, prometheus, rabbitmq].map(
        (stub) => new Promise<void>((resolve) => stub.server.close(() => resolve()))
      )
    );
  });

  it('Grafana: mantém o prefixo (ele roda com serve_from_sub_path)', async () => {
    const response = await request(app).get('/tools/grafana/d/districommerce-overview?orgId=1&refresh=5s');

    expect(response.status).toBe(200);
    expect(response.text).toBe('grafana:/tools/grafana/d/districommerce-overview?orgId=1&refresh=5s');
  });

  it('Prometheus: remove o prefixo (ele roda com route-prefix=/)', async () => {
    const response = await request(app).get('/tools/prometheus/graph?g0.expr=up');

    expect(response.status).toBe(200);
    expect(response.text).toBe('prometheus:/graph?g0.expr=up');
  });

  it('Prometheus: a raiz do prefixo vira a raiz do Prometheus', async () => {
    const response = await request(app).get('/tools/prometheus/');
    expect(response.text).toBe('prometheus:/');
  });

  it('RabbitMQ: mantém o prefixo (ele roda com management.path_prefix)', async () => {
    const response = await request(app).get('/tools/rabbitmq/api/overview');

    expect(response.status).toBe(200);
    expect(response.text).toBe('rabbitmq:/tools/rabbitmq/api/overview');
  });

  it('não troca o Host (o Grafana recusa consultas se Host e Origin forem diferentes)', async () => {
    await request(app)
      .post('/tools/grafana/api/ds/query')
      .set('Host', 'districommerce.duckdns.org')
      .send({ queries: [] });

    const last = grafana.seen[grafana.seen.length - 1];
    expect(last.host).toBe('districommerce.duckdns.org');
  });

  it('repassa o cabeçalho Authorization (o RabbitMQ usa autenticação básica)', async () => {
    await request(app)
      .get('/tools/rabbitmq/api/queues')
      .set('Authorization', 'Basic YWRtaW46YWRtaW4=');

    const last = rabbitmq.seen[rabbitmq.seen.length - 1];
    expect(last.authorization).toBe('Basic YWRtaW46YWRtaW4=');
  });

  it('cada ferramenta só recebe o que é dela', async () => {
    const before = [grafana.seen.length, prometheus.seen.length, rabbitmq.seen.length];

    await request(app).get('/tools/prometheus/targets');

    expect(grafana.seen.length).toBe(before[0]);
    expect(rabbitmq.seen.length).toBe(before[2]);
    expect(prometheus.seen.length).toBe(before[1] + 1);
  });

  it('não interfere em rotas que não são /tools (a API segue para as outras rotas)', async () => {
    const response = await request(app).get('/api/v1/products');

    expect(response.status).toBe(404);
    expect(response.text).toBe('fora do /tools');
  });

  it('com a ferramenta fora do ar, responde erro de gateway em vez de travar', async () => {
    const broken = express();
    broken.use(
      createToolsRouter({
        // porta onde ninguém escuta
        grafana: 'http://127.0.0.1:1',
        prometheus: prometheus.url,
        rabbitmq: rabbitmq.url,
      })
    );

    const response = await request(broken).get('/tools/grafana/');

    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
