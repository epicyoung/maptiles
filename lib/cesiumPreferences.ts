export const PREFERENCES_KEY = 'cesium-showcase.preferences.v1';
export const DEFAULT_START_POINT = {
  id: 'hub', name: 'GOP', lon: 106.6527, lat: -6.3015, height: 75, sub: 'Starting Point',
};
export type StartPoint = typeof DEFAULT_START_POINT;

export function parseStartPoint(name: string, latitude: string, longitude: string): StartPoint {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Latitude harus -90 sampai 90; longitude -180 sampai 180. Gunakan titik untuk desimal.');
  }
  return { ...DEFAULT_START_POINT, name: name.trim().slice(0, 100) || 'Titik awal', lat, lon };
}

export function readPreferences(raw: string | null): { hub: StartPoint; autoRotateOnArrival: boolean } {
  const fallback = { hub: DEFAULT_START_POINT, autoRotateOnArrival: false };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value.hub?.name !== 'string' || typeof value.hub.lat !== 'number' || typeof value.hub.lon !== 'number') return fallback;
    return {
      hub: parseStartPoint(value.hub.name, String(value.hub.lat), String(value.hub.lon)),
      autoRotateOnArrival: value.autoRotateOnArrival === true,
    };
  } catch { return fallback; }
}
