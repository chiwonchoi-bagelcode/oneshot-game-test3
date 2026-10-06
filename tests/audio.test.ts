// Music continuity: the score never leaves long dead air, and the adaptive state doesn't flicker
// (every switch restarts the score from a fade-in, which is heard as the music cutting out).
import { describe, expect, it } from 'vitest';
import type { MusicState } from '../src/audio/Audio';
import { MusicMood } from '../src/audio/mood';
import { makePlan } from '../src/audio/music';
import { wantedMusic } from '../src/app/musicRule';
import { World } from '../src/sim/World';

/** Rough audible span of a synth piano note (see synth.piano: two-stage decay, ~-26 dB after 3 tau). */
const span = (m: number, v: number, d: number) => {
  const low = Math.max(0, Math.min(1, (88 - m) / 52));
  const tau = 0.16 + low * low * 1.7 + v * 0.15;
  return Math.min(Math.max(d, 0.04) + 0.2, 0.12 + 3 * tau);
};

/** Longest stretch with no note sounding, over `seconds` of generated score. */
function longestSilence(state: MusicState, seconds: number): number {
  const plan = makePlan(state)!;
  const iv: [number, number][] = [];
  let t = 0;
  while (t < seconds) {
    const ph = plan(t);
    for (const e of ph.ev) iv.push([e.t, e.t + span(e.m, e.v, e.d)]);
    t += ph.len;
  }
  iv.sort((a, b) => a[0] - b[0]);
  let end = 0;
  let worst = 0;
  for (const [s, e] of iv) {
    if (s < seconds) worst = Math.max(worst, s - end);
    end = Math.max(end, e);
  }
  return worst;
}

describe('music', () => {
  it('no score leaves more than ~1.5 s of silence (calm and blackout used to rest for 20+ s)', () => {
    for (const st of ['title', 'calm', 'sneak', 'tension', 'blackout', 'chase', 'lockdown', 'victory', 'fail'] as MusicState[]) {
      let worst = 0;
      for (let run = 0; run < 10; run++) worst = Math.max(worst, longestSilence(st, 120));
      expect(worst, `${st}: ${worst.toFixed(1)} s of silence`).toBeLessThan(1.5);
    }
  });

  it('mood smoothing: flicker does not restart the score, danger still cuts in at once', () => {
    const m = new MusicMood();
    m.force('calm');
    const dt = 1 / 60;
    const feed = (s: MusicState, sec: number) => {
      for (let t = 0; t < sec; t += dt) m.update(s, dt);
      return m.current;
    };
    // A glance for a few frames: no change.
    expect(feed('sneak', 0.2)).toBe('calm');
    expect(feed('calm', 1)).toBe('calm');
    // Sneaking for real.
    expect(feed('sneak', 0.5)).toBe('sneak');
    // Flickering between sneak and tension: tension holds instead of bouncing back.
    let switches = 0;
    let cur = m.current;
    for (let i = 0; i < 40; i++) {
      for (const s of ['tension', 'sneak'] as MusicState[]) {
        feed(s, 0.5);
        if (m.current !== cur) switches++;
        cur = m.current;
      }
    }
    expect(switches).toBe(1);
    expect(m.current).toBe('tension');
    // A chase starts immediately.
    m.update('chase', dt);
    expect(m.current).toBe('chase');
    // Calming down needs a few quiet seconds.
    expect(feed('calm', 2)).toBe('chase');
    expect(feed('calm', 2.5)).toBe('calm');
  });

  it('in play, a tense stretch in the kitchen does not flip the music back and forth', () => {
    const w = new World(5);
    w.player.legit = true;
    w.player.pos = w.grid.roomCells('kitchen')[5];
    const mood = new MusicMood();
    mood.force('calm');
    const cells = w.grid.roomCells('kitchen');
    let target = cells[0];
    let since = 0;
    let quickDowns = 0;
    let switches = 0;
    let cur = mood.current;
    const rank: Partial<Record<MusicState, number>> = { calm: 0, sneak: 1, blackout: 1, tension: 2, lockdown: 3, chase: 4 };
    for (let t = 0; t < 60; t += 1 / 60) {
      if (Math.hypot(w.player.pos.x - target.x, w.player.pos.z - target.z) < 0.6 || w.rng.next() < 0.004) target = cells[Math.floor(w.rng.next() * cells.length)];
      const dx = target.x - w.player.pos.x;
      const dz = target.z - w.player.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      w.player.input = { x: dx / l, z: dz / l };
      w.update(1 / 60);
      since += 1 / 60;
      const m = mood.update(wantedMusic(w), 1 / 60);
      if (m !== cur) {
        switches++;
        // Going *down* soon after a switch is the audible flicker we don't want.
        if ((rank[m] ?? 0) < (rank[cur] ?? 0) && since < 3) quickDowns++;
        cur = m;
        since = 0;
      }
    }
    expect(quickDowns).toBe(0);
    expect(switches).toBeLessThanOrEqual(6);
  });
});
