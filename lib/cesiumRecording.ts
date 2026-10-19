export const RECORDING_SECONDS = 60;

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
  if (!mimeType) throw new Error('Browser ini belum mendukung rekaman MP4. Gunakan Chrome atau Edge versi terbaru.');

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
    if (!disposed) callbacks.onError(new Error('Rekaman MP4 gagal. Coba lagi dengan ukuran jendela lebih kecil.'));
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
