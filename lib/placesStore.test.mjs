import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetupBundle,
  parsePois,
  readPois,
  readSetupBundle,
  SETUP_VERSION,
} from './placesStore.ts';

const poi = {
  id: 'custom-1',
  name: 'BSD Plaza',
  lon: 106.65,
  lat: -6.3,
  height: 60,
  estTime: '25 min',
  estDist: '20.7 km',
  category: 'custom',
};

test('poi valid dipertahankan, field kurang diisi default', () => {
  const parsed = parsePois([poi, { ...poi, id: 'x2', height: undefined, estTime: undefined }]);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { ...poi });
  assert.equal(parsed[1].height, 60);
  assert.equal(parsed[1].estTime, '');
});

test('poi rusak dibuang: tanpa id/nama, koordinat aneh, id ganda, kategori asing', () => {
  const parsed = parsePois([
    { ...poi, id: '' },
    { ...poi, name: '   ' },
    { ...poi, lat: 999 },
    { ...poi, lon: 'x' },
    poi,
    { ...poi },                       // id ganda
    { ...poi, id: 'k3', category: 'weird' },
    null,
    'nope',
  ]);
  assert.deepEqual(parsed.map((p) => p.id), ['custom-1', 'k3']);
  assert.equal(parsed[1].category, 'custom');
});

test('readPois aman untuk localStorage rusak / kosong', () => {
  assert.deepEqual(readPois(null), []);
  assert.deepEqual(readPois('{broken'), []);
  assert.deepEqual(readPois('{"a":1}'), []);
  assert.equal(readPois(JSON.stringify([poi])).length, 1);
});

test('bundle setup membawa hub, skin, override, dan pois', () => {
  const bundle = buildSetupBundle({
    hub: { id: 'hub', name: 'GOP', lon: 106.6527, lat: -6.3015, height: 75, sub: 'Starting Point' },
    autoRotateOnArrival: true,
    skin: 'dark',
    places: { 'custom-1': { name: 'Plaza', label: 'Kantor' } },
    pois: [poi],
    exportedAt: '2026-10-20T00:00:00.000Z',
  });
  assert.equal(bundle.version, SETUP_VERSION);
  assert.equal(bundle.exportedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(bundle.pois.length, 1);

  const again = readSetupBundle(JSON.parse(JSON.stringify(bundle)));
  assert.ok(again);
  assert.equal(again.autoRotateOnArrival, true);
  assert.equal(again.skin, 'dark');
  assert.equal(again.pois.length, 1);

  assert.equal(readSetupBundle(null), null);
  assert.equal(readSetupBundle([1, 2]), null);
});


test('unrecognized or damaged settings cannot clear existing browser data', () => {
  for (const raw of [{}, { type: 'FeatureCollection', features: [] }, { version: 999, pois: [] }, { version: SETUP_VERSION, hub: { name: 'Bad', lat: 999, lon: 106 }, pois: [] }]) {
    assert.equal(readSetupBundle(raw), null);
  }
});
