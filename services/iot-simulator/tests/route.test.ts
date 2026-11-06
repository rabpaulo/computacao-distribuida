import { describe, it, expect } from 'vitest';
import { haversineKm, nextCargoTemp, positionAt } from '../src/route';

const A = { lat: -23.5614, lng: -46.6559 };
const B = { lat: -23.6, lng: -46.6 };

describe('IoT Simulator - rota e sensores', () => {
  it('começa na origem e termina no destino', () => {
    expect(positionAt(A, B, 0)).toEqual(A);
    expect(positionAt(A, B, 1)).toEqual(B);
  });

  it('limita o progresso entre 0 e 1', () => {
    expect(positionAt(A, B, -1)).toEqual(A);
    expect(positionAt(A, B, 2)).toEqual(B);
  });

  it('calcula distância plausível com haversine', () => {
    const km = haversineKm(A, B);
    expect(km).toBeGreaterThan(6);
    expect(km).toBeLessThan(8);
  });

  it('temperatura volta para perto de 22°C sem picos', () => {
    let t = 30;
    for (let i = 0; i < 50; i++) t = nextCargoTemp(t, 0, () => 0.5);
    expect(t).toBeCloseTo(22, 0);
  });

  it('gera pico de temperatura quando o sensor dispara', () => {
    expect(nextCargoTemp(22, 1, () => 0)).toBeGreaterThanOrEqual(30);
  });
});
