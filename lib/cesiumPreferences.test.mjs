import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStartPoint,
  readPreferences,
  isMapSkin,
  DEFAULT_MAP_SKIN,
  DEFAULT_START_POINT,
  MAP_SKINS,
} from './cesiumPreferences.ts';

test('latitude/longitude are validated without accepting blanks or out-of-range values', () => {
  assert.deepEqual(parseStartPoint('Monas', '-6.1754', '106.8272'), { ...DEFAULT_START_POINT, name: 'Monas', lat: -6.1754, lon: 106.8272 });
  for (const [lat, lon] of [['', '106'], ['91', '106'], ['-6', '181'], ['NaN', '106']]) {
    assert.throws(() => parseStartPoint('Test', lat, lon));
  }
});

test('saved start point and arrival preference survive serialization, corrupt data falls back safely', () => {
  const hub = parseStartPoint('Monas', '-6.1754', '106.8272');
  assert.equal(readPreferences(JSON.stringify({ hub })).autoRotateOnArrival, true);
  assert.equal(readPreferences(JSON.stringify({ hub, autoRotateOnArrival: false })).autoRotateOnArrival, false);
  assert.deepEqual(readPreferences(JSON.stringify({ hub, autoRotateOnArrival: true })), {
    hub,
    autoRotateOnArrival: true,
    skin: DEFAULT_MAP_SKIN,
  });
  assert.deepEqual(readPreferences('{broken'), {
    hub: DEFAULT_START_POINT,
    autoRotateOnArrival: true,
    skin: DEFAULT_MAP_SKIN,
  });
  assert.deepEqual(readPreferences(JSON.stringify({ hub: { lat: 999 }, autoRotateOnArrival: 'yes' })), {
    hub: DEFAULT_START_POINT,
    autoRotateOnArrival: true,
    skin: DEFAULT_MAP_SKIN,
  });
});

test('map skin survives serialization and unknown values fall back to the default', () => {
  const hub = DEFAULT_START_POINT;
  for (const skin of MAP_SKINS.map((item) => item.id)) {
    assert.equal(readPreferences(JSON.stringify({ hub, autoRotateOnArrival: false, skin })).skin, skin);
  }
  assert.equal(readPreferences(JSON.stringify({ hub, skin: 'bing' })).skin, DEFAULT_MAP_SKIN);
  assert.equal(readPreferences(JSON.stringify({ hub, skin: 42 })).skin, DEFAULT_MAP_SKIN);
  assert.equal(readPreferences(JSON.stringify({ hub, skin: null })).skin, DEFAULT_MAP_SKIN);
  assert.equal(isMapSkin('osm'), true);
  assert.equal(isMapSkin(''), false);
});
