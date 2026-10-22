import Dexie, { type Table } from 'dexie';

export type LogoRatio = '3:2' | '4:3';

export interface StoredLogo {
  id: string; // place/poi id, e.g. "hub", "aeon"
  dataUrl: string; // data URL of the image
  ratio?: LogoRatio;
  updatedAt: number;
}

export class MaptilesLogoDB extends Dexie {
  logos!: Table<StoredLogo, string>;

  constructor() {
    super('MaptilesLogoDB');
    this.version(1).stores({
      logos: 'id, updatedAt',
    });
  }
}

let dbInstance: MaptilesLogoDB | null = null;

export function getLogoDb(): MaptilesLogoDB | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return null;
  }
  if (!dbInstance) {
    dbInstance = new MaptilesLogoDB();
  }
  return dbInstance;
}

/** Simpan atau update logo ke Dexie IndexedDB */
export async function saveLogoToDb(id: string, dataUrl: string, ratio?: LogoRatio): Promise<void> {
  const db = getLogoDb();
  if (!db) return;
  await db.logos.put({
    id,
    dataUrl,
    ratio: ratio ?? '3:2',
    updatedAt: Date.now(),
  });
}

/** Ambil single logo dari Dexie */
export async function getLogoFromDb(id: string): Promise<StoredLogo | undefined> {
  const db = getLogoDb();
  if (!db) return undefined;
  return db.logos.get(id);
}

/** Ambil semua logo yang tersimpan di Dexie */
export async function getAllLogosFromDb(): Promise<Record<string, { dataUrl: string; ratio?: LogoRatio }>> {
  const db = getLogoDb();
  if (!db) return {};
  try {
    const list = await db.logos.toArray();
    const result: Record<string, { dataUrl: string; ratio?: LogoRatio }> = {};
    for (const item of list) {
      if (item.id && item.dataUrl) {
        result[item.id] = { dataUrl: item.dataUrl, ratio: item.ratio };
      }
    }
    return result;
  } catch (err) {
    console.warn('Failed to load logos from IndexedDB:', err);
    return {};
  }
}

/** Hapus logo dari Dexie */
export async function deleteLogoFromDb(id: string): Promise<void> {
  const db = getLogoDb();
  if (!db) return;
  try {
    await db.logos.delete(id);
  } catch (err) {
    console.warn(`Failed to delete logo for ${id}:`, err);
  }
}

/** Hapus seluruh logo di Dexie */
export async function clearAllLogosFromDb(): Promise<void> {
  const db = getLogoDb();
  if (!db) return;
  try {
    await db.logos.clear();
  } catch (err) {
    console.warn('Failed to clear logos:', err);
  }
}

/**
 * Migrasi otomatis: jika ada logo lama yang tersangkut di localStorage,
 * pindahkan ke Dexie IndexedDB dan bersihkan localStorage agar kuota 5MB aman.
 */
export async function migrateLogosFromLocalStorage(placesKey: string): Promise<Record<string, { dataUrl: string; ratio?: LogoRatio }>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(placesKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    let hasLogos = false;
    const migrated: Record<string, { dataUrl: string; ratio?: LogoRatio }> = {};

    for (const [id, entry] of Object.entries(parsed as Record<string, Record<string, unknown>>)) {
      if (entry && typeof entry.logo === 'string' && entry.logo.startsWith('data:image/')) {
        hasLogos = true;
        const ratio = (entry.ratio === '4:3' ? '4:3' : '3:2') as LogoRatio;
        migrated[id] = { dataUrl: entry.logo, ratio };
        await saveLogoToDb(id, entry.logo, ratio);
        // Hapus logo dari object localStorage
        delete entry.logo;
      }
    }

    // Jika ada yang dipindahkan, update localStorage tanpa string base64 logo yang berat
    if (hasLogos) {
      try {
        localStorage.setItem(placesKey, JSON.stringify(parsed));
      } catch {
        // Abaikan jika localStorage terkendala
      }
    }

    return migrated;
  } catch {
    return {};
  }
}
