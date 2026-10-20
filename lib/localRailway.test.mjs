import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRailwayGeoJson } from './localRailway.ts';

const feature = (geometry, props = {}) => ({ type: 'Feature', properties: props, geometry });

test('jalur rel & stasiun dipisah, nama stasiun dipakai', () => {
  const data = parseRailwayGeoJson({
    type: 'FeatureCollection',
    features: [
      feature({ type: 'LineString', coordinates: [[106.6, -6.3], [106.61, -6.31]] }),
      feature({
        type: 'MultiLineString',
        coordinates: [
          [[106.62, -6.32], [106.63, -6.33]],
          [[106.64, -6.34], [106.65, -6.35], [106.66, -6.36]],
        ],
      }),
      feature({ type: 'Point', coordinates: [106.6433, -6.3248] }, { name: 'Cisauk' }),
      feature({ type: 'Point', coordinates: [106.7, -6.2] }),
    ],
  });
  assert.equal(data.lines.length, 3);
  assert.equal(data.stations.length, 2);
  assert.deepEqual(data.stations[0], { name: 'Cisauk', lon: 106.6433, lat: -6.3248 });
  assert.equal(data.stations[1].name, 'Station');
});

test('data rusak dilewati, input salah bentuk jadi kosong', () => {
  const data = parseRailwayGeoJson({
    type: 'FeatureCollection',
    features: [
      feature({ type: 'LineString', coordinates: [[106.6, -6.3]] }),        // 1 titik
      feature({ type: 'LineString', coordinates: [[106.6, -6.3], [999, 0]] }), // di luar rentang
      feature({ type: 'Point', coordinates: ['x', -6.3] }),
      feature(null),
      null,
    ],
  });
  assert.deepEqual(data.lines, []);
  assert.deepEqual(data.stations, []);
  assert.deepEqual(parseRailwayGeoJson(null), { lines: [], stations: [] });
  assert.deepEqual(parseRailwayGeoJson('nope'), { lines: [], stations: [] });
});


test('malformed geometry coordinates are skipped without crashing', () => {
  for (const geometry of [
    { type: 'Point', coordinates: null },
    { type: 'Point' },
    { type: 'MultiLineString', coordinates: null },
    { type: 'MultiLineString', coordinates: {} },
  ]) {
    assert.deepEqual(parseRailwayGeoJson({ type: 'FeatureCollection', features: [feature(geometry)] }), { lines: [], stations: [] });
  }
});


test('local loader reports a missing file and HTTP failures without API fallback', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => { requests.push([url, options.signal]); return new Response('', { status: 404 }); };
    const { loadRailwayGeoJson } = await import('./localRailway.ts');
    assert.equal(await loadRailwayGeoJson(undefined, controller.signal), null);
    assert.deepEqual(requests, [['/data/railway.geojson', controller.signal]]);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(loadRailwayGeoJson(), /HTTP 503/);
    globalThis.fetch = async () => Response.json({ type: 'FeatureCollection', features: [feature({ type: 'Point', coordinates: [106.6, -6.3] }, { name: 'Cisauk' })] });
    assert.equal((await loadRailwayGeoJson()).stations[0].name, 'Cisauk');
  } finally { globalThis.fetch = originalFetch; }
});


test('station polygons use their name and bounds center, including the supplied Poris station', () => {
  const data = parseRailwayGeoJson({ type: 'FeatureCollection', features: [
    feature({ type: 'Polygon', coordinates: [[[106.6, -6.2], [106.62, -6.2], [106.62, -6.22], [106.6, -6.2]]] }, { name: 'Stasiun Poris', railway: 'station' }),
    feature({ type: 'Polygon', coordinates: null }, { railway: 'station' }),
    feature({ type: 'Polygon', coordinates: [[[106.6, -6.2], [106.62, -6.22]]] }, { name: 'Not a station' }),
  ] });
  assert.equal(data.stations.length, 1);
  assert.deepEqual(data.stations[0], { name: 'Stasiun Poris', lon: 106.61, lat: -6.21 });
});
