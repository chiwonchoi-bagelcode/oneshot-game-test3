import '../../src/style.css';
import './trailer.css';
import { Engine, FPS } from './engine';
import { encodeWav } from './offlineAudio';
import { DURATION, SHOTS } from './shots';
import { TITLES } from './titles';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, SHOTS, TITLES, DURATION);

async function fontsReady() {
  const fams = ['700 20px Gaegu', '400 20px Gaegu', '20px Jua', '700 20px "Gowun Batang"', '400 20px "Gowun Batang"', '20px "Black Han Sans"'];
  await Promise.all(fams.map((f) => document.fonts.load(f, '완벽한 불청객 황금 오리 ABC 123')));
  await document.fonts.ready;
}

let audioWav: Uint8Array | null = null;

const api = {
  fps: FPS,
  frames: engine.frames,
  ready: fontsReady(),
  renderFrame(f: number) {
    engine.renderFrame(f);
  },
  /** Render the recorded game audio; returns the WAV size in bytes. */
  async renderAudio(): Promise<number> {
    const buf = await engine.renderAudio();
    audioWav = encodeWav(buf);
    return audioWav.length;
  },
  /** Base64 slice of the rendered WAV (for transfer to Node in chunks). */
  audioChunk(offset: number, len: number): string {
    const part = audioWav!.subarray(offset, offset + len);
    let s = '';
    for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode(...part.subarray(i, i + 0x8000));
    return btoa(s);
  },
  shotAt(t: number) {
    return SHOTS.find((s) => t >= s.start && t < s.end)?.id ?? '';
  },
};
(window as unknown as { trailer: typeof api }).trailer = api;
