// Records the game's own Web Audio synthesis (src/audio/Audio.ts, unchanged) into an
// OfflineAudioContext that runs on *trailer* time instead of wall-clock time, so every footstep,
// whistle, breaker clunk and alarm lands exactly on the frame where the simulation produced it.
//
// Tricks:
//  - `currentTime` reports the trailer clock (the context has not started rendering yet, so all
//    scheduled times are simply "in the future" and render correctly later);
//  - `state` always reads 'running' so the game's audio engine doesn't wait for a user gesture;
//  - AudioNode.disconnect() is a no-op during recording: the engine tidies finished sounds away by
//    disconnecting them on its own clock, which would otherwise remove them before rendering.
export interface OfflineRecorder {
  ctx: OfflineAudioContext;
  clock: { t: number };
  render(): Promise<AudioBuffer>;
}

export function installOfflineAudio(durationSec: number, sampleRate = 48000): OfflineRecorder {
  const clock = { t: 0 };
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(durationSec * sampleRate), sampleRate });
  Object.defineProperty(ctx, 'currentTime', { get: () => clock.t, configurable: true });
  Object.defineProperty(ctx, 'state', { get: () => 'running', configurable: true });
  (ctx as unknown as { resume: () => Promise<void> }).resume = () => Promise.resolve();
  const Fake = function () {
    return ctx;
  } as unknown as typeof AudioContext;
  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = Fake;
  (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext = Fake;
  AudioNode.prototype.disconnect = function () {
    /* recording: keep every node alive until the offline render */
  } as typeof AudioNode.prototype.disconnect;
  return {
    ctx,
    clock,
    render: () => OfflineAudioContext.prototype.startRendering.call(ctx),
  };
}

/** 16-bit PCM WAV encoder. */
export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Uint8Array(out.buffer);
}
