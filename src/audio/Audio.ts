// 완벽한 불청객 — runtime-synthesised audio (Web Audio API only; no asset files, no network).
//
// Graph:  [one-shots] -> sfx bus ─┐
//         [voices]    -> voice bus ┤
//         [loops]     -> loops bus ├─> mix -> compressor -> limiter -> master (volume/mute) -> destination
//         [score]     -> music bus ┘
//
// Every public method is a safe no-op before init() / without an AudioContext (e.g. node tests).

import {
  Sink,
  tone,
  noise,
  lfo,
  gate,
  piano,
  bell,
  lead,
  babble,
  renderEvent,
  makeNoiseBuffer,
  clamp,
  rand,
  randi,
  pick,
  chance,
  mtof,
  finite,
  VOWELS,
  type Syl,
  type Vowel,
  type BabbleOpts,
} from './synth';
import { MusicEngine, Performer, pianistPlan, jukeboxPlan } from './music';

export type SfxName =
  | 'step' | 'step_run' | 'step_grass'
  | 'door_open' | 'door_close' | 'door_locked' | 'unlock' | 'lockpick'
  | 'pickup' | 'drop' | 'throw' | 'pocket'
  | 'glass_break' | 'thud' | 'splash'
  | 'whistle'
  | 'switch' | 'power_down' | 'power_up' | 'breaker'
  | 'zip' | 'cloth'
  | 'pour' | 'gulp'
  | 'notice' | 'alert' | 'lost'
  | 'radio'
  | 'camera_beep'
  | 'fireworks_launch' | 'fireworks_boom'
  | 'fire_bell_hit'
  | 'success' | 'fail' | 'objective' | 'intel'
  | 'click' | 'hover'
  | 'snore' | 'flush' | 'boat' | 'engine';

export type VoiceKind =
  | 'hmm' | 'huh' | 'gasp' | 'shout' | 'chatter' | 'laugh' | 'scream' | 'grumble' | 'cheer' | 'sigh' | 'ahem' | 'oops';

export type LoopName = 'alarm' | 'fire_bell' | 'jukebox' | 'piano' | 'crowd' | 'fountain' | 'hum';

export type MusicState = 'off' | 'title' | 'calm' | 'sneak' | 'tension' | 'chase' | 'blackout' | 'lockdown' | 'victory' | 'fail';

export interface PlayOpts {
  x?: number;
  z?: number;
  volume?: number;
  pitch?: number;
}

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------
// Notes are scheduled this far ahead. Pumped from the render loop *and* a 50 ms timer, so a slow
// frame (shader compile, GC) doesn't leave the score with nothing queued.
const LOOKAHEAD = 0.3;
const PUMP_MS = 50;
const MAX_SFX = 24;
const MAX_VOICES = 10;
const HEAR_RANGE = 28;
const VOICE_GAP = 0.12;
const BUS_LEVEL = { sfx: 0.9, voice: 0.85, loops: 0.75, music: 0.8 } as const;

// ---------------------------------------------------------------------------------------------
// One-shot SFX recipes
// ---------------------------------------------------------------------------------------------
type Recipe = (s: Sink) => void;

function chime(s: Sink, at: number, f: number, v: number, dur: number, f2?: number): void {
  tone(s, { at, type: 'triangle', f, f2, glide: 0.12, dur, v, a: 0.004 });
  tone(s, { at, f: f * 2, f2: f2 !== undefined ? f2 * 2 : undefined, glide: 0.12, dur: dur * 0.6, v: v * 0.3, a: 0.003 });
}

function trombone(s: Sink, at: number, midi: number, dur: number, v: number, last: boolean): void {
  const f = mtof(midi);
  for (const det of [-6, 6]) {
    const tn = tone(s, {
      at,
      type: 'sawtooth',
      f,
      f2: last ? f * 0.94 : undefined,
      dur,
      v,
      a: 0.05,
      curve: 'hold',
      rel: last ? 0.25 : 0.1,
      lp: 300,
      q: 3,
      detune: det,
      vib: last ? 0.018 : 0,
      vibRate: 5,
    });
    if (tn.f) {
      const fq = tn.f.frequency;
      fq.setValueAtTime(s.F(300), tn.t);
      fq.linearRampToValueAtTime(s.F(1300), tn.t + tn.d * (last ? 0.15 : 0.3));
      fq.linearRampToValueAtTime(s.F(last ? 420 : 520), tn.t + tn.d);
      if (last) lfo(s, fq, { rate: 5, depth: s.F(260), at: at + 0.25, dur: dur - 0.25 });
    }
  }
}

const SFX: Record<SfxName, Recipe> = {
  // --- footsteps ---------------------------------------------------------------------------
  step: (s) => {
    const r = rand(0.85, 1.15);
    noise(s, { dur: 0.07, a: 0.003, v: 0.2, type: 'lowpass', f: 750 * r, f2: 300, q: 0.8 });
    tone(s, { f: 95 * r, f2: 55, dur: 0.07, v: 0.16, a: 0.002 });
  },
  step_run: (s) => {
    const r = rand(0.88, 1.12);
    noise(s, { dur: 0.065, a: 0.002, v: 0.25, type: 'lowpass', f: 1150 * r, f2: 400, q: 0.9 });
    tone(s, { f: 115 * r, f2: 58, dur: 0.075, v: 0.2, a: 0.002 });
    noise(s, { at: 0.01, dur: 0.035, v: 0.06, type: 'highpass', f: 3000 });
  },
  step_grass: (s) => {
    const r = rand(0.85, 1.15);
    noise(s, { dur: 0.1, a: 0.006, v: 0.17, type: 'bandpass', f: 2800 * r, q: 0.9 });
    noise(s, { at: 0.03, dur: 0.07, v: 0.1, type: 'highpass', f: 5000 * r });
    tone(s, { f: 80, f2: 50, dur: 0.05, v: 0.07, a: 0.002 });
  },

  // --- doors / locks -------------------------------------------------------------------------
  door_open: (s) => {
    noise(s, { dur: 0.03, v: 0.32, type: 'bandpass', f: 2500, q: 2, a: 0.001 });
    tone(s, { f: 2100, dur: 0.04, v: 0.05, type: 'triangle', a: 0.001 });
    const g = gate(s, { rate: 22, rate2: 38, at: 0.05, dur: 0.55, base: 0.5, depth: 0.5, type: 'square' });
    tone(s, { at: 0.05, type: 'sawtooth', f: 160, f2: 240, dur: 0.55, v: 0.2, curve: 'swell', bp: 1100, q: 3, to: g });
    tone(s, { at: 0.05, type: 'sawtooth', f: 330, f2: 470, dur: 0.5, v: 0.06, curve: 'swell', bp: 2300, q: 4, to: g });
  },
  door_close: (s) => {
    noise(s, { dur: 0.18, v: 0.5, type: 'lowpass', f: 260, q: 0.7, a: 0.002 });
    tone(s, { f: 75, f2: 42, dur: 0.25, v: 0.45, a: 0.002 });
    noise(s, { at: 0.035, dur: 0.025, v: 0.25, type: 'bandpass', f: 2600, q: 3, a: 0.001 });
    tone(s, { at: 0.035, f: 1900, dur: 0.05, v: 0.05, type: 'triangle', a: 0.001 });
  },
  door_locked: (s) => {
    const ats = [0, 0.075, 0.16];
    ats.forEach((at, i) => {
      noise(s, { at, dur: 0.035, v: 0.3 - i * 0.05, type: 'bandpass', f: rand(1500, 2200), q: 4, a: 0.001 });
      tone(s, { at, type: 'triangle', f: rand(140, 175), f2: 90, dur: 0.06, v: 0.22, a: 0.001 });
    });
  },
  unlock: (s) => {
    noise(s, { dur: 0.02, v: 0.3, type: 'bandpass', f: 3200, q: 3, a: 0.0005 });
    tone(s, { f: 2400, dur: 0.05, v: 0.06, type: 'triangle', a: 0.001 });
    noise(s, { at: 0.1, dur: 0.035, v: 0.45, type: 'bandpass', f: 1600, q: 2.5, a: 0.0005 });
    tone(s, { at: 0.1, type: 'square', f: 900, f2: 700, dur: 0.08, v: 0.1, lp: 2500, a: 0.001 });
    tone(s, { at: 0.1, f: 3100, dur: 0.2, v: 0.04, a: 0.001 });
  },
  lockpick: (s) => {
    let at = 0;
    const n = randi(3, 4);
    for (let i = 0; i < n; i++) {
      tone(s, { at, f: rand(3200, 5200), dur: 0.025, v: 0.07, a: 0.0008 });
      noise(s, { at, dur: 0.012, v: 0.08, type: 'highpass', f: 4000, a: 0.0005 });
      at += rand(0.03, 0.05);
    }
  },

  // --- items -----------------------------------------------------------------------------------
  pickup: (s) => {
    tone(s, { f: 420, f2: 980, glide: 0.07, dur: 0.13, v: 0.3, a: 0.002 });
    tone(s, { type: 'triangle', f: 840, f2: 1960, glide: 0.07, dur: 0.08, v: 0.07, a: 0.002 });
  },
  drop: (s) => {
    tone(s, { f: 170, f2: 60, dur: 0.16, v: 0.4, a: 0.002 });
    noise(s, { dur: 0.08, v: 0.25, type: 'lowpass', f: 500, a: 0.001 });
  },
  throw: (s) => {
    noise(s, { dur: 0.32, v: 0.35, curve: 'swell', type: 'bandpass', f: 500, f2: 2200, q: 1.4 });
    noise(s, { dur: 0.25, v: 0.08, curve: 'swell', type: 'highpass', f: 3000 });
  },
  pocket: (s) => {
    noise(s, { dur: 0.09, v: 0.18, curve: 'swell', type: 'bandpass', f: 1400, q: 0.9 });
    noise(s, { at: 0.07, dur: 0.1, v: 0.14, curve: 'swell', type: 'bandpass', f: 2100, q: 0.9 });
    tone(s, { at: 0.13, f: 300, f2: 520, dur: 0.07, v: 0.12, a: 0.002 });
  },

  // --- impacts -----------------------------------------------------------------------------------
  glass_break: (s) => {
    noise(s, { dur: 0.08, v: 0.55, type: 'highpass', f: 1800, a: 0.001 });
    noise(s, { dur: 0.6, v: 0.16, type: 'highpass', f: 4500, a: 0.002 });
    tone(s, { f: 180, f2: 80, dur: 0.1, v: 0.2, a: 0.001 });
    for (let i = 0; i < 12; i++) {
      tone(s, { at: Math.pow(Math.random(), 1.7) * 0.7, f: rand(2200, 7000), dur: rand(0.05, 0.2), v: rand(0.03, 0.1), a: 0.001 });
    }
  },
  thud: (s) => {
    tone(s, { f: 95, f2: 38, dur: 0.35, v: 0.6, a: 0.002 });
    noise(s, { dur: 0.2, v: 0.35, type: 'lowpass', f: 350, a: 0.001 });
  },
  splash: (s) => {
    noise(s, { dur: 0.6, v: 0.45, a: 0.008, type: 'bandpass', f: 1400, f2: 450, q: 0.8 });
    noise(s, { dur: 0.25, v: 0.3, type: 'lowpass', f: 600, a: 0.003 });
    for (let i = 0; i < 5; i++) {
      tone(s, { at: rand(0.05, 0.5), f: rand(350, 700), f2: rand(900, 1600), glide: 0.04, dur: 0.06, v: 0.06, a: 0.002 });
    }
  },

  // --- player whistle (lure) -------------------------------------------------------------------------
  whistle: (s) => {
    tone(s, { f: 1300, f2: 1900, glide: 0.11, dur: 0.15, v: 0.17, a: 0.02, curve: 'hold', rel: 0.03, vib: 0.008, vibRate: 7 });
    const n2 = tone(s, { at: 0.22, f: 1500, f2: 2050, glide: 0.08, dur: 0.34, v: 0.18, a: 0.02, curve: 'hold', rel: 0.08, vib: 0.014, vibRate: 7 });
    n2.osc.frequency.exponentialRampToValueAtTime(s.F(1250), n2.t + n2.d);
    noise(s, { dur: 0.15, v: 0.025, type: 'bandpass', f: 1700, q: 2, curve: 'hold' });
    noise(s, { at: 0.22, dur: 0.34, v: 0.025, type: 'bandpass', f: 1700, q: 2, curve: 'hold' });
  },

  // --- electrics -------------------------------------------------------------------------------------
  switch: (s) => {
    noise(s, { dur: 0.012, v: 0.45, type: 'highpass', f: 2500, a: 0.0005 });
    tone(s, { type: 'square', f: 1800, dur: 0.02, v: 0.1, lp: 4000, a: 0.0005 });
    noise(s, { at: 0.035, dur: 0.01, v: 0.15, type: 'highpass', f: 3500, a: 0.0005 });
  },
  power_down: (s) => {
    noise(s, { dur: 0.06, v: 0.5, type: 'bandpass', f: 900, q: 1.5, a: 0.001 });
    tone(s, { f: 110, f2: 50, dur: 0.2, v: 0.4, a: 0.001 });
    tone(s, { at: 0.03, type: 'sawtooth', f: 120, f2: 28, dur: 1.3, v: 0.22, a: 0.01, curve: 'lin', lp: 900, lp2: 150 });
    tone(s, { at: 0.03, f: 240, f2: 50, dur: 1.1, v: 0.12, a: 0.01, curve: 'lin' });
    tone(s, { at: 0.03, f: 3000, f2: 400, dur: 0.6, v: 0.02, a: 0.01, curve: 'lin' });
  },
  power_up: (s) => {
    noise(s, { dur: 0.03, v: 0.35, type: 'bandpass', f: 1200, q: 1.5, a: 0.001 });
    tone(s, { type: 'sawtooth', f: 30, f2: 120, dur: 1.1, v: 0.2, a: 0.7, curve: 'hold', rel: 0.25, lp: 300, lp2: 1200 });
    tone(s, { f: 60, f2: 240, dur: 1.1, v: 0.12, a: 0.7, curve: 'hold', rel: 0.25 });
    tone(s, { f: 400, f2: 5000, dur: 1.0, v: 0.02, a: 0.5, curve: 'hold', rel: 0.2 });
  },
  breaker: (s) => {
    noise(s, { dur: 0.05, v: 0.8, type: 'bandpass', f: 1400, q: 1.2, a: 0.0005 });
    noise(s, { dur: 0.012, v: 0.6, type: 'highpass', f: 3000, a: 0.0005 });
    tone(s, { f: 120, f2: 45, dur: 0.25, v: 0.6, a: 0.001 });
    tone(s, { f: 1180, dur: 0.35, v: 0.06, a: 0.001 });
    tone(s, { f: 2730, dur: 0.25, v: 0.04, a: 0.001 });
    noise(s, { at: 0.07, dur: 0.03, v: 0.3, type: 'bandpass', f: 2200, q: 2, a: 0.0005 });
  },

  // --- disguise ---------------------------------------------------------------------------------------
  zip: (s) => {
    const g = gate(s, { rate: 55, rate2: 110, dur: 0.38, base: 0.5, depth: 0.5, type: 'square' });
    noise(s, { dur: 0.38, v: 0.4, type: 'bandpass', f: 2200, f2: 5000, q: 1.5, curve: 'hold', a: 0.02, rel: 0.04, to: g });
  },
  cloth: (s) => {
    for (let i = 0; i < 4; i++) {
      noise(s, { at: i * rand(0.07, 0.11), dur: rand(0.12, 0.2), v: rand(0.1, 0.18), curve: 'swell', type: 'bandpass', f: rand(1100, 2600), q: 0.8 });
    }
  },

  // --- drinks -----------------------------------------------------------------------------------------
  pour: (s) => {
    const st = noise(s, { dur: 0.9, v: 0.3, a: 0.05, curve: 'hold', rel: 0.15, type: 'bandpass', f: 600, f2: 1400, q: 3 });
    lfo(s, st.f.frequency, { rate: 11, depth: s.F(250), dur: 0.9 });
    noise(s, { dur: 0.9, v: 0.06, a: 0.05, curve: 'hold', rel: 0.15, type: 'highpass', f: 4000 });
    for (let i = 0; i < 5; i++) {
      tone(s, { at: rand(0.05, 0.8), f: rand(500, 900), f2: rand(1100, 1700), glide: 0.04, dur: 0.06, v: 0.05, a: 0.002 });
    }
  },
  gulp: (s) => {
    for (const at of [0, 0.32]) {
      tone(s, { at, f: 260, f2: 110, dur: 0.11, v: 0.35, a: 0.004 });
      noise(s, { at, dur: 0.06, v: 0.15, type: 'lowpass', f: 500, a: 0.002 });
      tone(s, { at: at + 0.02, type: 'triangle', f: 600, f2: 400, dur: 0.05, v: 0.05, a: 0.002 });
    }
    noise(s, { at: 0.6, dur: 0.3, v: 0.06, curve: 'swell', type: 'bandpass', f: 900, q: 0.8 });
  },

  // --- stealth stingers ---------------------------------------------------------------------------------
  notice: (s) => {
    chime(s, 0, 660, 0.16, 0.22);
    chime(s, 0.12, 880, 0.19, 0.5, 1040);
  },
  alert: (s) => {
    noise(s, { dur: 0.05, v: 0.4, type: 'highpass', f: 2000, a: 0.001 });
    tone(s, { type: 'sawtooth', f: 1046, dur: 0.45, v: 0.16, a: 0.002, lp: 5000 });
    tone(s, { type: 'square', f: 1480, dur: 0.4, v: 0.08, a: 0.002, lp: 4000 });
    tone(s, { type: 'sawtooth', f: 523, dur: 0.3, v: 0.14, a: 0.002, lp: 3000 });
    tone(s, { f: 2093, dur: 0.6, v: 0.1, a: 0.001 });
    tone(s, { f: 90, f2: 50, dur: 0.15, v: 0.4, a: 0.001 });
  },
  lost: (s) => {
    chime(s, 0, 880, 0.15, 0.25);
    chime(s, 0.17, 698, 0.14, 0.25);
    chime(s, 0.34, 587, 0.15, 0.75, 554);
  },

  // --- devices ----------------------------------------------------------------------------------------------
  radio: (s) => {
    const g = gate(s, { rate: 23, rate2: 37, dur: 0.32, base: 0.6, depth: 0.4, type: 'square' });
    noise(s, { dur: 0.32, v: 0.3, type: 'bandpass', f: 1800, q: 0.9, curve: 'hold', a: 0.005, rel: 0.03, to: g });
    noise(s, { dur: 0.32, v: 0.1, type: 'highpass', f: 5000, curve: 'hold', a: 0.005, rel: 0.03, to: g });
    tone(s, { at: 0.34, type: 'square', f: 1250, dur: 0.09, v: 0.07, curve: 'hold', a: 0.003, rel: 0.01, lp: 3000 });
    tone(s, { at: 0.34, f: 1250, dur: 0.09, v: 0.08, curve: 'hold', a: 0.003, rel: 0.01 });
  },
  camera_beep: (s) => {
    tone(s, { type: 'square', f: 2350, dur: 0.07, v: 0.05, curve: 'hold', a: 0.002, rel: 0.01, lp: 5000 });
    tone(s, { f: 2350, dur: 0.1, v: 0.07, curve: 'hold', a: 0.002, rel: 0.02 });
  },

  // --- fireworks / fire bell ----------------------------------------------------------------------------------
  fireworks_launch: (s) => {
    noise(s, { dur: 0.08, v: 0.35, type: 'lowpass', f: 900, a: 0.002 });
    tone(s, { f: 500, f2: 2200, dur: 1.0, v: 0.1, a: 0.05, curve: 'hold', rel: 0.2, vib: 0.02, vibRate: 30 });
    noise(s, { dur: 1.0, v: 0.18, type: 'bandpass', f: 1500, f2: 4500, q: 1.2, curve: 'lin', a: 0.01 });
  },
  fireworks_boom: (s) => {
    tone(s, { f: 75, f2: 28, dur: 1.2, v: 0.75, a: 0.003 });
    noise(s, { dur: 1.5, v: 0.6, type: 'lowpass', f: 1600, f2: 120, a: 0.002 });
    noise(s, { at: 0.22, dur: 0.9, v: 0.2, type: 'lowpass', f: 500, f2: 100, a: 0.01 });
    for (let i = 0; i < 18; i++) {
      noise(s, { at: rand(0.3, 1.8), dur: 0.015, v: rand(0.05, 0.15), type: 'highpass', f: 3000, a: 0.0005 });
    }
  },
  fire_bell_hit: (s) => {
    const f = 1180;
    const parts: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0.25, 1.4],
      [2.32, 0.12, 0.8],
      [3.7, 0.07, 0.5],
      [5.1, 0.04, 0.35],
    ];
    for (const [r, v, d] of parts) tone(s, { f: f * r, dur: d, v, a: 0.001 });
    noise(s, { dur: 0.02, v: 0.25, type: 'highpass', f: 3000, a: 0.0005 });
  },

  // --- jingles --------------------------------------------------------------------------------------------------
  success: (s) => {
    const seq: ReadonlyArray<readonly [number, number]> = [
      [0, 67],
      [0.1, 72],
      [0.2, 76],
      [0.3, 79],
      [0.48, 76],
      [0.6, 79],
    ];
    for (const [at, m] of seq) {
      piano(s, at, m, 0.65, 0.14);
      lead(s, at, m, 0.5, 0.1);
    }
    for (const m of [48, 55, 64, 67, 72]) piano(s, 0.74, m, 0.55, 1.2);
    piano(s, 0.74, 84, 0.75, 1.2);
    lead(s, 0.74, 84, 0.55, 0.9);
    [88, 91, 96, 100].forEach((m, k) => bell(s, 1.0 + k * 0.09, m, 0.5, 1.0));
  },
  fail: (s) => {
    trombone(s, 0, 58, 0.38, 0.13, false);
    trombone(s, 0.42, 57, 0.38, 0.13, false);
    trombone(s, 0.84, 56, 0.38, 0.13, false);
    trombone(s, 1.26, 55, 0.95, 0.14, true);
  },
  objective: (s) => {
    [72, 76, 79, 84].forEach((m, k) => {
      piano(s, k * 0.06, m, 0.6, k === 3 ? 0.6 : 0.15);
      bell(s, k * 0.06, m + 12, 0.35, 0.6);
    });
  },
  intel: (s) => {
    tone(s, { type: 'triangle', f: mtof(76), dur: 0.28, v: 0.14, a: 0.006 });
    tone(s, { f: mtof(88), dur: 0.2, v: 0.03, a: 0.004 });
    tone(s, { at: 0.14, type: 'triangle', f: mtof(81), dur: 0.7, v: 0.16, a: 0.008 });
    tone(s, { at: 0.14, f: mtof(93), dur: 0.4, v: 0.035, a: 0.004 });
  },

  // --- UI ---------------------------------------------------------------------------------------------------------
  click: (s) => {
    tone(s, { type: 'triangle', f: 1800, f2: 1100, dur: 0.035, v: 0.18, a: 0.001 });
    noise(s, { dur: 0.008, v: 0.08, type: 'highpass', f: 4000, a: 0.0005 });
  },
  hover: (s) => {
    tone(s, { f: 2600, dur: 0.025, v: 0.05, a: 0.001 });
  },

  // --- misc ambience one-shots ---------------------------------------------------------------------------------------
  snore: (s) => {
    const g = gate(s, { rate: 28, rate2: 22, dur: 1.0, base: 0.55, depth: 0.45, type: 'sawtooth' });
    tone(s, { type: 'sawtooth', f: 75, f2: 62, dur: 1.0, v: 0.25, curve: 'swell', bp: 450, q: 1.5, to: g });
    noise(s, { dur: 1.0, v: 0.12, curve: 'swell', type: 'bandpass', f: 700, q: 1, to: g });
    noise(s, { at: 1.15, dur: 0.75, v: 0.1, curve: 'swell', type: 'bandpass', f: 1300, f2: 900, q: 1.2 });
    tone(s, { at: 1.2, f: 900, f2: 700, dur: 0.6, v: 0.025, curve: 'swell' });
  },
  flush: (s) => {
    noise(s, { dur: 0.04, v: 0.35, type: 'bandpass', f: 1200, q: 2, a: 0.001 });
    tone(s, { type: 'triangle', f: 300, f2: 180, dur: 0.06, v: 0.15, a: 0.001 });
    const r = noise(s, { at: 0.08, dur: 2.2, v: 0.4, a: 0.3, curve: 'lin', type: 'bandpass', f: 700, f2: 400, q: 0.7 });
    lfo(s, r.f.frequency, { rate: 7, depth: s.F(200), at: 0.08, dur: 2.2 });
    noise(s, { at: 0.1, dur: 1.8, v: 0.2, curve: 'swell', type: 'highpass', f: 3000 });
    for (let i = 0; i < 4; i++) {
      tone(s, { at: 1.8 + i * 0.12, f: rand(200, 350), f2: rand(500, 800), dur: 0.1, v: 0.08, a: 0.003 });
    }
    noise(s, { at: 2.0, dur: 0.8, v: 0.06, curve: 'lin', type: 'highpass', f: 5000 });
  },
  boat: (s) => {
    const g = gate(s, { rate: 35, rate2: 25, dur: 0.18, base: 0.5, depth: 0.5, type: 'square' });
    tone(s, { type: 'sawtooth', f: 220, f2: 180, dur: 0.18, v: 0.07, curve: 'swell', bp: 1300, q: 4, to: g });
    noise(s, { at: 0.12, dur: 0.35, v: 0.3, a: 0.01, type: 'bandpass', f: 1600, f2: 500, q: 0.9 });
    noise(s, { at: 0.3, dur: 0.45, v: 0.15, curve: 'swell', type: 'lowpass', f: 700, f2: 400 });
    for (let i = 0; i < 3; i++) {
      tone(s, { at: rand(0.7, 1.0), f: rand(900, 1500), f2: rand(1600, 2600), glide: 0.03, dur: 0.05, v: 0.05, a: 0.002 });
    }
  },
  engine: (s) => {
    // starter motor cranking
    const cr = gate(s, { rate: 8, rate2: 10, dur: 0.75, base: 0.5, depth: 0.5, type: 'sine' });
    tone(s, { type: 'sawtooth', f: 85, f2: 95, dur: 0.75, v: 0.22, a: 0.02, curve: 'hold', rel: 0.04, lp: 650, to: cr });
    noise(s, { dur: 0.75, v: 0.12, type: 'bandpass', f: 600, q: 1, curve: 'hold', to: cr });
    // catch, rev, settle to idle
    const at = 0.72;
    const e1 = tone(s, { at, type: 'sawtooth', f: 38, f2: 105, glide: 0.45, dur: 1.7, v: 0.32, a: 0.03, curve: 'hold', rel: 0.35, lp: 500 });
    const e2 = tone(s, { at, type: 'square', f: 19, f2: 52, glide: 0.45, dur: 1.7, v: 0.14, a: 0.03, curve: 'hold', rel: 0.35, lp: 300 });
    e1.osc.frequency.exponentialRampToValueAtTime(s.F(55), s.T(at + 1.15));
    e2.osc.frequency.exponentialRampToValueAtTime(s.F(27.5), s.T(at + 1.15));
    if (e1.f) {
      e1.f.frequency.linearRampToValueAtTime(s.F(1500), s.T(at + 0.45));
      e1.f.frequency.linearRampToValueAtTime(s.F(650), s.T(at + 1.15));
    }
    const ex = noise(s, { at, dur: 1.7, v: 0.14, type: 'lowpass', f: 400, curve: 'hold', a: 0.03, rel: 0.35 });
    ex.f.frequency.linearRampToValueAtTime(s.F(1100), s.T(at + 0.45));
    ex.f.frequency.linearRampToValueAtTime(s.F(450), s.T(at + 1.15));
    noise(s, { at, dur: 0.06, v: 0.3, type: 'lowpass', f: 300, a: 0.002 });
  },
};

// ---------------------------------------------------------------------------------------------
// Gibberish character voices
// ---------------------------------------------------------------------------------------------
function renderVoice(s: Sink, kind: VoiceKind, pitch: number): void {
  const b = 160 * pitch;
  const fs = Math.pow(pitch, 0.3);
  const o: BabbleOpts = { fscale: fs };
  const y: Syl[] = [];
  const V = (): Vowel => pick(VOWELS);
  switch (kind) {
    case 'chatter': {
      const n = randi(3, 6);
      const q = chance(0.3);
      let at = 0;
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        const dur = rand(0.06, 0.12) * (last ? 1.5 : 1);
        const f = b * (1.08 - i * 0.03) * rand(0.9, 1.14);
        y.push({ at, dur, f, f2: last ? f * (q ? 1.3 : 0.82) : f * rand(0.93, 1.06), vowel: V(), v: rand(0.5, 0.72) });
        at += dur + rand(0.015, 0.05);
      }
      break;
    }
    case 'shout': {
      o.type = 'square';
      o.harsh = true;
      const n = randi(2, 3);
      let at = 0;
      for (let i = 0; i < n; i++) {
        const dur = rand(0.13, 0.2);
        const f = b * 1.4 * rand(0.95, 1.1);
        y.push({ at, dur, f, f2: f * 0.85, vowel: pick(['a', 'o', 'e'] as const), v: 0.6 });
        at += dur + 0.045;
      }
      break;
    }
    case 'scream': {
      o.vib = 0.05;
      o.vibRate = 8;
      o.harsh = true;
      y.push({ at: 0, dur: 0.85, f: b * 2.6, f2: b * 2.2, vowel: 'a', vowel2: 'i', v: 0.3 });
      noise(s, { dur: 0.85, v: 0.07, type: 'bandpass', f: 3000 * fs, q: 1, curve: 'hold', a: 0.03, rel: 0.2 });
      break;
    }
    case 'hmm':
      o.closed = true;
      o.type = 'triangle';
      y.push({ at: 0, dur: 0.16, f: b * 0.85, f2: b * 0.8, vowel: 'u', v: 0.36 });
      y.push({ at: 0.22, dur: 0.38, f: b * 0.8, f2: b * 1.15, vowel: 'u', v: 0.42 });
      break;
    case 'huh':
      y.push({ at: 0.03, dur: 0.24, f: b * 0.95, f2: b * 1.45, vowel: 'a', vowel2: 'o', v: 0.68, breath: 0.6 });
      break;
    case 'gasp':
      noise(s, { dur: 0.36, v: 0.3, type: 'bandpass', f: 1400 * fs, f2: 2600 * fs, q: 1.1, a: 0.25, curve: 'hold', rel: 0.03 });
      y.push({ at: 0.06, dur: 0.28, f: b * 2.1, f2: b * 2.5, vowel: 'a', v: 0.12 });
      break;
    case 'laugh': {
      const n = randi(4, 5);
      let at = 0;
      let f = b * 1.5;
      for (let i = 0; i < n; i++) {
        y.push({ at, dur: 0.08, f, f2: f * 0.92, vowel: 'a', v: 0.62 - i * 0.05, breath: 0.6 });
        at += 0.135;
        f *= 0.93;
      }
      break;
    }
    case 'grumble': {
      const n = randi(5, 8);
      let at = 0;
      for (let i = 0; i < n; i++) {
        const dur = rand(0.05, 0.1);
        const f = b * 0.72 * rand(0.92, 1.08);
        y.push({ at, dur, f, f2: f * rand(0.9, 1.02), vowel: pick(['o', 'u', 'e'] as const), v: rand(0.4, 0.55) });
        at += dur + rand(0.01, 0.04);
      }
      break;
    }
    case 'cheer':
      o.vib = 0.025;
      o.vibRate = 6;
      y.push({ at: 0, dur: 0.16, f: b * 1.2, f2: b * 1.35, vowel: 'u', v: 0.45 });
      y.push({ at: 0.2, dur: 0.6, f: b * 1.45, f2: b * 1.95, vowel: 'u', vowel2: 'o', v: 0.45, breath: 0.4 });
      break;
    case 'sigh':
      noise(s, { dur: 0.8, v: 0.2, type: 'bandpass', f: 1100 * fs, f2: 600 * fs, q: 0.8, curve: 'swell' });
      y.push({ at: 0.1, dur: 0.6, f: b * 1.1, f2: b * 0.75, vowel: 'a', vowel2: 'o', v: 0.2 });
      break;
    case 'ahem':
      noise(s, { dur: 0.06, v: 0.12, type: 'lowpass', f: 600 });
      y.push({ at: 0, dur: 0.07, f: b * 0.9, f2: b * 0.86, vowel: 'a', v: 0.5 });
      y.push({ at: 0.13, dur: 0.17, f: b * 0.82, f2: b * 0.72, vowel: 'e', vowel2: 'u', v: 0.6, breath: 0.5 });
      break;
    case 'oops':
      y.push({ at: 0, dur: 0.1, f: b * 1.45, f2: b * 1.35, vowel: 'u', v: 0.62 });
      y.push({ at: 0.15, dur: 0.15, f: b * 1.2, f2: b * 0.95, vowel: 'o', v: 0.6 });
      noise(s, { at: 0.31, dur: 0.02, v: 0.15, type: 'lowpass', f: 1500, a: 0.001 });
      break;
    default:
      return;
  }
  babble(s, y, o);
}

// ---------------------------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------------------------
type Ticker = (now: number, horizon: number, audible: boolean) => void;
interface LoopDef {
  base: number;
  build: (s: Sink) => Ticker | null;
}

/** Continuous oscillator into `to` (loops only — no stop time). */
function drone(s: Sink, type: OscillatorType, f: number, v: number, to: AudioNode, detune = 0): OscillatorNode {
  const o = s.ctx.createOscillator();
  o.type = type;
  o.frequency.value = s.F(f);
  if (detune) o.detune.value = detune;
  const g = s.add(s.ctx.createGain());
  g.gain.value = v;
  o.connect(g);
  g.connect(to);
  s.src(o, s.t0);
  return o;
}

function biquad(s: Sink, type: BiquadFilterType, f: number, q: number, to: AudioNode): BiquadFilterNode {
  const b = s.add(s.ctx.createBiquadFilter());
  b.type = type;
  b.frequency.value = s.F(f);
  b.Q.value = q;
  b.connect(to);
  return b;
}

function gainTo(s: Sink, v: number, to: AudioNode): GainNode {
  const g = s.add(s.ctx.createGain());
  g.gain.value = v;
  g.connect(to);
  return g;
}

function noiseLoop(s: Sink, to: AudioNode): AudioBufferSourceNode {
  const n = s.ctx.createBufferSource();
  n.buffer = s.noiseBuf;
  n.loop = true;
  n.connect(to);
  s.src(n, s.t0, undefined, Math.random() * Math.max(0, s.noiseBuf.duration - 0.1));
  return n;
}

function performerTicker(s: Sink, perf: Performer, dest: AudioNode): Ticker {
  return (now, horizon, audible) => {
    perf.pump(now, horizon, (e) => {
      if (audible) renderEvent(s.ctx, dest, s.noiseBuf, e, s.p);
    });
  };
}

const LOOPS: Record<LoopName, LoopDef> = {
  alarm: {
    base: 0.4,
    build: (s) => {
      const lp = biquad(s, 'lowpass', 3200, 0.7, s.out);
      const mix = gainTo(s, 1, lp);
      // classic hi-lo electronic siren: square LFO flips the pitch between ~750 and ~960 Hz
      const l = s.ctx.createOscillator();
      l.type = 'square';
      l.frequency.value = 0.9 * s.p;
      const lg = s.add(s.ctx.createGain());
      lg.gain.value = 105 * s.p;
      l.connect(lg);
      const voices: ReadonlyArray<readonly [OscillatorType, number, number]> = [
        ['sawtooth', 0, 0.45],
        ['square', 7, 0.3],
        ['triangle', -5, 0.6],
      ];
      for (const [type, det, v] of voices) {
        const o = drone(s, type, 855, v, mix, det);
        lg.connect(o.frequency);
      }
      s.src(l, s.t0);
      return null;
    },
  },
  fire_bell: {
    base: 0.5,
    build: (s) => {
      // gong partials re-struck ~19x per second by the hammer (inverted saw AM: instant hit, linear decay)
      const am = gainTo(s, 0.65, s.out);
      const l = s.ctx.createOscillator();
      l.type = 'sawtooth';
      l.frequency.value = 19 * s.p;
      const lg = s.add(s.ctx.createGain());
      lg.gain.value = -0.35;
      l.connect(lg);
      lg.connect(am.gain);
      s.src(l, s.t0);
      const parts: ReadonlyArray<readonly [number, number]> = [
        [1, 0.3],
        [1.004, 0.15],
        [2.32, 0.14],
        [3.7, 0.08],
        [5.1, 0.045],
      ];
      for (const [r, v] of parts) drone(s, 'sine', 1180 * r, v, am);
      noiseLoop(s, biquad(s, 'highpass', 2500, 0.7, gainTo(s, 0.05, am)));
      return null;
    },
  },
  jukebox: {
    base: 0.5,
    build: (s) => {
      const lp = biquad(s, 'lowpass', 5200, 0.6, s.out);
      return performerTicker(s, new Performer(jukeboxPlan(), s.t0 + 0.05), lp);
    },
  },
  piano: {
    base: 1.2,
    build: (s) => performerTicker(s, new Performer(pianistPlan(), s.t0 + 0.1), s.out),
  },
  crowd: {
    base: 0.22,
    build: (s) => {
      const src = s.ctx.createBufferSource();
      src.buffer = s.noiseBuf;
      src.loop = true;
      const g1 = gainTo(s, 0.5, s.out);
      const g2 = gainTo(s, 0.18, s.out);
      const bp1 = biquad(s, 'bandpass', 450, 0.8, g1);
      const bp2 = biquad(s, 'bandpass', 1100, 1.2, g2);
      src.connect(bp1);
      src.connect(bp2);
      s.src(src, s.t0, undefined, Math.random());
      lfo(s, g1.gain, { rate: 3.3, depth: 0.12 });
      lfo(s, g2.gain, { rate: 4.7, depth: 0.05 });
      const bab = gainTo(s, 0.45, s.out);
      let nextSwell = s.t0;
      let nextBlip = s.t0 + rand(0.2, 0.8);
      return (now, horizon, audible) => {
        if (nextSwell < horizon) {
          const at = Math.max(now, nextSwell);
          g1.gain.setTargetAtTime(rand(0.35, 0.65), at, 0.4);
          nextSwell = at + rand(0.6, 1.5);
        }
        if (nextBlip < now - 1) nextBlip = now + 0.05;
        let guard = 0;
        while (nextBlip < horizon && guard++ < 8) {
          if (audible) {
            const ctx = s.ctx;
            let dest: AudioNode = bab;
            let pn: StereoPannerNode | null = null;
            if (typeof ctx.createStereoPanner === 'function') {
              pn = ctx.createStereoPanner();
              pn.pan.value = rand(-0.6, 0.6);
              pn.connect(bab);
              dest = pn;
            }
            const vs = new Sink(ctx, dest, Math.max(now, nextBlip), 1, s.noiseBuf);
            if (pn) vs.add(pn);
            renderVoice(vs, chance(0.08) ? 'laugh' : chance(0.1) ? 'hmm' : 'chatter', rand(0.75, 1.45));
            vs.finish();
          }
          nextBlip += rand(0.35, 1.3);
        }
      };
    },
  },
  fountain: {
    base: 0.28,
    build: (s) => {
      const src = s.ctx.createBufferSource();
      src.buffer = s.noiseBuf;
      src.loop = true;
      const g1 = gainTo(s, 0.55, s.out);
      const g2 = gainTo(s, 0.4, s.out);
      const bp = biquad(s, 'bandpass', 2400, 0.5, g1);
      const hp = biquad(s, 'highpass', 500, 0.7, bp);
      const lp = biquad(s, 'lowpass', 700, 0.7, g2);
      src.connect(hp);
      src.connect(lp);
      s.src(src, s.t0, undefined, Math.random());
      lfo(s, g1.gain, { rate: 0.27, depth: 0.12 });
      lfo(s, g1.gain, { rate: 7.3, depth: 0.05 });
      lfo(s, g2.gain, { rate: 0.41, depth: 0.1 });
      let next = s.t0;
      return (now, horizon, audible) => {
        if (next < now - 1) next = now;
        let guard = 0;
        while (next < horizon && guard++ < 16) {
          if (audible) {
            const d = new Sink(s.ctx, s.out, Math.max(now, next), s.p, s.noiseBuf);
            const f = rand(600, 2000);
            tone(d, { f, f2: f * rand(1.3, 2), glide: 0.035, dur: 0.06, v: rand(0.03, 0.09), a: 0.002 });
            d.finish();
          }
          next += rand(0.04, 0.25);
        }
      };
    },
  },
  hum: {
    base: 0.16,
    build: (s) => {
      const mg = gainTo(s, 0.8, s.out);
      drone(s, 'sawtooth', 60, 0.35, biquad(s, 'lowpass', 320, 0.7, mg));
      drone(s, 'sine', 120, 0.4, mg);
      drone(s, 'sine', 180, 0.12, mg);
      drone(s, 'square', 60, 0.025, biquad(s, 'bandpass', 2200, 5, mg));
      lfo(s, mg.gain, { rate: 0.6, depth: 0.08 });
      return null;
    },
  },
};

interface LoopInst {
  id: string;
  name: LoopName;
  x?: number;
  z?: number;
  vol: number;
  out: GainNode;
  pan: StereoPannerNode | null;
  sink: Sink;
  base: number;
  tick: Ticker | null;
  lastG: number;
  lastP: number;
  audible: boolean;
}

interface LoopSpec {
  name: LoopName;
  x?: number;
  z?: number;
  volume?: number;
  pitch?: number;
}

type WebkitWindow = typeof globalThis & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

// ---------------------------------------------------------------------------------------------
// GameAudio
// ---------------------------------------------------------------------------------------------
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: { sfx: GainNode; voice: GainNode; loops: GainNode; music: GainNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicEng: MusicEngine | null = null;
  private shots: Sink[] = [];
  private voices: Sink[] = [];
  private loops = new Map<string, LoopInst>();
  private specs = new Map<string, LoopSpec>();
  private graveyard: Array<{ at: number; fn: () => void }> = [];
  private lastVoice: Partial<Record<VoiceKind, number>> = {};
  private lx = 0;
  private lz = 0;
  private _muted = false;
  private vol = 0.8;
  private musicState: MusicState = 'off';
  private failed = false;
  private lastResumeTry = 0;
  private unlockBound = false;
  private pumpTimer: number | null = null;

  /** Must be called from a user gesture (click/keydown). Safe to call many times. */
  init(): void {
    try {
      if (typeof window === 'undefined') return;
      if (this.ctx) {
        this.resume();
        return;
      }
      if (this.failed) return;
      const w = window as WebkitWindow;
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) {
        this.failed = true;
        return;
      }
      const ctx = new AC({ latencyHint: 'interactive' });
      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : this.vol;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      // brick-wall-ish limiter after the glue compressor so pile-ups never clip
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.001;
      lim.release.value = 0.1;
      const mix = ctx.createGain();
      mix.connect(comp);
      comp.connect(lim);
      lim.connect(master);
      master.connect(ctx.destination);
      const bus = (v: number): GainNode => {
        const g = ctx.createGain();
        g.gain.value = v;
        g.connect(mix);
        return g;
      };
      this.buses = {
        sfx: bus(BUS_LEVEL.sfx),
        voice: bus(BUS_LEVEL.voice),
        loops: bus(BUS_LEVEL.loops),
        music: bus(BUS_LEVEL.music),
      };
      this.noiseBuf = makeNoiseBuffer(ctx, 2);
      this.master = master;
      this.ctx = ctx;
      this.musicEng = new MusicEngine(ctx, this.buses.music, this.noiseBuf);
      this.resume();
      this.bindUnlock();
      this.startPumpTimer();
      // Apply anything requested before init.
      this.musicEng.set(this.musicState);
      for (const [id, spec] of this.specs) this.startLoop(id, spec);
    } catch {
      this.failed = true;
      this.ctx = null;
      this.buses = null;
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Listener position (the player/camera target) on the ground plane. */
  setListener(x: number, z: number): void {
    this.lx = finite(x, this.lx);
    this.lz = finite(z, this.lz);
  }

  play(name: SfxName, opts?: PlayOpts): void {
    try {
      const ctx = this.live();
      if (!ctx || !this.buses) return;
      const recipe = SFX[name];
      if (!recipe) return;
      const p = clamp(finite(opts?.pitch, 1), 0.25, 4);
      const s = this.shot(ctx, this.buses.sfx, opts, this.shots, MAX_SFX, p);
      if (!s) return;
      try {
        recipe(s);
      } finally {
        s.finish();
      }
    } catch {
      /* never throw */
    }
  }

  /** pitch: per-character base pitch multiplier (0.7 = deep, 1.4 = high). */
  voice(kind: VoiceKind, opts?: PlayOpts): void {
    try {
      const ctx = this.live();
      if (!ctx || !this.buses) return;
      const now = ctx.currentTime;
      const last = this.lastVoice[kind];
      if (last !== undefined && now - last < VOICE_GAP && now >= last) return;
      const s = this.shot(ctx, this.buses.voice, opts, this.voices, MAX_VOICES, 1);
      if (!s) return;
      this.lastVoice[kind] = now;
      try {
        renderVoice(s, kind, clamp(finite(opts?.pitch, 1), 0.4, 2.5));
      } finally {
        s.finish();
      }
    } catch {
      /* never throw */
    }
  }

  /** Start (or update position of) a named positional loop instance. id is caller-chosen and unique. */
  loop(id: string, name: LoopName, opts?: PlayOpts): void {
    try {
      if (!LOOPS[name]) return;
      let spec = this.specs.get(id);
      if (!spec) {
        spec = { name };
        this.specs.set(id, spec);
      }
      spec.name = name;
      spec.x = opts?.x;
      spec.z = opts?.z;
      spec.volume = opts?.volume;
      spec.pitch = opts?.pitch;
      if (!this.ctx || !this.buses) return;
      const inst = this.loops.get(id);
      if (inst && inst.name === name) {
        inst.x = finiteOrUndef(spec.x);
        inst.z = finiteOrUndef(spec.z);
        inst.vol = clamp(finite(spec.volume, 1), 0, 2);
        return;
      }
      if (inst) {
        this.loops.delete(id);
        this.killLoop(inst, 0.2);
      }
      this.startLoop(id, spec);
    } catch {
      /* never throw */
    }
  }

  stopLoop(id: string, fadeSeconds = 0.4): void {
    try {
      this.specs.delete(id);
      const inst = this.loops.get(id);
      if (!inst) return;
      this.loops.delete(id);
      this.killLoop(inst, fadeSeconds);
    } catch {
      /* never throw */
    }
  }

  stopAllLoops(): void {
    try {
      this.specs.clear();
      for (const inst of this.loops.values()) this.killLoop(inst, 0.3);
      this.loops.clear();
    } catch {
      /* never throw */
    }
  }

  setMusic(state: MusicState): void {
    try {
      if (state === this.musicState) return;
      this.musicState = state;
      if (this.musicEng) this.musicEng.set(state);
    } catch {
      /* never throw */
    }
  }

  setMuted(muted: boolean): void {
    this._muted = !!muted;
    this.applyMaster();
  }

  get muted(): boolean {
    return this._muted;
  }

  setMasterVolume(v: number): void {
    this.vol = clamp(finite(v, this.vol), 0, 1);
    this.applyMaster();
  }

  /** Call every frame. Updates positional attenuation of loops, schedules generative music notes ahead of time. */
  update(_dt: number): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.buses) return;
      const now = ctx.currentTime;
      if (this.graveyard.length) {
        for (let i = this.graveyard.length - 1; i >= 0; i--) {
          const g = this.graveyard[i];
          if (g.at <= now) {
            this.graveyard.splice(i, 1);
            try {
              g.fn();
            } catch {
              /* ignore */
            }
          }
        }
      }
      if (ctx.state !== 'running') return;
      const horizon = now + LOOKAHEAD;
      for (const inst of this.loops.values()) {
        try {
          this.updateLoopGain(inst, now, 0.06);
          if (inst.tick) inst.tick(now, horizon, inst.audible);
        } catch {
          inst.tick = null;
        }
      }
      try {
        if (this.musicEng) this.musicEng.pump(now, horizon);
      } catch {
        /* keep going */
      }
      prune(this.shots, now);
      prune(this.voices, now);
    } catch {
      /* never throw */
    }
  }

  // -------------------------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------------------------
  private resume(force = true): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    // Rate-limit implicit attempts (play() before a gesture) so we do not spam the console.
    const nowMs = Date.now();
    if (!force && nowMs - this.lastResumeTry < 1000) return;
    this.lastResumeTry = nowMs;
    try {
      const pr = ctx.resume() as Promise<void> | undefined;
      if (pr && typeof pr.catch === 'function') pr.catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  /** Keep the look-ahead queue topped up even when frames are slow (a hidden tab stays quiet). */
  private startPumpTimer(): void {
    if (this.pumpTimer !== null || typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
    this.pumpTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.update(0);
    }, PUMP_MS);
  }

  /** If the context starts suspended (autoplay policy), resume it on the next user gesture. */
  private bindUnlock(): void {
    if (this.unlockBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this.unlockBound = true;
    const evs = ['pointerdown', 'keydown', 'touchend'] as const;
    const unlock = (): void => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state === 'running') {
        for (const e of evs) window.removeEventListener(e, unlock, true);
        return;
      }
      this.resume();
    };
    for (const e of evs) window.addEventListener(e, unlock, true);
  }

  /** Context if it is running (tries to resume otherwise and returns null). */
  private live(): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (ctx.state !== 'running') {
      this.resume(false);
      return null;
    }
    return ctx;
  }

  private applyMaster(): void {
    try {
      const ctx = this.ctx;
      const m = this.master;
      if (!ctx || !m) return;
      const target = this._muted ? 0 : this.vol;
      const now = ctx.currentTime;
      m.gain.cancelScheduledValues(now);
      m.gain.setValueAtTime(m.gain.value, now);
      m.gain.setTargetAtTime(target, now, 0.03);
    } catch {
      /* never throw */
    }
  }

  private atten(x: number, z: number): number {
    const d = Math.hypot(x - this.lx, z - this.lz);
    if (!(d < HEAR_RANGE)) return 0;
    const a = 1 / ((1 + d * 0.15) * (1 + d * 0.15));
    const edge = d > HEAR_RANGE - 6 ? (HEAR_RANGE - d) / 6 : 1;
    return a * edge;
  }

  private panFor(x: number): number {
    return clamp((x - this.lx) / 10, -0.8, 0.8);
  }

  /** Create the per-sound output (gain [+ panner]) and enforce polyphony. */
  private shot(ctx: AudioContext, bus: GainNode, opts: PlayOpts | undefined, list: Sink[], max: number, p: number): Sink | null {
    const now = ctx.currentTime;
    let g = clamp(finite(opts?.volume, 1), 0, 2);
    let pan = 0;
    let positional = false;
    const x = opts?.x;
    const z = opts?.z;
    if (typeof x === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(z)) {
      positional = true;
      g *= this.atten(x, z);
      pan = this.panFor(x);
    }
    if (g < 0.002 || !this.noiseBuf) return null;
    prune(list, now);
    while (list.length >= max) {
      const old = list.shift();
      if (old) killShot(old, now);
    }
    const out = ctx.createGain();
    out.gain.value = g;
    const s = new Sink(ctx, out, now + 0.005, p, this.noiseBuf);
    s.add(out);
    s.fader = out;
    if (positional && typeof ctx.createStereoPanner === 'function') {
      const pn = s.add(ctx.createStereoPanner());
      pn.pan.value = pan;
      out.connect(pn);
      pn.connect(bus);
    } else out.connect(bus);
    list.push(s);
    return s;
  }

  private startLoop(id: string, spec: LoopSpec): void {
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses || !this.noiseBuf) return;
    const def = LOOPS[spec.name];
    if (!def) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    let pan: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      out.connect(pan);
      pan.connect(buses.loops);
    } else out.connect(buses.loops);
    const p = clamp(finite(spec.pitch, 1), 0.25, 4);
    const sink = new Sink(ctx, out, ctx.currentTime + 0.01, p, this.noiseBuf);
    let tick: Ticker | null = null;
    try {
      tick = def.build(sink);
    } catch {
      tick = null;
    }
    const inst: LoopInst = {
      id,
      name: spec.name,
      x: finiteOrUndef(spec.x),
      z: finiteOrUndef(spec.z),
      vol: clamp(finite(spec.volume, 1), 0, 2),
      out,
      pan,
      sink,
      base: def.base,
      tick,
      lastG: -1,
      lastP: 0,
      audible: false,
    };
    this.loops.set(id, inst);
    this.updateLoopGain(inst, ctx.currentTime, 0.25);
  }

  private updateLoopGain(inst: LoopInst, now: number, tau: number): void {
    let g = inst.base * inst.vol;
    let p = 0;
    if (inst.x !== undefined && inst.z !== undefined) {
      g *= this.atten(inst.x, inst.z);
      p = this.panFor(inst.x);
    }
    if (Math.abs(g - inst.lastG) > 0.002 + inst.lastG * 0.02) {
      inst.out.gain.setTargetAtTime(g, now, tau);
      inst.lastG = g;
    }
    if (inst.pan && Math.abs(p - inst.lastP) > 0.01) {
      inst.pan.pan.setTargetAtTime(p, now, tau);
      inst.lastP = p;
    }
    inst.audible = g > 0.0015;
  }

  private killLoop(inst: LoopInst, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const f = clamp(finite(fade, 0.4), 0.01, 10);
    const gp = inst.out.gain;
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(gp.value, now);
    gp.linearRampToValueAtTime(0, now + f);
    inst.tick = null;
    const endAt = now + f + 0.05;
    inst.sink.kill(endAt);
    this.graveyard.push({
      at: endAt + 0.6,
      fn: () => {
        inst.sink.dispose();
        try {
          inst.out.disconnect();
          inst.pan?.disconnect();
        } catch {
          /* ignore */
        }
      },
    });
  }
}

function finiteOrUndef(v: number | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function prune(list: Sink[], now: number): void {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].end < now) list.splice(i, 1);
}

function killShot(s: Sink, now: number): void {
  try {
    const f = s.fader;
    if (f) {
      f.gain.cancelScheduledValues(now);
      f.gain.setValueAtTime(f.gain.value, now);
      f.gain.linearRampToValueAtTime(0, now + 0.03);
    }
    s.kill(now + 0.04);
  } catch {
    /* ignore */
  }
}

/** Singleton instance. */
export const audio: GameAudio = new GameAudio();
