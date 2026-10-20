import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTollLabels, parseTollGeoJson } from './localToll.ts';

const line = (coords, props = {}) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

test('LineString valid diambil, nama dipertahankan, koordinat dibulatkan', () => {
  const parsed = parseTollGeoJson({
    type: 'FeatureCollection',
    features: [line([[106.651234567, -6.301234567], [106.66, -6.31]], { name: 'Tol Jakarta–Cikampek' })],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Tol Jakarta–Cikampek');
  assert.deepEqual(parsed[0].coords, [[106.651235, -6.301235], [106.66, -6.31]]);
});

test('MultiLineString dipecah per segmen, nama default kalau kosong', () => {
  const parsed = parseTollGeoJson({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[106.6, -6.3], [106.61, -6.31]],
          [[106.62, -6.32], [106.63, -6.33], [106.64, -6.34]],
        ],
      },
    }],
  });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Toll road');
  assert.equal(parsed[1].coords.length, 3);
});

test('garis rusak / terlalu pendek / koordinat aneh dilewati', () => {
  const parsed = parseTollGeoJson({
    type: 'FeatureCollection',
    features: [
      line([[106.6, -6.3]]),
      line([[106.6, -6.3], [106.6, -6.3]]),                    // semua titik sama
      line([[106.6, -6.3], ['x', -6.3]]),                      // bukan angka
      line([[106.6, -6.3], [999, -6.3]]),                      // longitude di luar rentang
      line([[106.6, -6.3], [106.61, -6.31]]),                  // valid
      { type: 'Feature', properties: {}, geometry: null },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
      null,
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].coords.length, 2);
});

test('input bukan FeatureCollection menghasilkan array kosong', () => {
  assert.deepEqual(parseTollGeoJson(null), []);
  assert.deepEqual(parseTollGeoJson('nope'), []);
  assert.deepEqual(parseTollGeoJson({ type: 'Feature' }), []);
  assert.deepEqual(parseTollGeoJson({ type: 'FeatureCollection', features: 'x' }), []);
});

test('label tol satu per nama, pakai titik tengah segmen terpanjang', () => {
  const short = { name: 'Tol A', coords: [[106.6, -6.3], [106.61, -6.31]] };
  const long = { name: 'Tol A', coords: [[106.6, -6.3], [106.7, -6.3], [106.8, -6.3], [106.9, -6.3]] };
  const other = { name: 'Tol B', coords: [[107.0, -6.2], [107.1, -6.2]] };
  const labels = buildTollLabels([short, long, other]);
  assert.equal(labels.length, 2);
  const a = labels.find((l) => l.name === 'Tol A');
  assert.deepEqual([a.lon, a.lat], [106.75, -6.3]);
  assert.ok(a.lengthKm > 20);
  assert.equal(labels.find((l) => l.name === 'Tol B').lon, 107.05);
});

test('label generik ("Jalan Tol") dan nama kosong tidak dilabeli', () => {
  const labels = buildTollLabels([
    { name: 'Toll road', coords: [[106.6, -6.3], [106.7, -6.3]] },
    { name: '   ', coords: [[106.6, -6.3], [106.7, -6.3]] },
    { name: 'Tol C', coords: [[106.6, -6.3], [106.62, -6.32]] },
  ]);
  assert.deepEqual(labels.map((l) => l.name), ['Tol C']);
  assert.deepEqual(buildTollLabels([]), []);
});


test('malformed multipart coordinates are skipped', () => {
  assert.deepEqual(parseTollGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: null } }] }), []);
});
