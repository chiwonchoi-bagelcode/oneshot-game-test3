// Trailer "actor": drives the real player through the real simulation with the same inputs a
// person would use (move vector, crouch, run, E on a chosen option). Written as generators so a
// script can run live on camera (one yield = one simulation step) or be fast-forwarded off camera.
import { dist, type V2 } from '../../src/core/math';
import { seeQuality } from '../../src/sim/npc/perception';
import type { World } from '../../src/sim/World';

export type Script = Generator<void, boolean | void, unknown>;

export interface Actor {
  w: World;
  log: string[];
}

export function unseen(w: World, margin = 0): boolean {
  const p = w.player;
  for (const n of w.npcs) {
    if (!n.awake || !n.active) continue;
    if (seeQuality(w, n, p.pos) > 0) return false;
    if (margin > 0 && dist(n.pos, p.pos) < margin && w.grid.los(n.pos, p.pos)) return false;
  }
  if (w.security.operatorWatching(w) && w.security.cams.some((c) => c.seeing)) return false;
  return !p.chasers.size;
}

export function* wait(w: World, sec: number): Script {
  const end = w.time + sec;
  w.player.input = { x: 0, z: 0 };
  while (w.time < end) yield;
  return true;
}

export function* waitUntil(w: World, cond: () => boolean, maxSec = 600): Script {
  const end = w.time + maxSec;
  w.player.input = { x: 0, z: 0 };
  while (w.time < end) {
    if (cond()) return true;
    yield;
  }
  return false;
}

export interface WalkOpts {
  crouch?: boolean;
  run?: boolean;
  maxSec?: number;
  /** Stop this far from the target. */
  near?: number;
  /** Slow the walk down (0..1 of full input), for nonchalant strolls. */
  pace?: number;
}

export function* walkTo(w: World, target: V2, o: WalkOpts = {}): Script {
  const p = w.player;
  p.crouching = !!o.crouch;
  p.run = !!o.run;
  const agent = () => ({ opens: true, keys: p.keys(), crawl: !!o.crouch });
  let path = w.grid.findPath(p.pos, target, agent());
  if (!path) return false;
  let i = 0;
  const end = w.time + (o.maxSec ?? 90);
  let stuckT = 0;
  let last = { ...p.pos };
  const near = o.near ?? 0.3;
  const pace = o.pace ?? 1;
  while (w.time < end) {
    if (dist(p.pos, target) < near) {
      p.input = { x: 0, z: 0 };
      p.run = false;
      return true;
    }
    while (i < path.length - 1 && dist(p.pos, path[i]) < 0.35) i++;
    const wp = path[i];
    const l = Math.hypot(wp.x - p.pos.x, wp.z - p.pos.z) || 1;
    // Ease into the final stop so the character doesn't overshoot on camera.
    const left = dist(p.pos, target);
    const k = pace * (i === path.length - 1 ? Math.min(1, 0.35 + left * 0.9) : 1);
    p.input = { x: ((wp.x - p.pos.x) / l) * k, z: ((wp.z - p.pos.z) / l) * k };
    yield;
    stuckT += 1 / 60;
    if (stuckT > 1.5) {
      if (dist(last, p.pos) < 0.25) {
        const np = w.grid.findPath(p.pos, target, agent());
        if (np) {
          path = np;
          i = 0;
        }
      }
      last = { ...p.pos };
      stuckT = 0;
    }
  }
  p.input = { x: 0, z: 0 };
  p.run = false;
  return false;
}

/** Turn on the spot to face an angle (the game turns the player towards the move input). */
export function* face(w: World, angle: number, sec = 0.25): Script {
  const p = w.player;
  p.input = { x: Math.sin(angle) * 0.05, z: Math.cos(angle) * 0.05 };
  const end = w.time + sec;
  while (w.time < end) yield;
  p.input = { x: 0, z: 0 };
  p.facing = angle;
  return true;
}

/** Pick an option by action id (and optionally target/item) and press E; wait for it to finish. */
export function* act(w: World, actionId: string, targetId?: string, o: { needUnseen?: boolean; maxWait?: number } = {}): Script {
  const find = () =>
    w.options.findIndex(
      (op) => op.action.id === actionId && !op.action.disabled && (!targetId || op.target?.id === targetId || op.item?.type === targetId),
    );
  if (o.needUnseen) {
    const ok = yield* waitUntil(w, () => unseen(w, 1.5), o.maxWait ?? 120);
    if (!ok) return false;
  }
  // Options refresh during the world update.
  let i = find();
  for (let k = 0; k < 4 && i < 0; k++) {
    yield;
    i = find();
  }
  if (i < 0) {
    console.warn(`[actor] no option ${actionId}/${targetId}: ${w.options.map((op) => op.action.id + ':' + (op.target?.id ?? op.item?.type) + (op.action.disabled ? '(x ' + op.action.disabled + ')' : '')).join(', ')}`);
    return false;
  }
  w.optionIdx = i;
  w.activateOption();
  while (w.player.action) yield;
  return true;
}

/** Run a script to completion synchronously (off camera). */
export function fastForward(w: World, s: Script, dt = 1 / 30, maxSec = 1200): boolean | void {
  const end = w.time + maxSec;
  let r = s.next();
  while (!r.done && w.time < end) {
    w.update(dt);
    r = s.next();
  }
  return r.done ? r.value : false;
}

/** Simulate until a condition holds (off camera). Returns the time it happened, or -1. */
export function runUntil(w: World, cond: () => boolean, maxSec = 1200, dt = 1 / 30): number {
  const end = w.time + maxSec;
  while (w.time < end) {
    if (cond()) return w.time;
    w.update(dt);
  }
  return -1;
}

export function teleport(w: World, pos: V2, facing?: number) {
  const p = w.player;
  p.pos.x = pos.x;
  p.pos.z = pos.z;
  p.vel = { x: 0, z: 0 };
  if (facing !== undefined) p.facing = facing;
  w.stats; // keep the reference alive for bundlers
}

/** Off-camera time jump (only meaningful inside a live shot script: the engine simulates it silently). */
export function* skip(sec: number): Script {
  yield { skip: sec } as unknown as void;
  return true;
}
