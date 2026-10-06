// Low-level Web Audio synthesis helpers. Everything is generated at runtime — no assets.
// Nothing in this module touches `window` or creates an AudioContext at import time.

export type Ctx = BaseAudioContext;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randi = (a: number, b: number): number => Math.floor(a + Math.random() * (b - a + 1));
export const chance = (p: number): boolean => Math.random() < p;
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** Sanitise a possibly-undefined / NaN number. */
export const finite = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const EPS = 0.0001;

/** Two seconds of mono white noise, shared by every noise-based sound. */
export function makeNoiseBuffer(ctx: Ctx, seconds = 2): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Sink: collects the nodes that make up one sound so they can be killed / disconnected together.
// Times passed to helpers are offsets (seconds) from t0 and are scaled by 1/p (playback-rate-like
// pitch); frequencies are scaled by p.
// ---------------------------------------------------------------------------------------------
export class Sink {
  readonly nodes: AudioNode[] = [];
  readonly srcs: AudioScheduledSourceNode[] = [];
  /** Optional fader (the per-sound output gain) used for fast kills. */
  fader: GainNode | null = null;
  end: number;
  private last: AudioScheduledSourceNode | null = null;
  private disposed = false;

  constructor(
    readonly ctx: Ctx,
    readonly out: AudioNode,
    readonly t0: number,
    readonly p: number,
    readonly noiseBuf: AudioBuffer,
  ) {
    this.end = t0;
  }

  /** Absolute time for an offset. */
  T(off = 0): number {
    return this.t0 + Math.max(0, off) / this.p;
  }
  /** Scaled duration. */
  D(d: number): number {
    return Math.max(0.002, d / this.p);
  }
  /** Scaled + clamped frequency. */
  F(f: number): number {
    return clamp(f * this.p, 10, this.ctx.sampleRate * 0.45);
  }
  add<N extends AudioNode>(n: N): N {
    this.nodes.push(n);
    return n;
  }
  /** Register + start a source. Omit `stop` for continuous (loop) sources. */
  src<N extends AudioScheduledSourceNode>(n: N, at: number, stop?: number, offset?: number): N {
    this.nodes.push(n);
    this.srcs.push(n);
    if (offset !== undefined) (n as unknown as AudioBufferSourceNode).start(at, offset);
    else n.start(at);
    if (stop !== undefined) {
      n.stop(stop);
      if (stop >= this.end) {
        this.end = stop;
        this.last = n;
      }
    }
    return n;
  }
  /** Arrange for automatic disconnection once the last source ends. */
  finish(): void {
    const l = this.last;
    if (l) l.onended = () => this.dispose();
    else if (this.srcs.length === 0) this.dispose();
  }
  /** Stop every source at `at` (fast fade should be applied by the caller). */
  kill(at: number): void {
    for (const s of this.srcs) {
      try {
        s.stop(at);
      } catch {
        /* already stopped */
      }
    }
    this.end = Math.min(this.end, at);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.last = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Envelopes / building blocks
// ---------------------------------------------------------------------------------------------
export type Curve = 'exp' | 'lin' | 'hold' | 'swell';

/** Write an amplitude envelope onto a gain param (absolute times). */
export function env(g: AudioParam, t: number, d: number, peak: number, a: number, curve: Curve, rel: number): void {
  const pk = Math.max(EPS * 2, peak);
  const end = t + d;
  g.setValueAtTime(0, t);
  if (curve === 'swell') {
    g.linearRampToValueAtTime(pk, t + d * 0.5);
    g.linearRampToValueAtTime(0, end);
    return;
  }
  const ta = t + Math.min(Math.max(0.0005, a), d * 0.6);
  g.linearRampToValueAtTime(pk, ta);
  if (curve === 'lin') {
    g.linearRampToValueAtTime(0, end);
  } else if (curve === 'hold') {
    g.setValueAtTime(pk, Math.max(ta, end - rel));
    g.linearRampToValueAtTime(0, end);
  } else {
    g.exponentialRampToValueAtTime(EPS, end);
  }
}

interface FilterSpec {
  lp?: number;
  lp2?: number;
  hp?: number;
  bp?: number;
  q?: number;
}

function filterFor(s: Sink, o: FilterSpec, t: number, d: number): BiquadFilterNode | null {
  let type: BiquadFilterType | null = null;
  let fr = 0;
  if (o.bp !== undefined) {
    type = 'bandpass';
    fr = o.bp;
  } else if (o.lp !== undefined) {
    type = 'lowpass';
    fr = o.lp;
  } else if (o.hp !== undefined) {
    type = 'highpass';
    fr = o.hp;
  }
  if (!type) return null;
  const f = s.add(s.ctx.createBiquadFilter());
  f.type = type;
  f.Q.value = o.q ?? (type === 'bandpass' ? 1 : 0.707);
  f.frequency.setValueAtTime(s.F(fr), t);
  if (o.lp2 !== undefined) f.frequency.exponentialRampToValueAtTime(s.F(o.lp2), t + d);
  return f;
}

export interface ToneOpts extends FilterSpec {
  type?: OscillatorType;
  wave?: PeriodicWave;
  f: number;
  f2?: number;
  glide?: number;
  at?: number;
  dur: number;
  a?: number;
  v?: number;
  curve?: Curve;
  rel?: number;
  detune?: number;
  vib?: number;
  vibRate?: number;
  to?: AudioNode;
}

export interface ToneNodes {
  osc: OscillatorNode;
  g: GainNode;
  f: BiquadFilterNode | null;
  t: number;
  d: number;
}

/** One enveloped oscillator, optionally filtered, with optional pitch glide / vibrato. */
export function tone(s: Sink, o: ToneOpts): ToneNodes {
  const ctx = s.ctx;
  const t = s.T(o.at ?? 0);
  const d = s.D(o.dur);
  const osc = ctx.createOscillator();
  if (o.wave) osc.setPeriodicWave(o.wave);
  else osc.type = o.type ?? 'sine';
  const f0 = s.F(o.f);
  osc.frequency.setValueAtTime(f0, t);
  if (o.f2 !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(s.F(o.f2), t + (o.glide !== undefined ? s.D(o.glide) : d));
  }
  if (o.detune) osc.detune.value = o.detune;
  const g = s.add(ctx.createGain());
  env(g.gain, t, d, o.v ?? 0.5, s.D(o.a ?? 0.005), o.curve ?? 'exp', s.D(o.rel ?? 0.05));
  const f = filterFor(s, o, t, d);
  if (f) {
    osc.connect(f);
    f.connect(g);
  } else osc.connect(g);
  g.connect(o.to ?? s.out);
  if (o.vib) lfo(s, osc.frequency, { rate: o.vibRate ?? 6, depth: f0 * o.vib, at: o.at ?? 0, dur: o.dur + 0.03 });
  s.src(osc, t, t + d + 0.02);
  return { osc, g, f, t, d };
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  a?: number;
  v?: number;
  curve?: Curve;
  rel?: number;
  type?: BiquadFilterType;
  f?: number;
  f2?: number;
  glide?: number;
  q?: number;
  rate?: number;
  to?: AudioNode;
}

export interface NoiseNodes {
  src: AudioBufferSourceNode;
  f: BiquadFilterNode;
  g: GainNode;
}

/** Filtered burst of the shared white noise buffer. */
export function noise(s: Sink, o: NoiseOpts): NoiseNodes {
  const ctx = s.ctx;
  const t = s.T(o.at ?? 0);
  const d = s.D(o.dur);
  const src = ctx.createBufferSource();
  src.buffer = s.noiseBuf;
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const f = s.add(ctx.createBiquadFilter());
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? (f.type === 'bandpass' ? 1 : 0.707);
  f.frequency.setValueAtTime(s.F(o.f ?? 1000), t);
  if (o.f2 !== undefined) {
    f.frequency.exponentialRampToValueAtTime(s.F(o.f2), t + (o.glide !== undefined ? s.D(o.glide) : d));
  }
  const g = s.add(ctx.createGain());
  env(g.gain, t, d, o.v ?? 0.5, s.D(o.a ?? 0.004), o.curve ?? 'exp', s.D(o.rel ?? 0.04));
  src.connect(f);
  f.connect(g);
  g.connect(o.to ?? s.out);
  s.src(src, t, t + d + 0.02, Math.random() * Math.max(0, s.noiseBuf.duration - 0.1));
  return { src, f, g };
}

export interface LfoOpts {
  rate: number;
  rate2?: number;
  depth: number;
  at?: number;
  /** Omit for a continuous LFO (loops). */
  dur?: number;
  type?: OscillatorType;
}

/** Low-frequency oscillator added onto an AudioParam. */
export function lfo(s: Sink, target: AudioParam, o: LfoOpts): OscillatorNode {
  const ctx = s.ctx;
  const t = s.T(o.at ?? 0);
  const l = ctx.createOscillator();
  l.type = o.type ?? 'sine';
  l.frequency.setValueAtTime(Math.max(0.01, o.rate * s.p), t);
  const g = s.add(ctx.createGain());
  g.gain.value = o.depth;
  l.connect(g);
  g.connect(target);
  if (o.dur !== undefined) {
    const d = s.D(o.dur);
    if (o.rate2 !== undefined) l.frequency.linearRampToValueAtTime(Math.max(0.01, o.rate2 * s.p), t + d);
    s.src(l, t, t + d + 0.03);
  } else s.src(l, t);
  return l;
}

/** Amplitude-modulation gate: returns a GainNode (connected to `to` or s.out) pulsing at `rate`. */
export function gate(
  s: Sink,
  o: { rate: number; rate2?: number; at?: number; dur?: number; base?: number; depth?: number; type?: OscillatorType; to?: AudioNode },
): GainNode {
  const g = s.add(s.ctx.createGain());
  g.gain.value = o.base ?? 0.5;
  g.connect(o.to ?? s.out);
  lfo(s, g.gain, { rate: o.rate, rate2: o.rate2, depth: o.depth ?? 0.5, at: o.at, dur: o.dur, type: o.type ?? 'square' });
  return g;
}

// ---------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------
const pianoWaves = new WeakMap<Ctx, PeriodicWave>();
function pianoWave(ctx: Ctx): PeriodicWave {
  let w = pianoWaves.get(ctx);
  if (!w) {
    const amps = [0, 1, 0.45, 0.24, 0.13, 0.085, 0.05, 0.03, 0.02, 0.012];
    const real = new Array<number>(amps.length).fill(0);
    w = ctx.createPeriodicWave(real, amps);
    pianoWaves.set(ctx, w);
  }
  return w;
}

/** Piano-ish note: harmonic-rich partial stack through a closing lowpass + detuned sine, two-stage decay. */
export function piano(s: Sink, at: number, midi: number, vel: number, dur: number, pan?: number): void {
  const ctx = s.ctx;
  const t = s.T(at);
  const d = s.D(Math.max(0.03, dur));
  const f = s.F(mtof(midi));
  const vv = clamp(vel, 0.01, 1);
  const v = vv * 0.2;
  const low = clamp((88 - midi) / 52, 0, 1);
  const tau = 0.16 + low * low * 1.7 + vv * 0.15;

  const o1 = ctx.createOscillator();
  o1.setPeriodicWave(pianoWave(ctx));
  o1.frequency.value = f;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = f;
  o2.detune.value = rand(3, 8);
  const g2 = s.add(ctx.createGain());
  g2.gain.value = 0.4;
  const lp = s.add(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.Q.value = 0.25;
  const nyq = ctx.sampleRate * 0.45;
  const c0 = Math.min(nyq, f * (2.5 + 9 * vv) + 500);
  lp.frequency.setValueAtTime(c0, t);
  lp.frequency.setTargetAtTime(Math.min(c0, f * 1.7 + 300), t + 0.005, 0.1 + tau * 0.25);

  const g = s.add(ctx.createGain());
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.004);
  g.gain.setTargetAtTime(v * 0.5, t + 0.004, 0.07);
  const t2 = t + 0.12;
  const tr = t + Math.max(d, 0.04);
  if (tr > t2) g.gain.setTargetAtTime(0, t2, tau);
  g.gain.setTargetAtTime(0, tr, 0.07);
  const stop = Math.max(t + 0.12, Math.min(tr + 0.45, t2 + tau * 6));

  o1.connect(lp);
  o2.connect(g2);
  g2.connect(lp);
  lp.connect(g);
  if (pan !== undefined && pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const pn = s.add(ctx.createStereoPanner());
    pn.pan.value = clamp(pan, -1, 1);
    g.connect(pn);
    pn.connect(s.out);
  } else g.connect(s.out);
  s.src(o1, t, stop);
  s.src(o2, t, stop);
}

/** Small bell / celesta tinkle (inharmonic partials). */
export function bell(s: Sink, at: number, midi: number, vel: number, dur: number): void {
  const f = mtof(midi);
  const parts: ReadonlyArray<readonly [number, number, number]> = [
    [1, 1, 1],
    [2.0, 0.22, 0.7],
    [2.76, 0.32, 0.45],
    [5.4, 0.12, 0.25],
  ];
  const maxF = s.ctx.sampleRate * 0.4;
  for (const [r, a, dk] of parts) {
    if (f * r * s.p > maxF) continue;
    tone(s, { at, f: f * r, dur: Math.max(0.2, dur) * dk, v: vel * 0.16 * a, a: 0.002 });
  }
}

export function bass(s: Sink, at: number, midi: number, vel: number, dur: number): void {
  const f = mtof(midi);
  tone(s, { at, type: 'triangle', f, dur: dur + 0.05, v: vel * 0.45, a: 0.004, curve: 'hold', rel: 0.05, lp: 800 });
  tone(s, { at, type: 'sine', f: f * 2, dur: 0.12, v: vel * 0.1, a: 0.002 });
}

export function stab(s: Sink, at: number, midi: number, vel: number, dur: number): void {
  const f = mtof(midi);
  for (const det of [-9, 9]) {
    tone(s, { at, type: 'square', f, detune: det, dur: dur + 0.04, v: vel * 0.06, a: 0.004, curve: 'hold', rel: 0.04, lp: 2200, lp2: 900 });
  }
}

export function lead(s: Sink, at: number, midi: number, vel: number, dur: number): void {
  const f = mtof(midi);
  tone(s, { at, type: 'square', f, dur: dur + 0.05, v: vel * 0.07, a: 0.01, curve: 'hold', rel: 0.05, lp: 2600, vib: 0.007, vibRate: 5.5 });
  tone(s, { at, type: 'triangle', f, dur: dur + 0.05, v: vel * 0.2, a: 0.01, curve: 'hold', rel: 0.05 });
}

export function pluck(s: Sink, at: number, midi: number, vel: number, dur: number): void {
  const f = mtof(midi);
  tone(s, { at, type: 'triangle', f, dur: Math.max(0.15, dur) + 0.2, v: vel * 0.3, a: 0.002, lp: f * 4, lp2: f * 1.2 });
}

export function hat(s: Sink, at: number, vel: number): void {
  noise(s, { at, dur: 0.045, v: vel * 0.1, type: 'highpass', f: 7000, a: 0.001 });
}

export function kick(s: Sink, at: number, vel: number): void {
  tone(s, { at, f: 140, f2: 45, glide: 0.08, dur: 0.18, v: vel * 0.55, a: 0.001 });
}

export function snare(s: Sink, at: number, vel: number): void {
  noise(s, { at, dur: 0.14, v: vel * 0.25, type: 'bandpass', f: 1900, q: 0.7, a: 0.001 });
  tone(s, { at, type: 'triangle', f: 200, f2: 150, dur: 0.07, v: vel * 0.16, a: 0.001 });
}

export type Inst = 'piano' | 'bell' | 'pluck' | 'bass' | 'stab' | 'lead' | 'hat' | 'kick' | 'snare';

/** A scheduled musical event (absolute AudioContext time). */
export interface NoteEv {
  t: number;
  m: number;
  v: number;
  d: number;
  i?: Inst;
  pan?: number;
}

/** Render one note event into `dest`, self-cleaning when finished. */
export function renderEvent(ctx: Ctx, dest: AudioNode, noiseBuf: AudioBuffer, e: NoteEv, p = 1): void {
  const s = new Sink(ctx, dest, Math.max(ctx.currentTime, e.t), p, noiseBuf);
  switch (e.i ?? 'piano') {
    case 'piano':
      piano(s, 0, e.m, e.v, e.d, e.pan);
      break;
    case 'bell':
      bell(s, 0, e.m, e.v, e.d);
      break;
    case 'pluck':
      pluck(s, 0, e.m, e.v, e.d);
      break;
    case 'bass':
      bass(s, 0, e.m, e.v, e.d);
      break;
    case 'stab':
      stab(s, 0, e.m, e.v, e.d);
      break;
    case 'lead':
      lead(s, 0, e.m, e.v, e.d);
      break;
    case 'hat':
      hat(s, 0, e.v);
      break;
    case 'kick':
      kick(s, 0, e.v);
      break;
    case 'snare':
      snare(s, 0, e.v);
      break;
  }
  s.finish();
}

// ---------------------------------------------------------------------------------------------
// Gibberish voices: one oscillator per utterance, pitch / amplitude / formant automation per
// syllable (Animal-Crossing / Untitled-Goose-Game style blips).
// ---------------------------------------------------------------------------------------------
export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
export const VOWELS: readonly Vowel[] = ['a', 'e', 'i', 'o', 'u'];
const FORMANTS: Record<Vowel, readonly [number, number]> = {
  a: [780, 1180],
  e: [480, 1900],
  i: [330, 2300],
  o: [520, 880],
  u: [360, 760],
};

export interface Syl {
  at: number;
  dur: number;
  f: number;
  f2?: number;
  vowel: Vowel;
  vowel2?: Vowel;
  v: number;
  /** 'h'-like breath noise at the onset (0..1). */
  breath?: number;
}

export interface BabbleOpts {
  type?: OscillatorType;
  vib?: number;
  vibRate?: number;
  harsh?: boolean;
  closed?: boolean;
  fscale?: number;
}

let shaperCurve: Float32Array<ArrayBuffer> | null = null;
function getShaper(): Float32Array<ArrayBuffer> {
  if (!shaperCurve) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2.5);
    shaperCurve = c;
  }
  return shaperCurve;
}

export function babble(s: Sink, syls: Syl[], o: BabbleOpts = {}): void {
  if (!syls.length) return;
  const ctx = s.ctx;
  const fs = o.fscale ?? 1;
  // Enforce monotonic, non-overlapping syllables so automation stays well-ordered.
  let prevEnd = 0;
  for (const y of syls) {
    if (y.at < prevEnd + 0.004) y.at = prevEnd + 0.004;
    y.dur = Math.max(0.02, y.dur);
    prevEnd = y.at + y.dur;
  }
  const first = syls[0];
  const tStart = s.T(first.at);
  const tEnd = s.T(prevEnd) + 0.04;

  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  const amp = s.add(ctx.createGain());
  amp.gain.setValueAtTime(0, tStart);
  if (o.harsh) {
    const pre = s.add(ctx.createGain());
    pre.gain.value = 2.2;
    const ws = s.add(ctx.createWaveShaper());
    ws.curve = getShaper();
    osc.connect(pre);
    pre.connect(ws);
    ws.connect(amp);
  } else osc.connect(amp);

  let fA: BiquadFilterNode | null = null;
  let fB: BiquadFilterNode | null = null;
  const mk = (type: BiquadFilterType, fr: number, q: number, gain: number): BiquadFilterNode => {
    const f = s.add(ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = s.F(fr);
    f.Q.value = q;
    const g = s.add(ctx.createGain());
    g.gain.value = gain;
    amp.connect(f);
    f.connect(g);
    g.connect(s.out);
    return f;
  };
  if (o.closed) {
    mk('lowpass', 380 * fs, 2, 0.55);
  } else {
    fA = mk('bandpass', 700 * fs, 6, 2.6);
    fB = mk('bandpass', 1200 * fs, 8, 1.6);
    mk('lowpass', 320 * fs, 0.7, 0.35);
  }
  const vf = (v: Vowel, i: 0 | 1): number => s.F(FORMANTS[v][i] * fs);

  for (const y of syls) {
    const t = s.T(y.at);
    const d = s.D(y.dur);
    const e = t + d;
    osc.frequency.setValueAtTime(s.F(y.f), t);
    osc.frequency.exponentialRampToValueAtTime(s.F(y.f2 ?? y.f * 0.96), e);
    const att = Math.min(0.014, d * 0.25);
    const rel = Math.min(0.04, d * 0.35);
    const pk = Math.max(EPS, y.v);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(pk, t + att);
    amp.gain.linearRampToValueAtTime(pk * 0.8, Math.max(t + att, e - rel));
    amp.gain.linearRampToValueAtTime(0, e);
    if (fA && fB) {
      fA.frequency.setValueAtTime(vf(y.vowel, 0), t);
      fB.frequency.setValueAtTime(vf(y.vowel, 1), t);
      if (y.vowel2) {
        fA.frequency.linearRampToValueAtTime(vf(y.vowel2, 0), e);
        fB.frequency.linearRampToValueAtTime(vf(y.vowel2, 1), e);
      }
    }
    if (y.breath) {
      noise(s, { at: Math.max(0, y.at - 0.025), dur: 0.05, v: y.breath * 0.18, type: 'bandpass', f: 1500 * fs, q: 0.7, a: 0.01, curve: 'hold', rel: 0.02 });
    }
  }
  if (o.vib) {
    lfo(s, osc.frequency, { rate: o.vibRate ?? 6, depth: s.F(first.f) * o.vib, at: first.at, dur: prevEnd - first.at + 0.04 });
  }
  s.src(osc, tStart, tEnd);
}
