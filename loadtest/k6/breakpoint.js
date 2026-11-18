// Teste de PONTO DE RUPTURA (breakpoint) do DistriCommerce.
//
// Sobe usuários virtuais (VUs) em degraus até o sistema quebrar e PARA SOZINHO
// quando um degrau estoura o limite de colapso. Reaproveita o fluxo de usuário
// de districommerce.js (70% navegação, 20% login, 10% checkout).
//
// Rodando dentro da VM (alvo = API Gateway pela rede do compose):
//   docker compose --profile loadtest run --rm k6 run /scripts/breakpoint.js
//
// Variáveis opcionais (-e NOME=valor no comando acima):
//   STEP_VUS=25       quantos VUs a mais a cada degrau
//   STEP_SECONDS=30   duração de cada degrau (5 s de subida + resto sustentado)
//   MAX_VUS=1500      teto do teste, se o sistema aguentar tudo
//
// Cada degrau é medido separado (tag "level" = nº de VUs do degrau):
//   SLO (aceitável):  p95 < 800 ms  e  erros < 5%
//   Colapso (aborta): p95 > 5 s     ou  erros >= 30%
import exec from 'k6/execution';
import base from './districommerce.js';

export { setup } from './districommerce.js';

const STEP_VUS = Number(__ENV.STEP_VUS || 25);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 30);
const MAX_VUS = Number(__ENV.MAX_VUS || 1500);
const RAMP_SECONDS = 5;
const STEPS = Math.floor(MAX_VUS / STEP_VUS);

const SLO_P95_MS = 800;
const SLO_ERROR_RATE = 0.05;
const COLLAPSE_P95_MS = 5000;
const COLLAPSE_ERROR_RATE = 0.3;

const stages = [];
const thresholds = {};
for (let i = 1; i <= STEPS; i++) {
  const level = i * STEP_VUS;
  stages.push({ duration: `${RAMP_SECONDS}s`, target: level });
  stages.push({ duration: `${STEP_SECONDS - RAMP_SECONDS}s`, target: level });

  thresholds[`http_reqs{level:${level}}`] = ['count>=0']; // só para o k6 registrar o degrau
  thresholds[`http_req_failed{level:${level}}`] = [
    `rate<${SLO_ERROR_RATE}`,
    { threshold: `rate<${COLLAPSE_ERROR_RATE}`, abortOnFail: true, delayAbortEval: '5s' },
  ];
  thresholds[`http_req_duration{level:${level}}`] = [
    `p(95)<${SLO_P95_MS}`,
    { threshold: `p(95)<${COLLAPSE_P95_MS}`, abortOnFail: true, delayAbortEval: '5s' },
  ];
}

export const options = {
  stages,
  thresholds,
  summaryTrendStats: ['avg', 'p(95)', 'max'],
};

export default function (data) {
  const elapsedMs = Date.now() - exec.scenario.startTime;
  const step = Math.min(Math.floor(elapsedMs / (STEP_SECONDS * 1000)), STEPS - 1);
  exec.vu.metrics.tags.level = String((step + 1) * STEP_VUS);
  base(data);
}

export function handleSummary(data) {
  const lines = [];
  let lastOk = 0;
  let firstBad = null;
  let lastReached = 0;

  for (let i = 1; i <= STEPS; i++) {
    const level = i * STEP_VUS;
    const reqs = data.metrics[`http_reqs{level:${level}}`];
    const dur = data.metrics[`http_req_duration{level:${level}}`];
    const fail = data.metrics[`http_req_failed{level:${level}}`];
    const count = reqs ? reqs.values.count : 0;
    if (!count) continue;

    lastReached = level;
    const p95 = dur ? dur.values['p(95)'] : 0;
    const err = fail ? fail.values.rate : 0;
    const ok = p95 < SLO_P95_MS && err < SLO_ERROR_RATE;
    if (ok && firstBad === null) lastOk = level;
    if (!ok && firstBad === null) firstBad = level;

    lines.push(
      `${String(level).padStart(8)} | ${String(Math.round(count / STEP_SECONDS)).padStart(7)} | ` +
        `${p95.toFixed(0).padStart(9)} | ${(err * 100).toFixed(1).padStart(6)}% | ${ok ? 'OK' : 'FORA DO SLO'}`
    );
  }

  const header =
    '\n=== PONTO DE RUPTURA DO DISTRICOMMERCE ===\n' +
    `SLO: p95 < ${SLO_P95_MS} ms e erros < ${SLO_ERROR_RATE * 100}% | colapso: p95 > ${COLLAPSE_P95_MS} ms ou erros >= ${COLLAPSE_ERROR_RATE * 100}%\n\n` +
    ' usuarios | req/s ~ | p95 (ms) |  erros | situacao\n' +
    '---------+---------+-----------+--------+-------------';

  const footer =
    '\n\n' +
    `Maior patamar DENTRO do SLO: ${lastOk} usuários virtuais simultâneos\n` +
    (firstBad === null
      ? `Nenhum degrau violou o SLO até ${lastReached} usuários (teto do teste: ${MAX_VUS}).\n`
      : `Primeiro degrau fora do SLO: ${firstBad} usuários virtuais\n`) +
    `Último degrau alcançado: ${lastReached} usuários virtuais\n`;

  const text = `${header}\n${lines.join('\n')}${footer}`;
  return {
    stdout: text,
    '/results/breakpoint.txt': text,
    '/results/breakpoint-summary.json': JSON.stringify(data, null, 2),
  };
}
