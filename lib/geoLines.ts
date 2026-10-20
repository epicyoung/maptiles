/** Helper bersama untuk mengolah garis GeoJSON (tol, rel, dan layer lokal lain). */

export type LonLat = [number, number];

const R_EARTH_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export const roundCoord = (value: number) => Math.round(value * 1e6) / 1e6;

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isValidCoord = (pair: unknown): pair is LonLat =>
  Array.isArray(pair)
  && pair.length >= 2
  && isFiniteNumber(pair[0])
  && isFiniteNumber(pair[1])
  && Math.abs(pair[1]) <= 90
  && Math.abs(pair[0]) <= 180;

/** Validasi titik, bulatkan 6 desimal, buang titik dobel beruntun & garis < 2 titik. */
export function cleanLineCoords(coords: unknown): LonLat[] {
  if (!Array.isArray(coords)) return [];
  const out: LonLat[] = [];
  for (const pair of coords) {
    if (!isValidCoord(pair)) continue;
    const lon = roundCoord(pair[0]);
    const lat = roundCoord(pair[1]);
    const last = out[out.length - 1];
    if (last && last[0] === lon && last[1] === lat) continue;
    out.push([lon, lat]);
  }
  return out.length >= 2 ? out : [];
}

export function segmentKm(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthKm(coords: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += segmentKm(coords[i - 1], coords[i]);
  return total;
}

/** Titik tepat di tengah garis (berdasarkan panjang, bukan jumlah vertex). */
export function midpointOfLine(coords: LonLat[], totalKm: number = lineLengthKm(coords)): LonLat {
  if (coords.length < 2 || totalKm === 0) return coords[0];
  const half = totalKm / 2;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = segmentKm(coords[i - 1], coords[i]);
    if (acc + seg >= half) {
      const t = seg === 0 ? 0 : (half - acc) / seg;
      return [
        roundCoord(coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t),
        roundCoord(coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t),
      ];
    }
    acc += seg;
  }
  return coords[coords.length - 1];
}
