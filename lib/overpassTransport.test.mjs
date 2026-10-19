import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransportQuery, loadTransportCoverage } from './overpassTransport.ts';

const area = { lat: -6.3015, lon: 106.6527, radiusKm: 10 };

// Format `out geom`: way membawa `geometry` langsung, node membawa lat/lon.
const osm = {
  osm3s: { timestamp_osm_base: '2026-10-19T15:00:00Z' },
  elements: [
    { type: 'node', id: 3, lat: -6.32, lon: 106.67, tags: { railway: 'station', name: 'Cisauk' } },
    { type: 'way', id: 10, tags: { highway: 'motorway', name: 'Tol' }, geometry: [{ lat: -6.3, lon: 106.65 }, { lat: -6.31, lon: 106.66 }] },
    { type: 'way', id: 11, tags: { railway: 'rail', name: 'KRL' }, geometry: [{ lat: -6.31, lon: 106.66 }, { lat: -6.32, lon: 106.67 }] },
  ],
};

test('query bounds tolls, ramps, rail and stations to a validated radius', () => {
  const query = buildTransportQuery(area);
  assert.ok(query.includes('(around:10000,-6.3015,106.6527)'));
  assert.ok(query.includes('motorway|motorway_link'));
  assert.ok(query.includes('station|halt'));
  assert.ok(query.includes('out geom'));
  assert.throws(() => buildTransportQuery({ ...area, radiusKm: 200 }));
  assert.throws(() => buildTransportQuery({ ...area, lat: NaN }));
});

test('real OSM conversion separates toll lines and railway/station features, caches the area', async () => {
  let requests = 0;
  const fetcher = async (_, options) => {
    requests++;
    assert.equal(options.method, 'POST');
    assert.ok(options.body.includes('data='));
    assert.ok(options.headers.Accept === '*/*');
    return new Response(JSON.stringify(osm));
  };
  const result = await loadTransportCoverage(area, { fetcher });
  assert.equal(result.toll.features.length, 1);
  assert.equal(result.railway.features.length, 2);
  assert.equal(result.timestamp, osm.osm3s.timestamp_osm_base);
  assert.equal(result.toll.features[0].geometry.type, 'LineString');
  // GeoJSON coordinates mesti [lon, lat]
  assert.deepEqual(result.toll.features[0].geometry.coordinates[0], [106.65, -6.3]);
  assert.equal(result.railway.features.find(f => f.geometry.type === 'Point').properties.name, 'Cisauk');
  await loadTransportCoverage(area, { fetcher });
  assert.equal(requests, 1);
  await loadTransportCoverage(area, { fetcher, force: true });
  assert.equal(requests, 2);
});

test('falls back across Overpass mirrors when one rejects or is throttled', async () => {
  let requests = 0;
  const fetcher = async () => {
    requests++;
    // Dua percobaan pertama diblokir (406) lalu mirror ketiga sukses.
    if (requests < 3) return new Response('', { status: 406 });
    return new Response(JSON.stringify(osm));
  };
  const result = await loadTransportCoverage({ ...area, radiusKm: 5 }, { fetcher, force: true });
  assert.equal(requests, 3);
  assert.equal(result.toll.features.length, 1);
});

test('rejects throttling and partial Overpass results rather than showing incomplete success', async () => {
  await assert.rejects(
    loadTransportCoverage({ ...area, radiusKm: 20 }, { force: true, fetcher: async () => new Response('', { status: 429 }) }),
    /sibuk/
  );
  await assert.rejects(
    loadTransportCoverage({ ...area, radiusKm: 30 }, { force: true, fetcher: async () => new Response(JSON.stringify({ remark: 'runtime error: Query timed out', elements: [] })) }),
    /lengkap/
  );
});
