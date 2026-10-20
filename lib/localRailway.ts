/** Loader data rel kereta & stasiun dari file JSON lokal (public/data/railway.geojson). */
import type { FeatureCollection, Geometry } from 'geojson';
import { cleanLineCoords, isValidCoord, roundCoord, type LonLat } from './geoLines.ts';

export type RailwayStation = { name: string; lon: number; lat: number };
export type RailwayData = { lines: LonLat[][]; stations: RailwayStation[] };

export const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/gh/epicyoung/maptiles@master/public/data';

export const RAILWAY_GEOJSON_URL =
  process.env.NEXT_PUBLIC_RAILWAY_GEOJSON_URL
  || (process.env.NEXT_PUBLIC_DATA_BASE_URL
    ? `${process.env.NEXT_PUBLIC_DATA_BASE_URL.replace(/\/$/, '')}/railway.geojson`
    : '/data/railway.geojson');

/**
 * Terima FeatureCollection berisi LineString (jalur rel) dan Point (stasiun).
 * Properti `name` dipakai untuk label stasiun; kalau kosong pakai "Station".
 */
export function parseRailwayGeoJson(raw: unknown): RailwayData {
  const empty: RailwayData = { lines: [], stations: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const collection = raw as FeatureCollection;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) return empty;

  const lines: LonLat[][] = [];
  const stations: RailwayStation[] = [];

  for (const feature of collection.features) {
    if (!feature || typeof feature !== 'object') continue;
    const geometry = feature.geometry as Geometry | null;
    if (!geometry || typeof geometry !== 'object') continue;

    if (geometry.type === 'LineString') {
      const coords = cleanLineCoords(geometry.coordinates);
      if (coords.length >= 2) lines.push(coords);
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      for (const part of geometry.coordinates) {
        const coords = cleanLineCoords(part);
        if (coords.length >= 2) lines.push(coords);
      }
    }
    let stationCoord: LonLat | undefined;
    if (geometry.type === 'Point' && isValidCoord(geometry.coordinates)) {
      stationCoord = [geometry.coordinates[0], geometry.coordinates[1]];
    } else if (geometry.type === 'Polygon' && feature.properties?.railway === 'station'
      && Array.isArray(geometry.coordinates)) {
      const ring = cleanLineCoords(geometry.coordinates[0]);
      if (ring.length >= 3) {
        const bounds = ring.reduce(([west, south, east, north], [lon, lat]) =>
          [Math.min(west, lon), Math.min(south, lat), Math.max(east, lon), Math.max(north, lat)],
        [Infinity, Infinity, -Infinity, -Infinity]);
        stationCoord = [roundCoord((bounds[0] + bounds[2]) / 2), roundCoord((bounds[1] + bounds[3]) / 2)];
      }
    }
    if (stationCoord) {
      const name = typeof feature.properties?.name === 'string' && feature.properties.name.trim()
        ? feature.properties.name.trim().slice(0, 60)
        : 'Station';
      stations.push({ name, lon: stationCoord[0], lat: stationCoord[1] });
    }
  }

  return { lines, stations };
}

/** null = file belum tersedia (404), supaya UI bisa kasih tahu "data belum ada". */
export async function loadRailwayGeoJson(
  url: string = RAILWAY_GEOJSON_URL,
  signal?: AbortSignal
): Promise<RailwayData | null> {
  try {
    const response = await fetch(url, { signal });
    if (response.status === 404 && url === '/data/railway.geojson') return null;
    if (response.ok) {
      return parseRailwayGeoJson(await response.json());
    }
    if (url === '/data/railway.geojson') {
      throw new Error(`Failed to load local railway data (HTTP ${response.status}).`);
    }
  } catch (err) {
    if (url === '/data/railway.geojson') throw err;
  }

  // Fallback ke file lokal jika remote URL / CDN gagal
  const fallback = await fetch('/data/railway.geojson', { signal });
  if (fallback.status === 404) return null;
  if (!fallback.ok) {
    throw new Error(`Failed to load local railway data (HTTP ${fallback.status}).`);
  }
  return parseRailwayGeoJson(await fallback.json());
}
