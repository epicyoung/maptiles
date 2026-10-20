/** Override per tempat (pin) yang bisa diatur user: nama, label, sembunyikan, logo. */
export type LogoRatio = '3:2' | '4:3';

export type PlaceOverride = {
  name?: string;
  label?: string;
  hidden?: boolean;
  logo?: string;
  ratio?: LogoRatio;
};

export type PlaceOverrides = Record<string, PlaceOverride>;

export const PLACES_KEY = 'cesium-showcase.places.v1';

export const LOGO_RATIOS: { id: LogoRatio; label: string }[] = [
  { id: '3:2', label: '3:2' },
  { id: '4:3', label: '4:3' },
];

const MAX_NAME = 60;
const MAX_LABEL = 40;
const MAX_LOGO_CHARS = 400_000;
const DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i;

export function isLogoDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LOGO_CHARS && DATA_URL_RE.test(value);
}

export function isLogoRatio(value: unknown): value is LogoRatio {
  return value === '3:2' || value === '4:3';
}

/** Nama yang ditampilkan: override user kalau ada, kalau tidak pakai nama bawaan. */
export function placeName(id: string, fallback: string, overrides: PlaceOverrides): string {
  const custom = overrides[id]?.name?.trim();
  return custom || fallback;
}

/** Label kecil di bawah nama pin (mis. "Kantor Pusat"): override user kalau ada. */
export function placeLabel(id: string, fallback: string, overrides: PlaceOverrides): string {
  const custom = overrides[id]?.label?.trim();
  return custom || fallback;
}

/** Buang field yang tidak valid / kosong supaya localStorage tetap bersih. */
function sanitize(source: Record<string, unknown>): PlaceOverride {
  const next: PlaceOverride = {};
  if (typeof source.name === 'string' && source.name.trim()) {
    next.name = source.name.trim().slice(0, MAX_NAME);
  }
  if (typeof source.label === 'string' && source.label.trim()) {
    next.label = source.label.trim().slice(0, MAX_LABEL);
  }
  if (source.hidden === true) next.hidden = true;
  if (isLogoDataUrl(source.logo)) next.logo = source.logo;
  if (isLogoRatio(source.ratio)) next.ratio = source.ratio;
  return next;
}

/** Parse isi localStorage dengan aman: entry rusak / logo bukan gambar / rasio aneh dibuang. */
export function readPlaceOverrides(raw: string | null): PlaceOverrides {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: PlaceOverrides = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!id || typeof entry !== 'object' || entry === null) continue;
      const next = sanitize(entry as Record<string, unknown>);
      if (Object.keys(next).length > 0) out[id] = next;
    }
    return out;
  } catch {
    return {};
  }
}

/** Gabungkan patch ke satu tempat; nilai kosong berarti hapus field tersebut. */
export function mergeOverride(
  overrides: PlaceOverrides,
  id: string,
  patch: PlaceOverride
): PlaceOverrides {
  const next = sanitize({ ...overrides[id], ...patch });
  const out = { ...overrides };
  if (Object.keys(next).length === 0) delete out[id];
  else out[id] = next;
  return out;
}

/** Hapus semua override milik satu tempat (dipakai saat tempat dihapus). */
export function removeOverride(overrides: PlaceOverrides, id: string): PlaceOverrides {
  const out = { ...overrides };
  delete out[id];
  return out;
}
