/** Loader data tol lokal (hasil download OSM) supaya tidak bergantung request Overpass. */
import type { FeatureCollection, Geometry } from 'geojson';
import { cleanLineCoords, lineLengthKm, midpointOfLine, type LonLat } from './geoLines.ts';

export type TollLine = {
  /** [[lon, lat], ...] */
  coords: LonLat[];
  name: string;
};

/** Label nama tol: satu titik per nama, diletakkan di tengah segmen terpanjang. */
export type TollLabel = { name: string; lon: number; lat: number; lengthKm: number };

export const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/gh/epicyoung/maptiles@master/public/data';

export const TOLL_GEOJSON_URL =
  process.env.NEXT_PUBLIC_TOLL_GEOJSON_URL
  || (process.env.NEXT_PUBLIC_DATA_BASE_URL
    ? `${process.env.NEXT_PUBLIC_DATA_BASE_URL.replace(/\/$/, '')}/tol.geojson`
    : '/data/tol.geojson');

/**
 * Parse GeoJSON tol jadi daftar garis siap gambar.
 * Menerima LineString & MultiLineString; feature/geometri rusak dilewati.
 */
export function parseTollGeoJson(raw: unknown): TollLine[] {
  if (!raw || typeof raw !== 'object') return [];
  const collection = raw as FeatureCollection;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) return [];

  const lines: TollLine[] = [];
  for (const feature of collection.features) {
    if (!feature || typeof feature !== 'object') continue;
    const geometry = feature.geometry as Geometry | null;
    if (!geometry || typeof geometry !== 'object') continue;
    const name = typeof feature.properties?.name === 'string' ? feature.properties.name : 'Toll road';

    if (geometry.type === 'LineString') {
      const coords = cleanLineCoords(geometry.coordinates);
      if (coords.length >= 2) lines.push({ coords, name });
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      for (const part of geometry.coordinates) {
        const coords = cleanLineCoords(part);
        if (coords.length >= 2) lines.push({ coords, name });
      }
    }
  }
  return lines;
}

export async function loadTollGeoJson(
  url: string = TOLL_GEOJSON_URL,
  signal?: AbortSignal
): Promise<TollLine[]> {
  try {
    const response = await fetch(url, { signal });
    if (response.ok) {
      return parseTollGeoJson(await response.json());
    }
    if (url === '/data/tol.geojson') {
      throw new Error(`Failed to load local toll data (HTTP ${response.status}).`);
    }
  } catch (err) {
    if (url === '/data/tol.geojson') throw err;
  }

  // Fallback ke aset lokal jika remote URL / CDN gagal
  const fallback = await fetch('/data/tol.geojson', { signal });
  if (!fallback.ok) {
    throw new Error(`Failed to load local toll data (HTTP ${fallback.status}).`);
  }
  return parseTollGeoJson(await fallback.json());
}

/**
 * Satu label per nama tol (mis. "Jakarta–Cikampek Toll Road"), bukan per segmen.
 * Titik label = tengah dari segmen terpanjang milik nama tersebut.
 */
export function buildTollLabels(lines: TollLine[]): TollLabel[] {
  const best = new Map<string, { coords: LonLat[]; lengthKm: number }>();
  for (const line of lines) {
    const name = line.name.trim();
    // Nama generik (fitur tanpa nama di OSM) tidak usah dilabeli.
    if (!name || name === 'Toll road' || name === 'Jalan Tol') continue;
    const lengthKm = lineLengthKm(line.coords);
    const prev = best.get(name);
    if (!prev || lengthKm > prev.lengthKm) {
      best.set(name, { coords: line.coords, lengthKm });
    }
  }
  const labels: TollLabel[] = [];
  for (const [name, { coords, lengthKm }] of best) {
    const [lon, lat] = midpointOfLine(coords, lengthKm);
    labels.push({ name, lon, lat, lengthKm: Math.round(lengthKm * 10) / 10 });
  }
  return labels;
}
