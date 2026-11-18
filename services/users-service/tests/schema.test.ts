import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: vi.fn(() => ({ query, end: vi.fn() })),
}));

import { REQUIRED_SCHEMA_VERSION, waitForSchema } from '../src/config/database';

// O serviço não cria tabelas: espera o Flyway aplicar as migrations
describe('Users Service - espera pelo schema do Flyway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('segue direto quando o schema já está na versão exigida', async () => {
    query.mockResolvedValueOnce({ rows: [{ version: REQUIRED_SCHEMA_VERSION }] });

    await expect(waitForSchema(1000, 1)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('flyway_schema_history');
    // migration que falhou no meio não conta como aplicada
    expect(sql).toContain('success = true');
  });

  it('segue quando o banco já está numa versão MAIS NOVA que a exigida', async () => {
    query.mockResolvedValueOnce({ rows: [{ version: REQUIRED_SCHEMA_VERSION + 3 }] });
    await expect(waitForSchema(1000, 1)).resolves.toBeUndefined();
  });

  it('espera enquanto o Flyway não terminou e segue quando a versão chega', async () => {
    query
      .mockRejectedValueOnce(new Error('relation "flyway_schema_history" does not exist'))
      .mockResolvedValueOnce({ rows: [{ version: 0 }] })
      .mockResolvedValueOnce({ rows: [{ version: REQUIRED_SCHEMA_VERSION }] });

    await expect(waitForSchema(5000, 1)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(3);
  });

  it('desiste com uma mensagem que diz o que fazer', async () => {
    query.mockRejectedValue(new Error('relation "flyway_schema_history" does not exist'));

    const result = waitForSchema(30, 5);

    await expect(result).rejects.toThrow(/Schema do banco não está pronto/);
    await expect(result).rejects.toThrow(/flyway_schema_history/);
    await expect(result).rejects.toThrow(/docker compose run --rm flyway/);
  });

  it('recusa um banco numa versão mais antiga que a exigida', async () => {
    query.mockResolvedValue({ rows: [{ version: REQUIRED_SCHEMA_VERSION - 1 }] });

    await expect(waitForSchema(30, 5)).rejects.toThrow(/mínima exigida/);
  });
});
