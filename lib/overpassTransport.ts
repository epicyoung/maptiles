import type { Feature, FeatureCollection } from 'geojson';

export const COVERAGE_RADII = [5, 10, 20, 30] as const;
export type TransportArea = { lat: number; lon: number; radiusKm: number };
type TransportCoverage = {
  toll: FeatureCollection;
  railway: FeatureCollection;
  timestamp: string | null;
  fetchedAt: number;
};

const cache = new Map<string, TransportCoverage>();
const CACHE_MS = 10 * 60 * 1000;

// Overpass kadang menolak request (406/429/504) tergantung endpoint/beban server.
// Kita coba beberapa mirror berurutan supaya data tetap masuk walau satu server bermasalah.
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  Accept: '*/*',
  'User-Agent': 'Maptiles-Showcase/1.0 (Cesium map demo)',
};

type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

export function buildTransportQuery({ lat, lon, radiusKm }: TransportArea): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180
    || !COVERAGE_RADII.some(radius => radius === radiusKm)) throw new Error('Cakupan peta tidak valid.');
  const around = `(around:${radiusKm * 1000},${lat},${lon})`;
  // `out geom` mengembalikan geometri langsung di tiap way (tanpa perlu join node),
  // jadi konversi ke GeoJSON bisa dilakukan tanpa library tambahan.
  return `[out:json][timeout:25][maxsize:33554432];(
way["highway"~"^(motorway|motorway_link)$"]${around};
way["railway"~"^(rail|light_rail|subway|tram)$"]${around};
node["railway"~"^(station|halt)$"]${around};
);out geom;`;
}

function osmToGeoJSON(elements: OsmElement[]): FeatureCollection {
  const features: Feature[] = [];
  for (const el of elements) {
    if (!el.tags) continue;
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      const coordinates = el.geometry.map(pt => [pt.lon, pt.lat]);
      features.push({ type: 'Feature', properties: { ...el.tags }, geometry: { type: 'LineString', coordinates } });
    } else if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
      features.push({ type: 'Feature', properties: { ...el.tags }, geometry: { type: 'Point', coordinates: [el.lon, el.lat] } });
    }
  }
  return { type: 'FeatureCollection', features };
}

const PER_ENDPOINT_MS = 12000;

function mergeSignals(signals: AbortSignal[]): AbortSignal | undefined {
  const list = signals.filter(Boolean);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal) return AbortSignal.any(list);
  return list[0];
}

async function fetchOsm(query: string, options: { signal?: AbortSignal; fetcher?: typeof fetch }): Promise<any> {
  const doFetch = options.fetcher || fetch;
  let lastError: Error | null = null;
  for (const endpoint of ENDPOINTS) {
    // Timeout per-endpoint supaya mirror yang lambat/gantung cepat dilewati ke mirror berikutnya.
    const timeoutSignal = (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal)
      ? AbortSignal.timeout(PER_ENDPOINT_MS)
      : undefined;
    const signal = mergeSignals([options.signal, timeoutSignal].filter(Boolean) as AbortSignal[]);
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: HEADERS,
        body: new URLSearchParams({ data: query }).toString(),
        signal,
      });
      if (response.ok) return await response.json();
      // 406 = ditolak, 429/504 = sibuk -> coba mirror berikutnya
      lastError = new Error(
        response.status === 429 || response.status === 504
          ? 'Overpass sedang sibuk. Coba radius lebih kecil atau ulangi sebentar lagi.'
          : response.status === 406
            ? 'Server Overpass menolak permintaan.'
            : `Data OpenStreetMap gagal dimuat (HTTP ${response.status}).`
      );
    } catch (error) {
      // Dibatalkan user (ganti radius / unmount) harus langsung dilempar.
      if (options.signal?.aborted) throw error;
      const name = (error as any)?.name;
      // Timeout per-endpoint -> lanjut ke mirror berikutnya.
      if (name === 'TimeoutError') {
        lastError = new Error('Server Overpass terlalu lambat merespons.');
        continue;
      }
      if (name === 'AbortError') throw error;
      lastError = error instanceof Error ? error : new Error('Gagal terhubung ke server Overpass.');
    }
  }
  throw lastError || new Error('Semua server Overpass sedang tidak tersedia.');
}

export async function loadTransportCoverage(area: TransportArea, options: {
  signal?: AbortSignal;
  force?: boolean;
  fetcher?: typeof fetch;
} = {}): Promise<TransportCoverage> {
  const query = buildTransportQuery(area);
  const key = `${area.lat.toFixed(6)},${area.lon.toFixed(6)},${area.radiusKm}`;
  const cached = cache.get(key);
  if (!options.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;

  const osm = await fetchOsm(query, options);
  if (osm.remark || !Array.isArray(osm.elements)) {
    throw new Error('Overpass belum mengembalikan data lengkap. Kurangi radius lalu coba lagi.');
  }

  const geojson = osmToGeoJSON(osm.elements as OsmElement[]);
  const result: TransportCoverage = {
    toll: { type: 'FeatureCollection', features: [] },
    railway: { type: 'FeatureCollection', features: [] },
    timestamp: typeof osm.osm3s?.timestamp_osm_base === 'string' ? osm.osm3s.timestamp_osm_base : null,
    fetchedAt: Date.now(),
  };
  for (const feature of geojson.features) {
    const geometryType = feature.geometry.type;
    const line = geometryType === 'LineString' || geometryType === 'MultiLineString';
    const point = geometryType === 'Point';
    const props = (feature.properties || {}) as Record<string, string>;
    if (line && /^(motorway|motorway_link)$/.test(props.highway || '')) {
      result.toll.features.push(feature);
    } else if ((line && /^(rail|light_rail|subway|tram)$/.test(props.railway || ''))
      || (point && /^(station|halt)$/.test(props.railway || ''))) {
      result.railway.features.push(feature);
    }
  }
  cache.set(key, result);
  if (cache.size > 10) cache.delete(cache.keys().next().value!);
  return result;
}
