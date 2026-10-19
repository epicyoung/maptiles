import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStartPoint, readPreferences, DEFAULT_START_POINT } from './cesiumPreferences.ts';

test('latitude/longitude are validated without accepting blanks or out-of-range values', () => {
  assert.deepEqual(parseStartPoint('Monas', '-6.1754', '106.8272'), { ...DEFAULT_START_POINT, name: 'Monas', lat: -6.1754, lon: 106.8272 });
  for (const [lat, lon] of [['', '106'], ['91', '106'], ['-6', '181'], ['NaN', '106']]) {
    assert.throws(() => parseStartPoint('Test', lat, lon));
  }
});

test('saved start point and arrival preference survive serialization, corrupt data falls back safely', () => {
  const hub = parseStartPoint('Monas', '-6.1754', '106.8272');
  assert.deepEqual(readPreferences(JSON.stringify({ hub, autoRotateOnArrival: true })), { hub, autoRotateOnArrival: true });
  assert.deepEqual(readPreferences('{broken'), { hub: DEFAULT_START_POINT, autoRotateOnArrival: false });
  assert.deepEqual(readPreferences(JSON.stringify({ hub: { lat: 999 }, autoRotateOnArrival: 'yes' })), { hub: DEFAULT_START_POINT, autoRotateOnArrival: false });
});
