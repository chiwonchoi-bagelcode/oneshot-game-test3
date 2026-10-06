// Generative, adaptive solo-piano score (Untitled-Goose-Game spirit) + generative loop "performers"
// for the diegetic party pianist and the jukebox. Notes are generated phrase-by-phrase and only turned
// into Web Audio nodes inside a short look-ahead window driven from GameAudio.update().

import type { MusicState } from './Audio';
import { type NoteEv, type Inst, renderEvent, clamp, rand, randi, pick, chance } from './synth';

export type Phrase = { ev: NoteEv[]; len: number };
export type Plan = (t0: number) => Phrase;

// ---------------------------------------------------------------------------------------------
// Theory helpers
// ---------------------------------------------------------------------------------------------
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENT = [0, 2, 4, 7, 9];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];
const WHOLE = [0, 2, 4, 6, 8, 10];

const pc = (m: number): number => ((Math.round(m) % 12) + 12) % 12;
const pcsOf = (root: number, scale: readonly number[]): number[] => scale.map((x) => pc(root + x));
const inSet = (m: number, pcs: readonly number[]): boolean => pcs.includes(pc(m));

/** Next note strictly above/below m whose pitch class is in pcs. */
function stepIn(m: number, pcs: readonly number[], dir: number): number {
  let x = m;
  const d = dir >= 0 ? 1 : -1;
  for (let g = 0; g < 12; g++) {
    x += d;
    if (inSet(x, pcs)) return x;
  }
  return m + d;
}
/** Nearest note to m in pcs. */
function snapTo(m: number, pcs: readonly number[]): number {
  for (let k = 0; k < 7; k++) {
    if (inSet(m + k, pcs)) return m + k;
    if (inSet(m - k, pcs)) return m - k;
  }
  return m;
}
/** Octave-shift m into [lo, hi]. */
function fit(m: number, lo: number, hi: number): number {
  let x = m;
  let g = 0;
  while (x < lo && g++ < 12) x += 12;
  while (x > hi && g++ < 24) x -= 12;
  return x;
}
const hz = (): number => rand(-0.008, 0.008);
const N = (t: number, m: number, v: number, d: number, i?: Inst): NoteEv => ({ t: Math.max(0, t), m, v: clamp(v, 0.02, 1), d, i });

/** Melodic random walker over a pitch-class set. */
class Walker {
  m: number;
  constructor(m: number) {
    this.m = m;
  }
  move(pcs: readonly number[], lo: number, hi: number, maxStep = 2, leapP = 0.1): number {
    let n = randi(1, maxStep);
    if (chance(leapP)) n = randi(3, 5);
    if (chance(0.1)) n = 0;
    let dir = chance(0.5) ? 1 : -1;
    if (this.m + 4 > hi) dir = -1;
    if (this.m - 4 < lo) dir = 1;
    let x = this.m;
    if (n === 0) x = snapTo(x, pcs);
    for (let i = 0; i < n; i++) x = stepIn(x, pcs, dir);
    if (x > hi || x < lo) {
      x = this.m;
      for (let i = 0; i < Math.max(1, n); i++) x = stepIn(x, pcs, -dir);
    }
    if (x > hi || x < lo) x = snapTo(fit(x, lo, hi), pcs);
    this.m = x;
    return x;
  }
}

// ---------------------------------------------------------------------------------------------
// Performer: phrase queue + look-ahead emission
// ---------------------------------------------------------------------------------------------
export class Performer {
  private q: NoteEv[] = [];
  private next: number;
  private readonly plan: Plan;
  constructor(plan: Plan, start: number) {
    this.plan = plan;
    this.next = start;
  }
  pump(now: number, horizon: number, emit: (e: NoteEv) => void): void {
    if (this.next < now - 1) {
      // We fell behind (tab hidden / long hitch): resync instead of bursting.
      this.q.length = 0;
      this.next = now + 0.05;
    }
    let added = false;
    let guard = 0;
    while (this.next < horizon + 0.25 && guard++ < 16) {
      const ph = this.plan(this.next);
      for (const e of ph.ev) this.q.push(e);
      this.next += Math.max(0.25, Number.isFinite(ph.len) ? ph.len : 1);
      added = true;
    }
    if (added) this.q.sort((a, b) => a.t - b.t);
    let i = 0;
    while (i < this.q.length && this.q[i].t < horizon) {
      const e = this.q[i++];
      if (e.t >= now - 0.08) {
        if (e.t < now) e.t = now;
        emit(e);
      }
    }
    if (i) this.q.splice(0, i);
  }
}

// ---------------------------------------------------------------------------------------------
// Score plans
// ---------------------------------------------------------------------------------------------

/** 'title': gentle waltz noodling in C major (3/4, oom-pah-pah + wandering melody). */
function titlePlan(): Plan {
  const b = 60 / 96;
  const prog: ReadonlyArray<readonly [number, readonly number[]]> = [
    [41, [0, 4, 7, 11]],
    [40, [0, 3, 7, 10]],
    [38, [0, 3, 7, 10, 14]],
    [43, [0, 5, 7, 10, 14]],
    [36, [0, 4, 7, 11, 14]],
    [45, [0, 3, 7, 10]],
    [38, [0, 3, 7, 10, 14]],
    [43, [0, 4, 7, 10, 14]],
  ];
  const sc = pcsOf(0, MAJOR);
  const w = new Walker(76);
  const prob = [0.85, 0.3, 0.6, 0.35, 0.6, 0.4];
  let bar = 0;
  return (t0) => {
    const [r, iv] = prog[bar % prog.length];
    const ev: NoteEv[] = [];
    const bb = b * rand(0.97, 1.05);
    const ee = bb / 2;
    ev.push(N(t0, r, 0.4, bb * 2.8));
    const upper = iv.slice(1, 4).map((x) => fit(r + x, 52, 66));
    for (const k of [1, 2]) upper.forEach((m, j) => ev.push(N(t0 + k * bb + j * 0.012, m, k === 1 ? 0.24 : 0.2, bb * 0.7)));
    const ct = iv.map((x) => pc(r + x));
    if (bar % 4 === 3) {
      const m = snapTo(w.move(sc, 67, 86), ct);
      w.m = m;
      ev.push(N(t0 + hz(), m, 0.4, bb * 2.6));
      if (chance(0.5)) ev.push(N(t0 + 2 * bb + ee, stepIn(m, sc, chance(0.5) ? 1 : -1), 0.3, ee));
    } else {
      const slots: number[] = [];
      for (let k = 0; k < 6; k++) if (chance(prob[k])) slots.push(k);
      slots.forEach((k, j) => {
        let m = w.move(sc, 67, 86, 2);
        if (k % 2 === 0) {
          m = snapTo(m, ct);
          w.m = m;
        }
        const nx = j + 1 < slots.length ? slots[j + 1] : 6;
        ev.push(N(t0 + k * ee + hz(), m, rand(0.32, 0.46) + (k === 0 ? 0.06 : 0), (nx - k) * ee * 1.1));
      });
    }
    bar++;
    return { ev, len: 3 * bb };
  };
}

/** 'calm': lazy, sparse, lots of silence. Pentatonic melody fragments over rolled lush chords. */
function calmPlan(key = 53, density = 1, bpm = 66): Plan {
  const b = 60 / bpm;
  const chords: ReadonlyArray<readonly [number, readonly number[]]> = [
    [0, [0, 4, 7, 11, 14]],
    [2, [0, 3, 7, 10, 14]],
    [5, [0, 4, 7, 11, 18]],
    [7, [0, 5, 7, 10, 14]],
    [9, [0, 3, 7, 10]],
    [4, [0, 3, 7, 10]],
  ];
  const pent = pcsOf(key, PENT);
  const w = new Walker(key + 24);
  let ci = 0;
  let first = true;
  return (t0) => {
    const ev: NoteEv[] = [];
    const len = b * 8;
    const [ro, iv] = chords[ci];
    const root = key + ro;
    const bassN = fit(root, 36, 48);
    let mode: 'rest' | 'melody' | 'tinkle';
    if (first) mode = 'melody';
    else {
      const r = Math.random();
      mode = r < 0.45 / density ? 'rest' : r < 0.83 ? 'melody' : 'tinkle';
    }
    first = false;
    if (mode === 'rest') {
      if (chance(0.45)) ev.push(N(t0 + b * randi(0, 2), bassN, 0.22, b * 5));
    } else {
      if (mode === 'melody' || chance(0.5)) {
        ev.push(N(t0, bassN, 0.3, b * 6));
        iv.slice(1).forEach((x, j) => ev.push(N(t0 + 0.06 * (j + 1) + hz(), fit(root + x, 53, 70), 0.2, b * 5)));
      }
      if (mode === 'melody') {
        let tb = pick([0.5, 1, 1, 1.5]);
        const cnt = randi(3, 6);
        for (let k = 0; k < cnt && tb < 7.5; k++) {
          const durB = k === cnt - 1 ? pick([2, 3]) : pick([0.5, 1, 1, 1.5, 2]);
          const m = w.move(pent, 65, 84, 2, 0.12);
          ev.push(N(t0 + tb * b + hz(), m, rand(0.28, 0.42), durB * b * 1.05));
          tb += durB;
        }
      } else {
        const ct = iv.map((x) => pc(root + x));
        const st = b * pick([0, 1, 2]);
        let m = fit(snapTo(root + 12, ct), 76, 86);
        const cnt = randi(4, 6);
        for (let k = 0; k < cnt; k++) {
          ev.push(N(t0 + st + (k * b) / 4 + hz(), m, 0.23 - k * 0.012, b * 1.5));
          m = stepIn(m, ct, 1);
        }
      }
    }
    ci = (ci + pick([1, 1, 2, 3, 5])) % chords.length;
    return { ev, len };
  };
}

/** 'sneak': tiptoe staccato bass + playful off-beat plucks in D dorian. */
function sneakPlan(): Plan {
  const b = 60 / 112;
  const e = b / 2;
  const sx = b / 4;
  const roots = [38, 38, 43, 45, 38, 38, 46, 45];
  const sc = pcsOf(2, DORIAN);
  const w = new Walker(69);
  let bar = 0;
  return (t0) => {
    const ev: NoteEv[] = [];
    const r = roots[bar % roots.length];
    const pat = [r, r + 7, r + 12, r + 7];
    for (let k = 0; k < 4; k++) ev.push(N(t0 + k * b + hz(), pat[k], k === 0 ? 0.4 : k === 2 ? 0.33 : 0.27, 0.1));
    const rh = !(bar % 8 === 7 && chance(0.6)) && !(bar % 4 === 3 && chance(0.35));
    if (rh) {
      const fig = pick(['off', 'off', 'pairs', 'chrom', 'trip'] as const);
      if (fig === 'off') {
        for (const st of [1, 3, 5, 7]) {
          if (!chance(0.62)) continue;
          const m = w.move(sc, 62, 81, 2, 0.15);
          if (chance(0.22)) ev.push(N(t0 + st * e - 0.05, m - 1, 0.24, 0.04));
          ev.push(N(t0 + st * e + hz(), m, rand(0.34, 0.48), 0.08));
        }
      } else if (fig === 'pairs') {
        for (const st of [1, 5]) {
          const m = w.move(sc, 62, 81);
          const m2 = stepIn(m, sc, chance(0.5) ? 1 : -1);
          ev.push(N(t0 + st * e, m, 0.42, 0.07), N(t0 + st * e + sx, m2, 0.35, 0.07));
        }
        if (chance(0.5)) ev.push(N(t0 + 7 * e, w.move(sc, 62, 81), 0.4, 0.08));
      } else if (fig === 'chrom') {
        const m = w.move(sc, 62, 76);
        const st = pick([1, 3]);
        for (let k = 0; k < 3; k++) ev.push(N(t0 + st * e + k * sx, m + k, 0.33 + k * 0.04, 0.07));
        const land = snapTo(m + 5, sc);
        ev.push(N(t0 + (st + 2) * e, land, 0.48, 0.12));
        w.m = land;
      } else {
        const st = pick([1, 2]) * b;
        let m = w.move(sc, 64, 79);
        for (let k = 0; k < 3; k++) {
          ev.push(N(t0 + st + (k * b) / 3, m, 0.36, 0.07));
          m = stepIn(m, sc, 1);
        }
        const land = snapTo(m + 4, sc);
        ev.push(N(t0 + st + b * 1.5, land, 0.42, 0.1));
        w.m = land;
      }
    }
    if (chance(0.1)) {
      const m = randi(64, 72);
      ev.push(N(t0 + 2 * b, m, 0.16, b * 1.6), N(t0 + 2 * b + 0.02, m + 6, 0.14, b * 1.6));
    }
    bar++;
    return { ev, len: 4 * b };
  };
}

/** 'tension': low chromatic ostinato + dissonant dyads / creeping lines (D phrygian). */
function tensionPlan(): Plan {
  const b = 60 / 96;
  const e = b / 2;
  const shifts = [0, 0, 1, -1, 0, 0, -2, -1];
  const pat = [0, 12, 0, 13, 0, 12, 0, 10];
  const sc = pcsOf(2, PHRYG);
  let bar = 0;
  return (t0) => {
    const ev: NoteEv[] = [];
    const base = 38 + shifts[bar % shifts.length];
    for (let s = 0; s < 8; s++) ev.push(N(t0 + s * e + hz(), base + pat[s], s === 0 ? 0.5 : s % 2 === 0 ? 0.38 : 0.3, e * 0.8));
    if (chance(0.55)) {
      const at = pick([0, 4]) * e;
      const lo = randi(62, 72);
      const iv = pick([1, 6, 11, 13]);
      ev.push(N(t0 + at, lo, 0.3, b * 1.8), N(t0 + at + 0.02, lo + iv, 0.27, b * 1.8));
    } else if (chance(0.4)) {
      const s0 = randi(64, 74);
      for (let k = 0; k < 3; k++) ev.push(N(t0 + (2 + 2 * k) * e + hz(), s0 - k, 0.27, e * 1.6));
    }
    if (chance(0.15)) ev.push(N(t0 + randi(0, 7) * e, snapTo(randi(84, 92), sc), 0.17, 0.5));
    bar++;
    return { ev, len: 8 * e };
  };
}

interface ChordDef {
  r: number; // root pitch class
  tones: readonly number[]; // intervals
  sc: readonly number[]; // absolute pitch classes
}

/** Right-hand half-bar figures for chase / lockdown. */
function figure(ev: NoteEv[], t: number, sx: number, w: Walker, sc: readonly number[], ct: readonly number[], lo: number, hi: number): void {
  const kind = pick(['up', 'down', 'up', 'down', 'rep', 'arp', 'trill'] as const);
  let m = w.m;
  switch (kind) {
    case 'up':
    case 'down': {
      let d = kind === 'up' ? 1 : -1;
      if (d > 0 && m > hi - 9) d = -1;
      if (d < 0 && m < lo + 9) d = 1;
      m = snapTo(m, sc);
      for (let k = 0; k < 8; k++) {
        if (k === 7 && chance(0.5)) break;
        ev.push(N(t + k * sx, m, 0.4 + (d > 0 ? k * 0.015 : 0.1 - k * 0.01), sx * 0.85));
        m = stepIn(m, sc, d);
      }
      break;
    }
    case 'rep': {
      const n = fit(snapTo(m, ct), lo, hi - 12);
      for (const k of [0, 2, 3, 5, 6]) ev.push(N(t + k * sx, n, 0.45, sx * 0.6), N(t + k * sx, n + 12, 0.3, sx * 0.6));
      m = n;
      break;
    }
    case 'arp': {
      let n = fit(snapTo(m, ct), lo, hi - 10);
      const seq: number[] = [];
      for (let k = 0; k < 4; k++) {
        seq.push(n);
        n = stepIn(n, ct, 1);
      }
      const all = [...seq, seq[2], seq[1]];
      all.forEach((x, k) => ev.push(N(t + k * sx, x, 0.42, sx * 0.8)));
      m = all[all.length - 1];
      break;
    }
    case 'trill': {
      const a = fit(snapTo(m, sc), lo, hi - 3);
      const b2 = stepIn(a, sc, 1);
      for (let k = 0; k < 6; k++) ev.push(N(t + k * sx, k % 2 ? b2 : a, 0.38, sx * 0.8));
      m = a;
      break;
    }
  }
  w.m = fit(m, lo, hi);
}

/** 'chase' (fast ragtime-ish stride + frantic runs) and 'lockdown' (octave pulse + runs). */
function runsPlan(lockdown: boolean): Plan {
  const bpm = lockdown ? 138 : 172;
  const b = 60 / bpm;
  const sx = b / 4;
  const prog: ChordDef[] = lockdown
    ? [
        { r: 2, tones: [0, 3, 7], sc: pcsOf(2, HARM_MINOR) },
        { r: 2, tones: [0, 3, 7], sc: pcsOf(2, HARM_MINOR) },
        { r: 10, tones: [0, 4, 7], sc: pcsOf(2, HARM_MINOR) },
        { r: 9, tones: [0, 4, 7, 10], sc: pcsOf(2, HARM_MINOR) },
      ]
    : [
        { r: 0, tones: [0, 4, 7], sc: pcsOf(0, MAJOR) },
        { r: 0, tones: [0, 4, 7], sc: pcsOf(0, MAJOR) },
        { r: 9, tones: [0, 4, 7, 10], sc: pcsOf(9, MIXO) },
        { r: 9, tones: [0, 4, 7, 10], sc: pcsOf(9, MIXO) },
        { r: 2, tones: [0, 4, 7, 10], sc: pcsOf(2, MIXO) },
        { r: 7, tones: [0, 4, 7, 10], sc: pcsOf(7, MIXO) },
        { r: 0, tones: [0, 4, 7], sc: pcsOf(0, MAJOR) },
        { r: 7, tones: [0, 4, 7, 10], sc: pcsOf(7, MIXO) },
      ];
  const lo = lockdown ? 62 : 67;
  const hi = lockdown ? 86 : 91;
  const w = new Walker(lockdown ? 74 : 79);
  let bar = 0;
  return (t0) => {
    const ev: NoteEv[] = [];
    const c = prog[bar % prog.length];
    const ct = c.tones.map((x) => pc(c.r + x));
    if (lockdown) {
      const low = fit(c.r, 33, 44);
      for (let k = 0; k < 8; k++) {
        const acc = k % 2 === 0;
        ev.push(N(t0 + k * 2 * sx, low, acc ? 0.55 : 0.42, sx * 1.4), N(t0 + k * 2 * sx, low + 12, acc ? 0.4 : 0.3, sx * 1.4));
      }
      if (bar % 2 === 0) {
        for (const x of c.tones) ev.push(N(t0, fit(c.r + x, 74, 86), 0.4, sx * 2));
      }
    } else {
      const bassN = fit(c.r, 36, 47);
      ev.push(N(t0, bassN, 0.55, sx * 1.6), N(t0, bassN - 12 >= 28 ? bassN - 12 : bassN + 12, 0.32, sx * 1.6));
      const ch = c.tones.slice(1).map((x) => fit(c.r + x, 52, 66));
      for (const st of [4, 12]) for (const m of ch) ev.push(N(t0 + st * sx, m, 0.34, sx * 1.3));
      ev.push(N(t0 + 8 * sx, fit(c.r + 7, 36, 47), 0.5, sx * 1.6));
    }
    if (!lockdown && chance(0.12)) {
      let m = snapTo(lo + 2, c.sc);
      for (let k = 0; k < 16 && m <= hi; k++) {
        ev.push(N(t0 + k * sx, m, 0.36 + k * 0.015, sx * 0.9));
        m = stepIn(m, c.sc, 1);
      }
      w.m = fit(m, lo, hi);
    } else {
      const density = lockdown ? 0.72 : 0.92;
      for (const half of [0, 8]) {
        if (chance(density)) figure(ev, t0 + half * sx, sx, w, c.sc, ct, lo, hi);
      }
    }
    bar++;
    return { ev, len: 16 * sx };
  };
}

/** 'blackout': sparse low notes + eerie whole-tone tinkles. */
function blackoutPlan(): Plan {
  const b = 60 / 54;
  const lows = [36, 38, 40, 42, 44, 46];
  return (t0) => {
    const ev: NoteEv[] = [];
    const len = b * 8;
    if (chance(0.75)) {
      const m = pick(lows);
      ev.push(N(t0 + hz(), m, 0.34, b * 5), N(t0 + 0.012, m - 12, 0.26, b * 5));
      if (chance(0.3)) ev.push(N(t0 + b * 4, m + 6, 0.22, b * 3.5));
    }
    const tk = pick([0, 1, 1, 2, 2, 3, 4]);
    for (let k = 0; k < tk; k++) {
      const at = rand(0.5, 7.2) * b;
      let m = 80 + pick(WHOLE) + (chance(0.35) ? 12 : 0);
      ev.push(N(t0 + at, m, rand(0.25, 0.45), 1.4, 'bell'));
      if (chance(0.3)) {
        for (let j = 1; j < 3; j++) {
          m -= 2;
          ev.push(N(t0 + at + j * 0.09, m, 0.22, 1.2, 'bell'));
        }
      }
    }
    return { ev, len };
  };
}

/** 'victory': cheerful flourish, then bright calm noodling. */
function victoryPlan(): Plan {
  let first = true;
  const calm = calmPlan(60, 1.5, 76);
  return (t0) => {
    if (!first) return calm(t0);
    first = false;
    const ev: NoteEv[] = [];
    const sx = 0.095;
    const up = [60, 64, 67, 72, 76, 79, 84];
    up.forEach((m, k) => ev.push(N(t0 + k * sx, m, 0.45 + k * 0.04, sx * 1.5)));
    const tc = t0 + up.length * sx + 0.05;
    [36, 43, 52, 59, 62].forEach((m, j) => ev.push(N(tc + j * 0.035, m, 0.48, 2.6)));
    ev.push(N(tc + 0.18, 88, 0.55, 2.4), N(tc + 0.18, 79, 0.4, 2.4));
    [84, 88, 91, 96].forEach((m, k) => ev.push(N(tc + 0.55 + k * 0.08, m, 0.35, 1, 'bell')));
    return { ev, len: tc - t0 + 3.4 };
  };
}

/** 'fail': short sad descending phrase, then silence. */
function failPlan(): Plan {
  let first = true;
  return (t0) => {
    if (!first) return { ev: [], len: 4 };
    first = false;
    const ev: NoteEv[] = [];
    const line: ReadonlyArray<readonly [number, number]> = [
      [0, 68],
      [0.45, 67],
      [0.95, 65],
      [1.55, 63],
    ];
    line.forEach(([at, m], k) => ev.push(N(t0 + at, m, 0.42 - k * 0.03, k === 3 ? 2.8 : 0.45)));
    [41, 48, 56].forEach((m, j) => ev.push(N(t0 + j * 0.03, m, 0.28, 1.4)));
    [36, 43, 51, 62].forEach((m, j) => ev.push(N(t0 + 1.55 + j * 0.06, m, 0.3, 3)));
    return { ev, len: 6 };
  };
}

// ---------------------------------------------------------------------------------------------
// Diegetic party pianist: jazzy / impressionist improvisation, infinite and non-repeating.
// ---------------------------------------------------------------------------------------------
type Q = 'maj7' | 'lyd' | 'm7' | 'dom7' | 'alt';
const QUAL: Record<Q, { tones: readonly number[]; ext: readonly number[]; scale: readonly number[] }> = {
  maj7: { tones: [0, 4, 7, 11], ext: [14, 21], scale: [0, 2, 4, 7, 9, 11] },
  lyd: { tones: [0, 4, 7, 11], ext: [14, 18], scale: [0, 2, 4, 6, 7, 9, 11] },
  m7: { tones: [0, 3, 7, 10], ext: [14, 17], scale: [0, 2, 3, 5, 7, 9, 10] },
  dom7: { tones: [0, 4, 7, 10], ext: [14, 21], scale: [0, 2, 4, 7, 9, 10] },
  alt: { tones: [0, 4, 10], ext: [13, 15, 20], scale: [0, 1, 3, 4, 6, 8, 10] },
};
const SEQS: ReadonlyArray<ReadonlyArray<readonly [number, Q]>> = [
  [[2, 'm7'], [7, 'dom7'], [0, 'maj7'], [9, 'alt']],
  [[2, 'm7'], [7, 'alt'], [0, 'maj7'], [0, 'maj7']],
  [[0, 'lyd'], [2, 'lyd'], [4, 'lyd'], [2, 'lyd']],
  [[5, 'maj7'], [4, 'm7'], [2, 'm7'], [1, 'dom7']],
  [[0, 'maj7'], [8, 'lyd'], [0, 'maj7'], [10, 'dom7']],
  [[9, 'm7'], [2, 'dom7'], [7, 'm7'], [0, 'dom7']],
  [[5, 'lyd'], [5, 'lyd'], [0, 'maj7'], [0, 'maj7']],
];
const KEYS = [0, 5, 7, 3, 8, 10, 2];

export function pianistPlan(): Plan {
  const b = 60 / 84;
  const sw = (b * 2) / 3;
  let seq = pick(SEQS);
  let si = 0;
  let key = pick(KEYS);
  const w = new Walker(74);
  return (t0) => {
    if (si >= seq.length) {
      seq = pick(SEQS);
      si = 0;
      if (chance(0.4)) key = (key + pick([5, 7, 2, 10])) % 12;
    }
    const [ro, q] = seq[si++];
    const qd = QUAL[q];
    const root = (key + ro) % 12;
    const ct = qd.tones.map((x) => pc(root + x));
    const sc = qd.scale.map((x) => pc(root + x));
    const ev: NoteEv[] = [];
    const bb = b * rand(0.98, 1.03);
    const len = bb * 4;
    const bassN = fit(root, 36, 47);
    const shell = [qd.tones[1], qd.tones[qd.tones.length - 1], qd.ext[0]].map((x) => fit(root + x, 50, 65)).sort((x, y) => x - y);
    const lh = Math.random();
    if (lh < 0.55) {
      ev.push(N(t0, bassN, 0.34, bb * 3.6));
      shell.forEach((m, j) => ev.push(N(t0 + 0.04 * (j + 1) + hz(), m, 0.23, bb * 3.4)));
    } else if (lh < 0.8) {
      ev.push(N(t0, bassN, 0.34, bb * 0.9));
      shell.forEach((m) => ev.push(N(t0 + bb + hz(), m, 0.22, bb * 0.6)));
      ev.push(N(t0 + 2 * bb, fit(root + 7, 36, 47), 0.3, bb * 0.9));
      shell.forEach((m) => ev.push(N(t0 + 3 * bb + hz(), m, 0.22, bb * 0.6)));
    } else {
      ev.push(N(t0, bassN, 0.32, bb * 1.4));
      shell.forEach((m) => ev.push(N(t0 + hz(), m, 0.24, bb * 1.2)));
      shell.forEach((m) => ev.push(N(t0 + bb + sw + hz(), m, 0.26, bb * 1.5)));
    }
    const r = Math.random();
    if (r < 0.55) {
      for (let beat = 0; beat < 4; beat++) {
        for (const off of [0, 1]) {
          if (!chance(off ? 0.45 : 0.62)) continue;
          let m = w.move(sc, 65, 88, 2, 0.15);
          if (!off && chance(0.6)) {
            m = snapTo(m, ct);
            w.m = m;
          }
          const t = t0 + beat * bb + (off ? sw : 0) + hz();
          ev.push(N(t, m, rand(0.3, 0.45) + (off ? 0.04 : 0), off ? (bb / 3) * 1.6 : bb * 0.8));
          if (chance(0.1)) ev.push(N(t, fit(stepIn(m, ct, -1), 55, m - 2), 0.25, bb * 0.8));
        }
      }
    } else if (r < 0.7) {
      const cnt = randi(9, 13);
      let m = fit(snapTo(randi(84, 92), sc), 80, 94);
      const st = t0 + bb * pick([1, 2]);
      const useCt = chance(0.5);
      for (let k = 0; k < cnt; k++) {
        ev.push(N(st + (k * bb) / 6, m, 0.36 - k * 0.012, bb / 4));
        m = stepIn(m, useCt ? ct : sc, -1);
      }
      w.m = fit(m, 65, 88);
    } else if (r < 0.85) {
      for (const at of [0, 1.5, 3]) {
        const m = snapTo(w.move(sc, 70, 86), ct);
        w.m = m;
        const u1 = stepIn(m, ct, -1);
        const u2 = stepIn(u1, ct, -1);
        for (const x of [m, u1, u2]) ev.push(N(t0 + at * bb + hz(), x, x === m ? 0.34 : 0.26, bb * 1.1));
      }
    } else if (chance(0.5)) {
      const m = snapTo(w.move(sc, 72, 86), ct);
      ev.push(N(t0 + bb, m, 0.36, bb * 2));
    }
    return { ev, len };
  };
}

// ---------------------------------------------------------------------------------------------
// Jukebox: cheesy swing boogie (12-bar blues in C): walking boogie bass, drums, stabs, blues riffs.
// ---------------------------------------------------------------------------------------------
export function jukeboxPlan(): Plan {
  const b = 60 / 150;
  const sw = b * 0.64;
  const bars = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];
  const blues = pcsOf(0, [0, 3, 5, 6, 7, 10]);
  const boog = [0, 4, 7, 9, 10, 9, 7, 4];
  const w = new Walker(72);
  let bar = 0;
  let riff: Array<readonly [number, number, number]> = [];
  return (t0) => {
    const ev: NoteEv[] = [];
    const ro = bars[bar % bars.length];
    const root = 36 + ro;
    const slot = (k: number): number => t0 + Math.floor(k / 2) * b + (k % 2 ? sw : 0);
    for (let k = 0; k < 8; k++) ev.push(N(slot(k), root + boog[k], k % 2 ? 0.5 : 0.62, b * 0.42, 'bass'));
    for (let k = 0; k < 8; k++) ev.push(N(slot(k), 0, k % 2 ? 0.45 : 0.7, 0.05, 'hat'));
    ev.push(N(t0, 0, 0.9, 0.2, 'kick'), N(t0 + 2 * b, 0, 0.8, 0.2, 'kick'));
    ev.push(N(t0 + b, 0, 0.7, 0.15, 'snare'), N(t0 + 3 * b, 0, 0.75, 0.15, 'snare'));
    const ch = [4, 10, 14].map((x) => fit(root + 12 + x, 58, 72));
    for (const k of [3, 7]) for (const m of ch) ev.push(N(slot(k), m, 0.4, b * 0.3, 'stab'));
    const g = bar % 4;
    if (g === 0) {
      riff = [];
      let k = pick([0, 1]);
      while (k < 8) {
        const m = w.move(blues, 67, 84, 2, 0.1);
        const l = pick([1, 1, 2, 2, 3]);
        riff.push([k, m, l]);
        k += l + (chance(0.3) ? 1 : 0);
      }
    }
    if (g === 0 || g === 2) {
      for (const [k, m, l] of riff) ev.push(N(slot(k), m, 0.42, l * b * 0.45, 'lead'));
    } else if (chance(0.6)) {
      const m = w.move(blues, 67, 84);
      ev.push(N(slot(1), m, 0.38, b * 0.4, 'lead'), N(slot(2), stepIn(m, blues, -1), 0.38, b * 0.8, 'lead'));
    }
    bar++;
    return { ev, len: 4 * b };
  };
}

export function makePlan(state: MusicState): Plan | null {
  switch (state) {
    case 'title':
      return titlePlan();
    case 'calm':
      return calmPlan();
    case 'sneak':
      return sneakPlan();
    case 'tension':
      return tensionPlan();
    case 'chase':
      return runsPlan(false);
    case 'blackout':
      return blackoutPlan();
    case 'lockdown':
      return runsPlan(true);
    case 'victory':
      return victoryPlan();
    case 'fail':
      return failPlan();
    default:
      return null;
  }
}

const LEVEL: Record<MusicState, number> = {
  off: 0,
  title: 0.9,
  calm: 1.0,
  sneak: 0.85,
  tension: 0.9,
  chase: 0.95,
  blackout: 0.9,
  lockdown: 0.95,
  victory: 0.95,
  fail: 0.95,
};
const FADE_IN: Record<MusicState, number> = {
  off: 0,
  title: 1.5,
  calm: 1.8,
  sneak: 1.2,
  tension: 1.2,
  chase: 1.0,
  blackout: 1.5,
  lockdown: 1.0,
  victory: 0.15,
  fail: 0.15,
};

interface Layer {
  g: GainNode;
  perf: Performer;
}

/** Adaptive score: one gain layer per active state, crossfaded on state change. */
export class MusicEngine {
  private state: MusicState = 'off';
  private layer: Layer | null = null;
  private dying: Array<{ g: GainNode; at: number }> = [];
  private readonly ctx: BaseAudioContext;
  private readonly bus: AudioNode;
  private readonly noiseBuf: AudioBuffer;

  constructor(ctx: BaseAudioContext, bus: AudioNode, noiseBuf: AudioBuffer) {
    this.ctx = ctx;
    this.bus = bus;
    this.noiseBuf = noiseBuf;
  }

  get current(): MusicState {
    return this.state;
  }

  set(state: MusicState): void {
    if (state === this.state) return;
    this.state = state;
    const now = this.ctx.currentTime;
    const old = this.layer;
    if (old) {
      const p = old.g.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(0, now, 0.45);
      this.dying.push({ g: old.g, at: now + 4 });
    }
    this.layer = null;
    const plan = makePlan(state);
    if (!plan) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(LEVEL[state], now + FADE_IN[state]);
    g.connect(this.bus);
    this.layer = { g, perf: new Performer(plan, now + 0.08) };
  }

  pump(now: number, horizon: number): void {
    const L = this.layer;
    if (L) {
      L.perf.pump(now, horizon, (e) => {
        if ((e.i ?? 'piano') === 'piano' && e.pan === undefined) e.pan = clamp((e.m - 64) / 50, -0.4, 0.4);
        renderEvent(this.ctx, L.g, this.noiseBuf, e);
      });
    }
    if (this.dying.length) {
      for (let i = this.dying.length - 1; i >= 0; i--) {
        const d = this.dying[i];
        if (d.at <= now) {
          try {
            d.g.disconnect();
          } catch {
            /* ignore */
          }
          this.dying.splice(i, 1);
        }
      }
    }
  }
}
