import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMp4Recording } from './cesiumRecording.ts';

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
