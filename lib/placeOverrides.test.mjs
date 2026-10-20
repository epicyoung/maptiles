import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLogoDataUrl,
  isLogoRatio,
  mergeOverride,
  placeLabel,
  placeName,
  readPlaceOverrides,
  removeOverride,
} from './placeOverrides.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

test('nama & label override dipakai hanya kalau ada, fallback ke bawaan', () => {
  assert.equal(placeName('aeon', 'AEON Mall BSD', {}), 'AEON Mall BSD');
  assert.equal(placeName('aeon', 'AEON Mall BSD', { aeon: { name: '  AEON  ' } }), 'AEON');
  assert.equal(placeName('aeon', 'AEON Mall BSD', { aeon: { name: '   ' } }), 'AEON Mall BSD');
  assert.equal(placeLabel('hub', 'Starting Point (0 km)', {}), 'Starting Point (0 km)');
  assert.equal(placeLabel('hub', 'Starting Point (0 km)', { hub: { label: 'Kantor Pusat' } }), 'Kantor Pusat');
  assert.equal(placeLabel('hub', 'Starting Point (0 km)', { hub: { label: '  ' } }), 'Starting Point (0 km)');
});

test('parse membuang data rusak: logo bukan data URL, rasio asing, nama kosong', () => {
  const parsed = readPlaceOverrides(JSON.stringify({
    hub: { name: 'Kantor', label: 'Pusat', logo: PNG, ratio: '4:3', hidden: true },
    bad: { logo: 'https://evil.example/x.png', ratio: '16:9', name: '   ' },
    junk: 'nope',
    arr: [1, 2, 3],
  }));
  assert.deepEqual(parsed, { hub: { name: 'Kantor', label: 'Pusat', logo: PNG, ratio: '4:3', hidden: true } });
  assert.deepEqual(readPlaceOverrides('{broken'), {});
  assert.deepEqual(readPlaceOverrides(null), {});
  assert.deepEqual(readPlaceOverrides('[]'), {});
});

test('merge menambah, mengubah, dan menghapus override dengan nilai kosong', () => {
  let state = mergeOverride({}, 'ice', { name: 'ICE' });
  assert.deepEqual(state, { ice: { name: 'ICE' } });

  state = mergeOverride(state, 'ice', { hidden: true, logo: PNG, ratio: '3:2', label: 'Mall' });
  assert.deepEqual(state, { ice: { name: 'ICE', label: 'Mall', hidden: true, logo: PNG, ratio: '3:2' } });

  state = mergeOverride(state, 'ice', { hidden: false });
  assert.deepEqual(state, { ice: { name: 'ICE', label: 'Mall', logo: PNG, ratio: '3:2' } });

  state = mergeOverride(state, 'ice', { name: '', label: '', logo: undefined, ratio: undefined });
  assert.deepEqual(state, {});
});

test('removeOverride membuang seluruh data tempat, tempat lain tetap', () => {
  const state = { a: { name: 'A' }, b: { hidden: true } };
  assert.deepEqual(removeOverride(state, 'a'), { b: { hidden: true } });
  assert.deepEqual(removeOverride(state, 'zzz'), { a: { name: 'A' }, b: { hidden: true } });
});

test('validasi logo dan rasio', () => {
  assert.equal(isLogoDataUrl(PNG), true);
  assert.equal(isLogoDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), true);
  assert.equal(isLogoDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isLogoDataUrl('javascript:alert(1)'), false);
  assert.equal(isLogoDataUrl(PNG + 'x'.repeat(400_000)), false);
  assert.equal(isLogoRatio('3:2'), true);
  assert.equal(isLogoRatio('4:3'), true);
  assert.equal(isLogoRatio('1:1'), false);
});
