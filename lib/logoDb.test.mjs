import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLogoDb,
  saveLogoToDb,
  getLogoFromDb,
  getAllLogosFromDb,
  deleteLogoFromDb,
  clearAllLogosFromDb,
} from './logoDb.ts';

test('logoDb gracefully handles server-side / non-browser environment', async () => {
  // In Node.js without window or indexedDB, getLogoDb returns null safely
  const db = getLogoDb();
  assert.equal(db, null);

  // All methods should safely resolve without throwing errors
  await assert.doesNotReject(async () => {
    await saveLogoToDb('test', 'data:image/png;base64,123');
    const item = await getLogoFromDb('test');
    assert.equal(item, undefined);
    const all = await getAllLogosFromDb();
    assert.deepEqual(all, {});
    await deleteLogoFromDb('test');
    await clearAllLogosFromDb();
  });
});
