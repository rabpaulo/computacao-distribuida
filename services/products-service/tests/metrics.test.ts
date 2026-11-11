import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

vi.mock('../src/config/database', () => ({
  connectDatabase: vi.fn().mockResolvedValue(undefined),
  disconnectDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockReturnValue(true),
}));

describe('GET /metrics', () => {
  it('expõe métricas no formato Prometheus, incluindo as HTTP do serviço', async () => {
    const app = createApp();
    await request(app).get('/health');

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('service="products-service"');
    expect(res.text).toContain('route="/health"');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });
});
