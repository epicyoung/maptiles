import { isMapSkin } from './cesiumPreferences.ts';

/** Penyimpanan daftar tempat (pois) + bundle setup yang bisa diekspor/impor. */
export type PoiCategory = 'near' | 'far' | 'custom';

export type StoredPoi = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  height: number;
  estTime: string;
  estDist: string;
  category: PoiCategory;
};

export const POIS_KEY = 'cesium-showcase.pois.v1';
export const SETUP_VERSION = 1;
const MAX_POIS = 200;
const MAX_ID = 80;
const MAX_TEXT = 80;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function sanitizePoi(raw: unknown): StoredPoi | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id.trim().slice(0, MAX_ID) : '';
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, MAX_TEXT) : '';
  if (!id || !name) return null;
  if (!isFiniteNumber(source.lat) || !isFiniteNumber(source.lon)) return null;
  if (Math.abs(source.lat) > 90 || Math.abs(source.lon) > 180) return null;
  const category: PoiCategory =
    source.category === 'near' || source.category === 'far' || source.category === 'custom'
      ? source.category
      : 'custom';
  return {
    id,
    name,
    lon: source.lon,
    lat: source.lat,
    height: isFiniteNumber(source.height) ? source.height : 60,
    estTime: typeof source.estTime === 'string' ? source.estTime.slice(0, 40) : '',
    estDist: typeof source.estDist === 'string' ? source.estDist.slice(0, 40) : '',
    category,
  };
}

/** Validasi daftar tempat dari JSON apa pun; id ganda & data rusak dibuang. */
export function parsePois(raw: unknown): StoredPoi[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredPoi[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const poi = sanitizePoi(item);
    if (!poi || seen.has(poi.id)) continue;
    seen.add(poi.id);
    out.push(poi);
    if (out.length >= MAX_POIS) break;
  }
  return out;
}

export function readPois(raw: string | null): StoredPoi[] {
  if (!raw) return [];
  try {
    return parsePois(JSON.parse(raw));
  } catch {
    return [];
  }
}

export type SetupBundle = {
  version: number;
  exportedAt: string;
  hub: unknown;
  autoRotateOnArrival: boolean;
  skin: unknown;
  places: unknown;
  pois: StoredPoi[];
};

/** Bangun file backup: hub, skin, override tempat, dan daftar tempat. */
export function buildSetupBundle(input: {
  hub: unknown;
  autoRotateOnArrival: boolean;
  skin: unknown;
  places: unknown;
  pois: StoredPoi[];
  exportedAt?: string;
}): SetupBundle {
  return {
    version: SETUP_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    hub: input.hub,
    autoRotateOnArrival: input.autoRotateOnArrival === true,
    skin: input.skin,
    places: input.places ?? {},
    pois: parsePois(input.pois),
  };
}

/** Reject unrelated or damaged JSON before replacing saved settings. */
export function readSetupBundle(raw: unknown): SetupBundle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const hub = source.hub as Record<string, unknown> | null;
  if (source.version !== SETUP_VERSION || !Array.isArray(source.pois)
    || !hub || typeof hub !== 'object' || typeof hub.name !== 'string' || !hub.name.trim()
    || !isFiniteNumber(hub.lat) || !isFiniteNumber(hub.lon)
    || Math.abs(hub.lat) > 90 || Math.abs(hub.lon) > 180
    || !isMapSkin(source.skin)
    || !source.places || typeof source.places !== 'object' || Array.isArray(source.places)
    || typeof source.autoRotateOnArrival !== 'boolean') return null;
  const pois = parsePois(source.pois);
  if (pois.length !== source.pois.length) return null;
  return {
    version: SETUP_VERSION,
    exportedAt: typeof source.exportedAt === 'string' ? source.exportedAt : '',
    hub: source.hub,
    autoRotateOnArrival: source.autoRotateOnArrival === true,
    skin: source.skin,
    places: source.places,
    pois,
  };
}
