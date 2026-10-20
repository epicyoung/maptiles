export const PREFERENCES_KEY = 'cesium-showcase.preferences.v1';
export const DEFAULT_START_POINT = {
  id: 'hub', name: 'GOP', lon: 106.6527, lat: -6.3015, height: 75, sub: 'Starting Point',
};
export type StartPoint = typeof DEFAULT_START_POINT;

/**
 * Skema tile peta yang bisa dipilih dari panel Settings.
 * Semua provider di bawah memakai skema XYZ ({y} dari utara), sesuai perilaku
 * UrlTemplateImageryProvider di Cesium 1.115 — jadi tidak perlu `flipY`/`reverseY`.
 */
export const MAP_SKINS = [
  { id: 'esri', label: 'Esri Satellite', hint: 'Default satellite imagery' },
  { id: 'gmap', label: 'Google Maps', hint: 'Google road map' },
  { id: 'dark', label: 'Dark Canvas', hint: 'Dark map for toll roads and railways' },
  { id: 'osm', label: 'OpenStreetMap', hint: 'OSM community map' },
] as const;

export type MapSkin = (typeof MAP_SKINS)[number]['id'];
export const DEFAULT_MAP_SKIN: MapSkin = 'esri';

export function isMapSkin(value: unknown): value is MapSkin {
  return typeof value === 'string' && MAP_SKINS.some((skin) => skin.id === value);
}

export function parseStartPoint(name: string, latitude: string, longitude: string): StartPoint {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Latitude must be between -90 and 90; longitude between -180 and 180. Use a decimal point.');
  }
  return { ...DEFAULT_START_POINT, name: name.trim().slice(0, 100) || 'Starting point', lat, lon };
}

export function readPreferences(raw: string | null): {
  hub: StartPoint;
  autoRotateOnArrival: boolean;
  skin: MapSkin;
} {
  const fallback = { hub: DEFAULT_START_POINT, autoRotateOnArrival: false, skin: DEFAULT_MAP_SKIN };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value.hub?.name !== 'string' || typeof value.hub.lat !== 'number' || typeof value.hub.lon !== 'number') return fallback;
    return {
      hub: parseStartPoint(value.hub.name, String(value.hub.lat), String(value.hub.lon)),
      autoRotateOnArrival: value.autoRotateOnArrival === true,
      skin: isMapSkin(value.skin) ? value.skin : DEFAULT_MAP_SKIN,
    };
  } catch { return fallback; }
}
