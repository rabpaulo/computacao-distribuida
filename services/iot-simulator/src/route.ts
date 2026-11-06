import { GeoPoint } from './topics';

// Matematica de rota, separada para dar pra testar sem MQTT

// Distancia em km entre dois pontos (formula de haversine)
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Ponto na reta origem -> destino. O "desvio" faz a rota parecer uma rua de
// verdade (curva suave), e some nas pontas para comecar e terminar no lugar
// certo.
export function positionAt(origin: GeoPoint, destination: GeoPoint, progress: number, curve = 0.15): GeoPoint {
  const p = Math.min(1, Math.max(0, progress));
  const lat = origin.lat + (destination.lat - origin.lat) * p;
  const lng = origin.lng + (destination.lng - origin.lng) * p;

  // Deslocamento perpendicular em forma de seno
  const bend = Math.sin(p * Math.PI) * curve;
  const perpLat = -(destination.lng - origin.lng) * bend;
  const perpLng = (destination.lat - origin.lat) * bend;

  return {
    lat: Number((lat + perpLat).toFixed(6)),
    lng: Number((lng + perpLng).toFixed(6)),
  };
}

// Sensor de temperatura do bau: passeio aleatorio em volta de 22°C, com
// picos ocasionais (porta aberta, refrigeracao falhando) que geram alerta.
export function nextCargoTemp(current: number, spikeProbability: number, rand = Math.random): number {
  if (rand() < spikeProbability) {
    return Number((current + 8 + rand() * 4).toFixed(1));
  }
  const drift = (22 - current) * 0.2; // volta pro normal aos poucos
  const noise = (rand() - 0.5) * 0.8;
  return Number((current + drift + noise).toFixed(1));
}
