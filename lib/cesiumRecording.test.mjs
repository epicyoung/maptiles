import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { drawRecordingLogo, startMp4Recording } from './cesiumRecording.ts';

const originalRecorder = globalThis.MediaRecorder;
afterEach(() => { globalThis.MediaRecorder = originalRecorder; });

function fixture(supported = true) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  let instance;
  globalThis.MediaRecorder = class {
    static isTypeSupported(type) { return supported && type.startsWith('video/mp4'); }
    state = 'inactive';
    mimeType = 'video/mp4;codecs=avc1.42001f';
    constructor(_, options) { this.options = options; instance = Object.assign(this, {}); }
    start() { this.state = 'recording'; this.onstart?.(); }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['mp4-data']) });
      this.onstop();
    }
  };
  const canvas = { captureStream(fps) { assert.equal(fps, 60); return stream; } };
  return { canvas, track, recorder: () => instance };
}

test('records real MP4 and automatically finalizes at 60 seconds', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture();
  let result;
  startMp4Recording(f.canvas, { onComplete: blob => { result = blob; }, onError: assert.fail });
  t.mock.timers.tick(59_999);
  assert.equal(f.recorder().state, 'recording');
  t.mock.timers.tick(1);
  assert.equal(f.recorder().state, 'inactive');
  assert.ok(result.size > 0);
  assert.ok(result.type.startsWith('video/mp4'));
  assert.equal(f.track.stopped, true);
});

test('manual stop saves once, dispose releases tracks without downloading', () => {
  const f = fixture();
  let saves = 0;
  const session = startMp4Recording(f.canvas, { onComplete: () => saves++, onError: assert.fail });
  session.stop();
  session.stop();
  assert.equal(saves, 1);
  assert.equal(f.track.stopped, true);
  const other = fixture();
  startMp4Recording(other.canvas, { onComplete: () => saves++, onError: assert.fail }).dispose();
  assert.equal(saves, 1);
  assert.equal(other.track.stopped, true);
});

test('unsupported MP4 fails explicitly instead of naming WebM as MP4', () => {
  const f = fixture(false);
  assert.throws(() => startMp4Recording(f.canvas, { onComplete: assert.fail, onError: assert.fail }), /MP4/);
});

test('recording logo preserves contain sizing for both card ratios and hub pins', () => {
  const image = { complete: true, naturalWidth: 200, naturalHeight: 100 };
  const images = [];
  const cards = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {}, clip() {},
    roundRect(...args) { cards.push(args); },
    drawImage(...args) { images.push(args); },
  };
  for (const [ratio, isHub, card, drawn] of [
    ['3:2', false, [52, 100, 96, 64, 8], [57, 110.5, 86, 43]],
    ['4:3', false, [56, 98, 88, 66, 8], [61, 111.5, 78, 39]],
    ['3:2', true, [46, 92, 108, 72, 8], [51, 103.5, 98, 49]],
  ]) {
    assert.equal(drawRecordingLogo(ctx, image, { x: 100, y: 200, ratio, isHub, isActive: true }), true);
    assert.deepEqual(cards.at(-2), card);
    assert.deepEqual(images.at(-1), [image, ...drawn]);
    assert.equal(ctx.strokeStyle, '#ffa044');
  }
});

test('missing, loading, and broken logos leave the text fallback available', () => {
  for (const image of [null, { complete: false, naturalWidth: 200, naturalHeight: 100 }, { complete: true, naturalWidth: 0, naturalHeight: 0 }]) {
    assert.equal(drawRecordingLogo({}, image, { x: 100, y: 200 }), false);
  }
});
