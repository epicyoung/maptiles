export const RECORDING_SECONDS = 60;

/** Composite the existing pin image into the video canvas; DOM overlays are not captured. */
export function drawRecordingLogo(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  pin: { x: number; y: number; ratio?: '3:2' | '4:3'; isHub?: boolean; isActive?: boolean },
): boolean {
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return false;
  const width = pin.isHub ? 108 : pin.ratio === '4:3' ? 88 : 96;
  const height = width * (pin.ratio === '4:3' ? 3 / 4 : 2 / 3);
  const x = pin.x - width / 2;
  const y = pin.y - 36 - height;
  const scale = Math.min((width - 10) / image.naturalWidth, (height - 10) / image.naturalHeight);
  const imageWidth = image.naturalWidth * scale;
  const imageHeight = image.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pin.isActive ? '#ffa044' : 'rgba(255,255,255,.95)';
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.roundRect(x + 5, y + 5, width - 10, height - 10, 5);
  ctx.clip();
  ctx.drawImage(image, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
  ctx.restore();
  return true;
}

type RecordingCallbacks = {
  onComplete: (blob: Blob) => void;
  onError: (error: Error) => void;
  onTick?: (seconds: number) => void;
};

/** Use a native MP4 encoder; never disguise a WebM container with an MP4 extension. */
export function startMp4Recording(canvas: HTMLCanvasElement, callbacks: RecordingCallbacks) {
  const mimeType = typeof MediaRecorder !== 'undefined' && [
    'video/mp4;codecs=avc1.42001f',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser does not support MP4 recording. Use a recent version of Chrome or Edge.');

  const stream = canvas.captureStream(60);
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
  let disposed = false;
  let failed = false;
  let seconds = 0;
  const timers: { interval?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout> } = {};
  const clearTimers = () => { clearInterval(timers.interval); clearTimeout(timers.deadline); };
  const release = () => { clearTimers(); stream.getTracks().forEach(track => track.stop()); };
  const stop = () => {
    clearTimers();
    if (recorder.state !== 'inactive') recorder.stop();
  };
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => {
    failed = true;
    stop();
    release();
    if (!disposed) callbacks.onError(new Error('MP4 recording failed. Try again with a smaller window.'));
  };
  recorder.onstop = () => {
    release();
    if (disposed || failed) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    if (blob.size) callbacks.onComplete(blob);
    else callbacks.onError(new Error('Rekaman kosong. Silakan coba lagi.'));
  };
  // Encoding starts asynchronously; count from the first encoder start event.
  recorder.onstart = () => {
    timers.interval = setInterval(() => callbacks.onTick?.(++seconds), 1000);
    timers.deadline = setTimeout(stop, RECORDING_SECONDS * 1000);
  };
  try { recorder.start(500); } catch (error) { release(); throw error; }
  return {
    stop,
    dispose: () => { disposed = true; stop(); release(); },
  };
}
