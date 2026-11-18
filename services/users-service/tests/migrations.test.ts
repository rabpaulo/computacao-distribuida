import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guarda de consistência entre as migrations do Flyway (infra/flyway/sql) e os
// serviços que dependem delas. Roda no CI e pega erro antes do deploy:
// migration com nome fora do padrão, versão repetida, buraco na sequência, ou
// serviço exigindo uma versão que não existe.

const REPO = path.resolve(__dirname, '../../..');
const SQL_DIR = path.join(REPO, 'infra', 'flyway', 'sql');
const SERVICES_DIR = path.join(REPO, 'services');

const FILE_PATTERN = /^V(\d+)__([a-z0-9_]+)\.sql$/;

const migrations = fs
  .readdirSync(SQL_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const versions = migrations.map((name) => Number(FILE_PATTERN.exec(name)?.[1] ?? NaN));

// serviço -> REQUIRED_SCHEMA_VERSION declarado no database.ts dele
function requiredVersions(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const service of fs.readdirSync(SERVICES_DIR)) {
    const file = path.join(SERVICES_DIR, service, 'src', 'config', 'database.ts');
    if (!fs.existsSync(file)) continue;
    const match = /REQUIRED_SCHEMA_VERSION\s*=\s*(\d+)/.exec(fs.readFileSync(file, 'utf-8'));
    if (match) result[service] = Number(match[1]);
  }
  return result;
}

describe('Migrations do Flyway', () => {
  it('existe pelo menos uma migration', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations)('%s segue o padrão V<número>__<descricao>.sql', (name) => {
    expect(name).toMatch(FILE_PATTERN);
  });

  it('as versões são inteiras, únicas e sem buracos (1, 2, 3...)', () => {
    // O waitForSchema compara versões como inteiros (MAX(version::int))
    expect(versions).toEqual(versions.map((_, index) => index + 1));
  });

  it('nenhuma migration está vazia', () => {
    for (const name of migrations) {
      const sql = fs.readFileSync(path.join(SQL_DIR, name), 'utf-8');
      const withoutComments = sql.replace(/--.*$/gm, '').trim();
      expect(withoutComments.length, `${name} está vazia`).toBeGreaterThan(0);
    }
  });

  it('nenhuma migration usa ${placeholder}, que o Flyway tentaria substituir', () => {
    for (const name of migrations) {
      expect(fs.readFileSync(path.join(SQL_DIR, name), 'utf-8'), name).not.toContain('${');
    }
  });

  it('cada serviço exige uma versão que existe', () => {
    const required = requiredVersions();
    const latest = Math.max(...versions);

    expect(Object.keys(required).sort()).toEqual([
      'logistics-service',
      'notifications-service',
      'orders-service',
      'payments-service',
      'users-service',
    ]);

    for (const [service, version] of Object.entries(required)) {
      expect(versions, `${service} exige a V${version}, que não existe`).toContain(version);
      expect(version, `${service} exige versão maior que a última migration`).toBeLessThanOrEqual(latest);
    }
  });

  it('os serviços não criam mais tabelas por conta própria', () => {
    for (const service of fs.readdirSync(SERVICES_DIR)) {
      const file = path.join(SERVICES_DIR, service, 'src', 'config', 'database.ts');
      if (!fs.existsSync(file)) continue;
      expect(fs.readFileSync(file, 'utf-8'), service).not.toMatch(/CREATE\s+TABLE/i);
    }
  });
});
