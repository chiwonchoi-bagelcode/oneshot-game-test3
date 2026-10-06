// The trailer's shot list. Every shot is a fresh, seeded run of the real game simulation:
// `setup` fast-forwards it off camera to the right moment, `script` drives the player live with
// ordinary inputs, `frame` places the camera. Cuts follow docs/CUESHEET.md.
import * as THREE from 'three';
import type { V2 } from '../../src/core/math';
import { dist } from '../../src/core/math';
import type { World } from '../../src/sim/World';
import { act, face, fastForward, runUntil, skip, teleport, wait, waitUntil, walkTo, type Script } from './bot';
import { at, drift, ease, Follow, keyed, lerp, orb, orbitToCam, remap, v3 } from './cam';
import type { Shot, ShotCtx, ShotFrame } from './engine';

export const DURATION = 97;
const SEED = 7;
const N = Math.PI;
const E = Math.PI / 2;
const Wd = -Math.PI / 2;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const P = (x: number, z: number): V2 => ({ x, z });
const pre = (w: World, t: number) => runUntil(w, () => w.time >= t, 2000);
const run = (w: World, s: Script) => fastForward(w, s);

/** Start an action off camera and fast-forward until `left` seconds of it remain. */
function* actUntilLeft(w: World, id: string, target: string | undefined, left: number): Script {
  const find = () => w.options.findIndex((o) => o.action.id === id && !o.action.disabled && (!target || o.target?.id === target || o.item?.type === target));
  let i = find();
  for (let k = 0; k < 4 && i < 0; k++) {
    yield;
    i = find();
  }
  if (i < 0) {
    console.warn('[setup] missing option', id, target, w.options.map((o) => o.action.id + ':' + (o.target?.id ?? o.item?.type)).join(','));
    return false;
  }
  w.optionIdx = i;
  w.activateOption();
  while (w.player.action && w.player.action.dur - w.player.action.t > left) yield;
  return true;
}

function cam(o: ReturnType<typeof orb>, extra: Partial<ShotFrame> = {}): ShotFrame {
  return { cam: orbitToCam(o), ...extra };
}

/** Orbit around a moving subject with damping. */
function followCam(c: ShotCtx, key: string, subject: V2, y: number, yaw: number, pitch: number, d: number, fov: number, k = 3): ReturnType<typeof orb> {
  let f = c.s[key] as Follow | undefined;
  if (!f) c.s[key] = f = new Follow(k);
  const p = f.update(v3(subject.x, y, subject.z), c.dt);
  return orb(p.x, p.y, p.z, yaw, pitch, d, fov);
}

const npcPos = (w: World, id: string) => w.npc(id)!.pos;

/** Common staging for the second half: the fake duck is already on display and the real one sits in a gift box. */
function stageSwapDone(w: World) {
  const op = w.npc('operator')!;
  pre(w, 270);
  runUntil(w, () => dist(op.pos, w.station('st_coffee').pos) < 2, 60);
  w.givePlayer('fake_duck');
  teleport(w, P(37.6, 19.0), Wd);
  run(w, act(w, 'swap', 'case'));
  const box = w.items.find((i) => i.type === 'gift_box' && i.state === 'ground')!;
  w.putHeldInto(box);
}

const PARTY_POST = { tilt: 5.5, tiltCenter: 0.46, tiltWidth: 0.2, bloom: 0.35, warmth: 0.25 };
const NIGHT_POST = { tilt: 4, tiltCenter: 0.5, tiltWidth: 0.22, bloom: 0.45, warmth: -0.1 };
const CLOSE_POST = { tilt: 9, tiltCenter: 0.5, tiltWidth: 0.12, bloom: 0.4, warmth: 0.15 };

// ---------------------------------------------------------------------------------------------
// Act A — the elegant party (0.0 – 14.1)
// ---------------------------------------------------------------------------------------------
const A1: Shot = {
  id: 'A1_exterior',
  start: 0,
  end: 4.6,
  seed: SEED,
  setup(w) {
    w.player.gone = true;
    pre(w, 50);
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0.7 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36, 0.5, 47.5, 0, 34, 40, 28)],
        [4.6, orb(36, 0.6, 41.5, 4, 40, 25, 30), ease.inOut],
      ],
      c.lt,
    );
    // Facade intact at first; as we push in the doll's house opens up.
    const fz = c.lt < 3.0 ? 80 : 45.5;
    return cam(o, { focus: P(36, fz), focusRoom: 'foyer', post: { ...NIGHT_POST, tilt: 5, black: 1 - remap(c.lt, 0.15, 1.2) }, listener: P(36, 50) });
  },
};

const A2: Shot = {
  id: 'A2_ballroom',
  start: 4.6,
  end: 6.6,
  seed: SEED,
  setup(w) {
    w.player.gone = true;
    pre(w, 161.4);
  },
  bubbles: { allow: ['g_young', 'late_guest', 'g_rose', 'host', 'g_countess'], icons: false, minDur: 2 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(32.5, 0.8, 31.2, 16, 30, 12.5, 30)],
        [2, orb(35.5, 0.8, 30.6, 2, 29, 11.5, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(34, 30.5), focusRoom: 'ballroom', post: PARTY_POST, listener: P(33, 31) });
  },
};

const A3: Shot = {
  id: 'A3_speech',
  start: 6.6,
  end: 9.6,
  seed: SEED,
  setup(w) {
    w.player.gone = true;
    pre(w, 176.3);
  },
  bubbles: { allow: ['host'], icons: false, minDur: 3.2 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36.5, 1.55, 26.4, -7, 16, 7.0, 30)],
        [3, orb(36.5, 1.6, 26.3, -3, 14, 5.3, 30), ease.out],
      ],
      c.lt,
    );
    return cam(o, { focus: P(36.5, 27.5), focusRoom: 'ballroom', post: { ...PARTY_POST, tiltCenter: 0.55 }, listener: P(36.5, 29) });
  },
};

const A4: Shot = {
  id: 'A4_duck',
  start: 9.6,
  end: 14.1,
  seed: SEED,
  setup(w) {
    w.player.gone = true;
    pre(w, 101);
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0, footsteps: 0.4 },
  each(c) {
    const s = c.s as { sp?: number[] };
    s.sp ??= [0.25, 1.6, 3.0, 3.5];
    while (s.sp.length && c.lt >= s.sp[0]) {
      s.sp.shift();
      c.w.events.emit('fx', { kind: 'sparkle', x: 36, z: 18, y: 1.35 });
    }
  },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36, 0.9, 19.0, -8, 44, 15, 30)],
        [3.0, orb(36, 1.22, 18.0, -2, 20, 3.4, 26), ease.inOut5],
        [4.5, orb(36, 1.22, 18.0, 2, 18, 2.9, 25), ease.linear],
      ],
      c.lt,
    );
    const close = remap(c.lt, 1.8, 3.0);
    return cam(o, {
      focus: P(36, 19.5),
      focusRoom: 'gallery',
      post: { tilt: lerp(3, 12, close), tiltWidth: lerp(0.2, 0.08, close), tiltCenter: 0.5, bloom: lerp(0.35, 0.75, close), warmth: 0.35, vignette: 0.5 },
      listener: P(36, 19),
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Act B — the uninvited (14.1 – 22.1)
// ---------------------------------------------------------------------------------------------
const B1: Shot = {
  id: 'B1_gate',
  start: 14.1,
  end: 16.1,
  seed: SEED,
  setup(w, s) {
    pre(w, 30);
    run(w, walkTo(w, P(37, 60.4)));
    // Step up to the gate; stop just before the doorman reacts.
    const sc = (function* () {
      yield* walkTo(w, P(37, 58.6));
    })();
    s.walk = sc;
    runUntil(w, () => {
      const r = sc.next();
      return !!r.done || w.time >= 38.1;
    }, 30, 1 / 60);
  },
  script(w, c) {
    const walk = c.s.walk as Script;
    return (function* () {
      let r = walk.next();
      while (!r.done) {
        yield;
        r = walk.next();
      }
      while (c.lt < 1.45) yield;
      // Turn round to the camera, caught out.
      yield* face(w, 0, 0.3);
      yield* wait(w, 3);
    })();
  },
  bubbles: { allow: ['doorman', 'player'], icons: true, iconAllow: ['doorman'], minDur: 1.6 },
  ambience: { crowd: 0.4 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36.8, 1.1, 58.5, 0, 12, 6.2, 30)],
        [2, orb(36.8, 1.1, 58.5, 0, 11, 5.4, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(36.8, 70), post: { ...NIGHT_POST, tilt: 3 }, listener: P(37, 59) });
  },
};

const B2: Shot = {
  id: 'B2_gap',
  start: 16.1,
  end: 20.1,
  seed: SEED,
  setup(w) {
    pre(w, 30);
    teleport(w, P(66.4, 61.6), N);
    run(w, walkTo(w, P(68.5, 60.9)));
    w.player.facing = N;
  },
  script(w) {
    return (function* () {
      yield* wait(w, 0.35);
      yield* walkTo(w, P(68.5, 57.6), { crouch: true });
      w.player.crouching = false;
      yield* wait(w, 0.25);
      yield* walkTo(w, P(67.6, 57.55), { crouch: true });
      yield* act(w, 'hide', 'hide:h_bush_gap');
      yield* wait(w, 3);
    })();
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(68.3, 0.4, 59.0, -6, 40, 8.6, 32)],
        [4, orb(68.0, 0.4, 57.8, -10, 46, 8.2, 32), ease.inOut],
      ],
      c.lt,
    );
    return cam(o, { focus: P(68, 66), hemiBoost: 0.25, post: { ...NIGHT_POST, tilt: 6, tiltWidth: 0.15 }, listener: P(68.5, 59) });
  },
};

const B3: Shot = {
  id: 'B3_todo',
  start: 20.1,
  end: 22.1,
  seed: SEED,
  setup(w) {
    w.player.gone = true;
    pre(w, 70);
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0.3, footsteps: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36, 0, 28, -10, 62, 52, 30)],
        [2, orb(36, 0, 28, -4, 64, 48, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(36, 80), post: { tilt: 14, tiltWidth: 0.02, bloom: 0.3, black: 0.45, saturation: 0.8 } });
  },
};

// ---------------------------------------------------------------------------------------------
// Act C — "one goal, many ways" montage (22.1 – 46.1)
// ---------------------------------------------------------------------------------------------
// C1 섞여들거나: waiter uniform from the staff lockers…
const C1a: Shot = {
  id: 'C1a_locker',
  start: 22.1,
  end: 23.6,
  seed: SEED,
  setup(w) {
    pre(w, 40);
    teleport(w, P(16.2, 24.4));
    run(w, walkTo(w, P(17.6, 23.5)));
    w.player.facing = E;
    run(w, actUntilLeft(w, 'take_waiter', 'locker_waiter', 0.35));
  },
  script(w) {
    return (function* () {
      while (w.player.action) yield;
      yield* wait(w, 0.35);
      yield* walkTo(w, P(16.4, 24.6), { pace: 0.8 });
      yield* wait(w, 2);
    })();
  },
  bubbles: { allow: [], icons: false },
  frame(c) {
    const o = keyed(
      [
        [0, orb(17.5, 1.05, 23.8, -28, 24, 4.0, 30)],
        [1.5, orb(17.3, 1.05, 23.9, -34, 24, 4.6, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(17, 24.5), focusRoom: 'staffroom', post: { ...CLOSE_POST, bloom: 0.1 }, listener: P(17.5, 23.8) });
  },
};

// …then strolling past the security chief with a silver tray.
const C1b: Shot = {
  id: 'C1b_tray',
  start: 23.6,
  end: 26.1,
  seed: SEED,
  setup(w) {
    pre(w, 50);
    w.changeOutfit('waiter', true);
    teleport(w, P(22.9, 36.0), E);
    run(w, act(w, 'pick', 'tray'));
    teleport(w, P(36.6, 32.6), E);
    pre(w, 59.2);
  },
  script(w) {
    return (function* () {
      yield* walkTo(w, P(42.6, 31.0), { pace: 0.62 });
      yield* walkTo(w, P(45, 30.4), { pace: 0.62 });
      yield* wait(w, 2);
    })();
  },
  bubbles: { allow: ['chief', 'g_rose', 'g_countess'], icons: true, iconAllow: ['chief'] },
  frame(c) {
    const p = c.w.player.pos;
    const o = followCam(c, 'f', P(p.x + 0.6, p.z - 0.4), 0.9, -12, 26, 8.5, 30, 2.5);
    return cam(o, { focus: P(p.x, p.z - 1), focusRoom: 'ballroom', post: PARTY_POST, listener: p });
  },
};

// C2 꾀어내거나: a whistle from behind the hedge, and the garden guard goes to look.
const C2: Shot = {
  id: 'C2_whistle',
  start: 26.1,
  end: 30.1,
  seed: SEED,
  setup(w) {
    pre(w, 101);
    teleport(w, P(31.0, 13.5), E);
    w.player.crouching = true;
    pre(w, 108.1);
  },
  script(w) {
    const g = w.npc('patrol_back')!;
    return (function* () {
      w.player.crouching = true;
      yield* waitUntil(w, () => g.pos.x >= 25, 3);
      yield* wait(w, 0.27);
      w.whistle();
      yield* wait(w, 0.75);
      yield* walkTo(w, P(37.4, 13.4), { crouch: true });
      yield* wait(w, 4);
    })();
  },
  bubbles: { allow: ['player', 'patrol_back'], icons: true, iconAllow: ['patrol_back'], minDur: 1.6 },
  ambience: { crowd: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(29.8, 0.6, 12.6, 198, 38, 10.5, 30)],
        [4, orb(32.0, 0.6, 12.8, 188, 40, 10.0, 30), ease.inOut],
      ],
      c.lt,
    );
    return cam(o, { focus: P(30, -20), post: { ...NIGHT_POST, tilt: 5 }, listener: P(29, 12.5) });
  },
};

// C3 불을 끄거나: main breaker → the ballroom goes dark, flashlights come on.
const C3: Shot = {
  id: 'C3_blackout',
  start: 30.1,
  end: 34.1,
  seed: SEED,
  setup(w) {
    pre(w, 59.9);
    teleport(w, P(14.5, 15.3), N);
  },
  script(w) {
    return (function* () {
      yield* act(w, 'breaker_main', 'fusebox');
      yield* wait(w, 6);
    })();
  },
  bubbles: { allow: ['g_rose', 'g_moon', 'g_lee', 'patrol_in'], icons: false, minDur: 2.4 },
  frame(c) {
    if (c.lt < 1.0) {
      const o = keyed(
        [
          [0, orb(14.5, 1.25, 14.6, 8, 18, 3.0, 30)],
          [1.0, orb(14.5, 1.25, 14.6, 4, 18, 2.6, 30), ease.linear],
        ],
        c.lt,
      );
      return cam(o, { focus: P(14.5, 15.6), focusRoom: 'elec', post: CLOSE_POST, listener: P(14.5, 15) });
    }
    const o = keyed(
      [
        [1.0, orb(38.5, 0.5, 30.2, -6, 40, 15.5, 30)],
        [4.0, orb(38.5, 0.5, 30.2, -2, 38, 13.5, 30), ease.out],
      ],
      c.lt,
    );
    return cam(o, { focus: P(38, 30), focusRoom: 'ballroom', post: { ...NIGHT_POST, tilt: 5, bloom: 0.06, exposure: 0.92 }, listener: P(38, 30) });
  },
};

// C4 재우거나: pills in the staff coffee… the security operator nods off at his monitors.
const C4: Shot = {
  id: 'C4_coffee',
  start: 34.1,
  end: 38.1,
  seed: SEED,
  setup(w) {
    pre(w, 100);
    w.givePlayer('sleeping_pills');
    teleport(w, P(13.4, 24.0), Wd);
    w.player.facing = Wd;
    run(w, actUntilLeft(w, 'spike_sleeping_pills', 'coffee', 1.15));
  },
  script(w, c) {
    return (function* () {
      while (c.lt < 1.25 - 1e-6) yield;
      // Cut: later that evening (the operator's coffee break has come and gone).
      w.player.gone = true;
      yield* skip(147.9 - w.time);
      yield* wait(w, 10);
    })();
  },
  bubbles: { allow: ['operator', 'chief'], icons: true, iconAllow: ['operator'] },
  ambience: { crowd: 0 },
  frame(c) {
    if (c.lt < 1.25) {
      const o = keyed(
        [
          [0, orb(13.0, 1.0, 23.7, 58, 24, 3.0, 30)],
          [1.25, orb(13.0, 1.0, 23.7, 64, 24, 2.7, 30), ease.linear],
        ],
        c.lt,
      );
      return cam(o, { focus: P(14, 24.5), focusRoom: 'staffroom', post: CLOSE_POST, listener: P(13.4, 23.8) });
    }
    const o = keyed(
      [
        [1.25, orb(20.9, 1.0, 16.3, 48, 30, 5.6, 30)],
        [2.3, orb(20.8, 1.0, 16.1, 52, 29, 5.0, 30), ease.inOut],
        [4.0, orb(20.6, 1.05, 15.9, 58, 26, 3.6, 30), ease.inOut],
      ],
      c.lt,
    );
    return cam(o, { focus: P(20.5, 17), focusRoom: 'security', post: CLOSE_POST, listener: P(20.5, 16) });
  },
};

// C5 급하게 만들거나: laxative in the water cooler… the gallery guard abandons his post.
const C5: Shot = {
  id: 'C5_laxative',
  start: 38.1,
  end: 42.1,
  seed: SEED,
  setup(w) {
    pre(w, 95);
    w.givePlayer('laxative');
    teleport(w, P(27.5, 23.9), N);
    run(w, actUntilLeft(w, 'spike_laxative', 'cooler', 1.0));
  },
  script(w, c) {
    return (function* () {
      while (c.lt < 1.1 - 1e-6) yield;
      w.player.gone = true;
      yield* skip(119.2 - w.time);
      yield* wait(w, 10);
    })();
  },
  bubbles: { allow: ['gallery_guard'], icons: true, iconAllow: ['gallery_guard'], minDur: 2.2 },
  ambience: { crowd: 0.5 },
  frame(c) {
    if (c.lt < 1.1) {
      const o = keyed(
        [
          [0, orb(27.5, 0.95, 23.2, 32, 26, 3.2, 30)],
          [1.1, orb(27.5, 0.95, 23.2, 38, 26, 2.9, 30), ease.linear],
        ],
        c.lt,
      );
      return cam(o, { focus: P(27.5, 23.5), focusRoom: 'galhall', post: CLOSE_POST, listener: P(27.5, 23.5) });
    }
    const g = npcPos(c.w, 'gallery_guard');
    const o = followCam(c, 'g', P(g.x, g.z), 0.9, -10, 30, 9, 30, 2.2);
    return cam(o, { focus: P(g.x, g.z - 1), post: PARTY_POST, listener: g });
  },
};

// C6 슬쩍하거나: lifting the late guest's invitation.
const C6: Shot = {
  id: 'C6_pickpocket',
  start: 42.1,
  end: 44.1,
  seed: SEED,
  setup(w) {
    pre(w, 40);
    teleport(w, P(56.4, 61.35), Wd);
    run(w, walkTo(w, P(55.5, 61.3), { pace: 0.5 }));
    w.player.facing = Wd;
  },
  script(w) {
    return (function* () {
      yield* wait(w, 0.15);
      yield* act(w, 'pick', 'npc:late_guest');
      yield* walkTo(w, P(57.5, 61.8), { crouch: true });
      yield* wait(w, 2);
    })();
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(55.1, 0.9, 61.3, 20, 16, 3.6, 30)],
        [2, orb(55.1, 0.9, 61.3, 28, 16, 3.3, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(55, 70), post: { ...NIGHT_POST, tilt: 8, tiltWidth: 0.12 }, listener: P(55, 61.3) });
  },
};

// C7 판을 키우거나: fireworks — and the whole party pours into the garden.
const C7: Shot = {
  id: 'C7_fireworks',
  start: 44.1,
  end: 46.1,
  seed: SEED,
  setup(w) {
    pre(w, 126);
    w.givePlayer('lighter');
    teleport(w, P(28, 6.2), N);
    run(w, act(w, 'light', 'fireworks'));
    // A beat later the first bursts are up.
    pre(w, w.time + 1.0);
  },
  script(w) {
    return (function* () {
      yield* walkTo(w, P(26.2, 7.6), { run: true });
      yield* wait(w, 3);
    })();
  },
  bubbles: { allow: '*', icons: false },
  ambience: { crowd: 0.6 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(28, 5.6, 3.6, 24, -16, 11.5, 56)],
        [2, orb(28, 6.0, 3.6, 18, -15, 11.0, 56), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(30, -30), fwScale: 1300, post: { tilt: 0, bloom: 0.9, warmth: 0, vignette: 0.45 }, listener: P(28, 8) });
  },
};

// ---------------------------------------------------------------------------------------------
// Act D — "…or nobody ever knows": the fake duck swap (46.1 – 64.1)
// ---------------------------------------------------------------------------------------------
const D1a: Shot = {
  id: 'D1a_rubberduck',
  start: 46.1,
  end: 48.1,
  seed: SEED,
  setup(w) {
    pre(w, 60);
    teleport(w, P(57.5, 40.4), 0);
  },
  script(w) {
    return (function* () {
      yield* wait(w, 0.55);
      yield* act(w, 'pick', 'rubber_duck');
      yield* wait(w, 2);
    })();
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(57.5, 0.6, 41.4, 158, 40, 3.4, 30)],
        [2, orb(57.5, 0.7, 41.4, 166, 38, 3.6, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(57.5, 46), focusRoom: 'bath', post: CLOSE_POST, listener: P(57.5, 41) });
  },
};

const D1b: Shot = {
  id: 'D1b_paint',
  start: 48.1,
  end: 50.1,
  seed: SEED,
  setup(w) {
    pre(w, 75);
    teleport(w, P(3.45, 5.0), Wd);
    w.setSwitch('shed', true, 'player');
  },
  script(w) {
    return (function* () {
      yield* wait(w, 0.5);
      yield* act(w, 'pick', 'gold_paint');
      yield* wait(w, 2);
    })();
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0, sfx: 1 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(2.9, 0.95, 5.0, 62, 26, 3.4, 30)],
        [2, orb(2.9, 0.95, 5.0, 70, 26, 3.1, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(4, 5.5), focusRoom: 'shed', post: CLOSE_POST, hemiBoost: 0.2, listener: P(3, 5) });
  },
};

const D2: Shot = {
  id: 'D2_painting',
  start: 50.1,
  end: 54.1,
  seed: SEED,
  setup(w) {
    pre(w, 200);
    w.givePlayer('rubber_duck');
    w.givePlayer('gold_paint');
    teleport(w, P(47.1, 21.1), Wd);
  },
  script(w) {
    return (function* () {
      yield* wait(w, 0.25);
      yield* act(w, 'paint', 'self');
      yield* wait(w, 0.2);
      yield* face(w, 0.35, 0.3);
      yield* wait(w, 3);
    })();
  },
  bubbles: { allow: ['player'], icons: false },
  ambience: { crowd: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(46.9, 0.95, 21.0, -22, 26, 3.8, 30)],
        [3.3, orb(46.9, 1.05, 21.0, -12, 22, 2.7, 28), ease.inOut],
        [4, orb(46.9, 1.08, 21.0, -10, 21, 2.55, 28), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(46, 19.5), focusRoom: 'study', post: { ...CLOSE_POST, bloom: c.lt > 3.2 ? 0.6 : 0.4 }, listener: P(47, 21) });
  },
};

/** Through the study's secret door to the case, then the swap in slow motion. */
const SWAP_START_LT = 3.83;
const D3: Shot = {
  id: 'D3_swap',
  start: 54.1,
  end: 62.1,
  seed: SEED,
  setup(w) {
    pre(w, 278.2);
    w.givePlayer('fake_duck');
    w.givePlayer('key_study');
    teleport(w, P(42.25, 17.5), Wd);
  },
  script(w, c) {
    return (function* () {
      // Unlocking with the study key swings the secret door open.
      yield* act(w, 'unlock', 'door:d_study_gallery');
      yield* walkTo(w, P(40.2, 17.6), { crouch: true });
      yield* walkTo(w, P(37.6, 18.95), { crouch: true });
      w.player.crouching = false;
      while (c.lt < SWAP_START_LT) yield;
      c.s.swapStart = c.lt;
      yield* act(w, 'swap', 'case');
      yield* wait(w, 0.5);
      yield* face(w, 0.4, 0.4);
      yield* wait(w, 3);
    })();
  },
  timeScale(lt, c) {
    // Slow motion that lands the swap exactly on the music's sting (60.6s = lt 6.5).
    const st = c.s.swapStart as number | undefined;
    if (st === undefined) return lt < 3.95 ? 1 : 0.6;
    if (lt < 6.5) return 1.6 / (6.5 - st);
    return 1;
  },
  bubbles: { allow: ['player'], icons: false },
  ambience: { crowd: 0 },
  frame(c) {
    const p = c.w.player.pos;
    if (c.lt < 4.0) {
      const o = keyed(
        [
          [0, orb(40.5, 0.6, 18.4, -24, 38, 9.5, 30)],
          [4.0, orb(38.4, 0.8, 18.6, -10, 30, 7.0, 30), ease.inOut],
        ],
        c.lt,
      );
      return cam(o, { focus: P(39, 19.5), focusRoom: 'gallery', post: { ...NIGHT_POST, tilt: 6 }, listener: p });
    }
    const o = keyed(
      [
        [4.0, orb(36.7, 1.15, 18.4, -36, 18, 3.3, 28)],
        [6.5, orb(36.7, 1.2, 18.4, -28, 16, 2.5, 26), ease.inOut],
        [8.0, orb(36.9, 1.2, 18.6, -22, 16, 2.7, 26), ease.out],
      ],
      c.lt,
    );
    return cam(o, { focus: P(37, 19.5), focusRoom: 'gallery', post: { ...CLOSE_POST, saturation: c.lt < 6.5 ? 0.85 : 1.08, bloom: c.lt > 6.5 ? 0.65 : 0.35 }, listener: p });
  },
};

const D5: Shot = {
  id: 'D5_strut',
  start: 62.1,
  end: 64.1,
  seed: SEED,
  setup(w) {
    stageSwapDone(w);
    teleport(w, P(42.5, 30.6), Wd);
    pre(w, w.time + 0.5);
  },
  script(w) {
    return (function* () {
      yield* walkTo(w, P(34.5, 31.6), { pace: 0.6 });
      yield* wait(w, 2);
    })();
  },
  bubbles: { allow: ['g_rose', 'g_countess', 'chief', 'host'], icons: false },
  frame(c) {
    const p = c.w.player.pos;
    const o = followCam(c, 'f', P(p.x - 0.8, p.z), 0.9, 8, 18, 6.2, 30, 3);
    return cam(o, { focus: P(p.x, p.z - 1.5), focusRoom: 'ballroom', post: PARTY_POST, playerExpr: 'happy', listener: p });
  },
};

// ---------------------------------------------------------------------------------------------
// Act E — the tour, the rubber duck, chaos (64.1 – 84.1)
// ---------------------------------------------------------------------------------------------
function stageTourWorld(w: World) {
  stageSwapDone(w);
  teleport(w, P(54, 19.5));
}

const E1: Shot = {
  id: 'E1_tour',
  start: 64.1,
  end: 68.1,
  seed: SEED,
  setup(w) {
    stageTourWorld(w);
    pre(w, 346.52);
  },
  script(w, c) {
    return (function* () {
      while (c.lt < 2.0 - 1e-6) yield;
      yield* skip(358.4 - w.time);
      yield* wait(w, 6);
    })();
  },
  bubbles: { allow: ['host'], icons: false, minDur: 2.5 },
  ambience: { crowd: 0.3 },
  frame(c) {
    if (c.lt < 2.0) {
      const o = keyed(
        [
          [0, orb(36.2, 1.2, 19.8, -16, 30, 8.6, 30)],
          [2, orb(36.2, 1.3, 19.5, -10, 26, 7.4, 30), ease.linear],
        ],
        c.lt,
      );
      return cam(o, { focus: P(36, 20), focusRoom: 'gallery', post: { ...PARTY_POST, tilt: 6 }, listener: P(36, 19.5) });
    }
    // Crash zoom on the host.
    const h = npcPos(c.w, 'host');
    const k = ease.outExpo(remap(c.lt, 2.0, 2.18));
    const hf = followCam(c, 'host', P(h.x, h.z), 1.45, -28, 22, lerp(7.0, 4.4, k), lerp(32, 25, k), 5);
    const o = hf;
    return cam(o, { focus: P(h.x, 19.6), focusRoom: 'gallery', shake: c.lt < 2.6 ? 0.08 : 0, post: { ...CLOSE_POST, tilt: 7, warmth: 0.1 }, listener: h });
  },
};

const E3a: Shot = {
  id: 'E3a_radio',
  start: 68.1,
  end: 70.1,
  seed: SEED,
  setup(w) {
    stageTourWorld(w);
    pre(w, 360.78);
  },
  bubbles: { allow: ['gallery_guard', 'chief'], icons: false, minDur: 2 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(38.6, 0.8, 27.0, -4, 36, 12.5, 30)],
        [2, orb(38.6, 0.8, 27.0, -2, 34, 11.2, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(38.5, 25.5), focusRoom: 'ballroom', post: { ...PARTY_POST, warmth: -0.1 }, listener: P(38.6, 26) });
  },
};

const E3b: Shot = {
  id: 'E3b_gate',
  start: 70.1,
  end: 72.1,
  seed: SEED,
  setup(w) {
    stageTourWorld(w);
    pre(w, 360.6);
  },
  bubbles: { allow: ['doorman'], icons: false, minDur: 2 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36, 1.0, 57.4, 180, 16, 8.5, 32)],
        [2, orb(36, 1.0, 57.6, 176, 14, 7.2, 32), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(36, 70), post: { ...NIGHT_POST, tilt: 3 }, listener: P(36, 57.5) });
  },
};

const E3c: Shot = {
  id: 'E3c_warmap',
  start: 72.1,
  end: 74.1,
  seed: SEED,
  setup(w) {
    stageTourWorld(w);
    pre(w, 364.2);
  },
  bubbles: { allow: ['chief', 'g_granny', 'g_rose', 'g_kim'], icons: false },
  frame(c) {
    const o = keyed(
      [
        [0, orb(40, 0, 29, -6, 66, 46, 30)],
        [2, orb(40, 0, 29, -2, 68, 41, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(40, 46), post: { tilt: 7, tiltWidth: 0.2, bloom: 0.4, warmth: -0.15 }, listener: P(40, 30) });
  },
};

const E3d: Shot = {
  id: 'E3d_frisk',
  start: 74.1,
  end: 78.1,
  seed: SEED,
  setup(w) {
    stageTourWorld(w);
    pre(w, 371.77);
  },
  script(w) {
    return (function* () {
      yield* waitUntil(w, () => w.npcs.some((n) => n.isGuard && n.behavior.name === 'chase'), 6);
      yield* walkTo(w, P(54, 13.3), { run: true });
      yield* walkTo(w, P(47, 12.9), { run: true });
      yield* walkTo(w, P(40, 13.3), { run: true });
    })();
  },
  bubbles: { allow: ['patrol_front', 'player'], icons: true, iconAllow: ['patrol_front'], minDur: 1.8 },
  frame(c) {
    const p = c.w.player.pos;
    if (c.lt < 2.25) {
      const o = keyed(
        [
          [0, orb(54.2, 1.0, 19.8, -8, 26, 7.5, 30)],
          [2.25, orb(54.2, 1.1, 19.6, -4, 22, 5.6, 30), ease.inOut],
        ],
        c.lt,
      );
      return cam(o, { focus: P(54, 21), focusRoom: 'conserv', post: { ...PARTY_POST, warmth: 0 }, listener: p });
    }
    const o = followCam(c, 'run', P(p.x - 1.5, p.z), 0.8, 205, 30, 10.5, 32, 3.5);
    return cam(o, { focus: P(p.x, -20), post: { ...NIGHT_POST, tilt: 5 }, shake: 0.03, listener: p });
  },
};

const E4: Shot = {
  id: 'E4_escape',
  start: 78.1,
  end: 84.1,
  seed: SEED,
  setup(w) {
    stageSwapDone(w);
    teleport(w, P(67.5, 57.6));
    run(w, act(w, 'hide', 'hide:h_bush_gap'));
    pre(w, 372.0);
  },
  script(w) {
    return (function* () {
      yield* wait(w, 0.35);
      yield* act(w, 'exit', 'hide:h_bush_gap');
      yield* walkTo(w, P(68.5, 57.7), { crouch: true });
      yield* walkTo(w, P(68.5, 61.0), { crouch: true });
      yield* wait(w, 6);
    })();
  },
  bubbles: { allow: ['player'], icons: false },
  frame(c) {
    const lt = c.lt;
    // Low on the crawl, then crane up and away over the mansion in uproar.
    const o = keyed(
      [
        [0, orb(68.3, 0.55, 58.6, 30, 12, 5.6, 32)],
        [2.6, orb(68.3, 0.55, 59.6, 24, 14, 6.0, 32), ease.inOut],
        [6.0, orb(48, 0, 38, 30, 52, 52, 30), ease.inOut5],
      ],
      lt,
    );
    const up = remap(lt, 2.8, 6.0);
    return cam(o, { focus: up > 0.3 ? P(48, 80) : P(68, 66), post: { ...NIGHT_POST, tilt: lerp(6, 9, up), bloom: lerp(0.45, 0.6, up) }, listener: P(68.5, 59) });
  },
};

// ---------------------------------------------------------------------------------------------
// Act F — title & stinger (84.1 – 97.0)
// ---------------------------------------------------------------------------------------------
const F1: Shot = {
  id: 'F1_title',
  start: 84.1,
  end: 92.1,
  seed: SEED,
  setup(w) {
    w.player.gone = true;
    pre(w, 70);
    w.director.launchFireworks('gardener');
    pre(w, w.time + 2.5);
  },
  bubbles: { allow: [], icons: false },
  ambience: { crowd: 0.4, footsteps: 0 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(34, 7, 18, 0, 26, 56, 34)],
        [8, orb(34, 7.5, 18, 5, 28, 60, 34), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(36, 80), listener: P(33, 20), fwScale: 3600, post: { tilt: 6, tiltWidth: 0.12, bloom: 0.85, black: 0.22 + 0.78 * remap(c.lt, 6.8, 8.0), vignette: 0.6 } });
  },
};

const F2: Shot = {
  id: 'F2_stinger',
  start: 92.1,
  end: 97.0,
  seed: SEED,
  setup(w) {
    pre(w, 40);
    teleport(w, P(55.5, 61.3), Wd);
    run(w, act(w, 'pick', 'npc:late_guest'));
    w.player.gone = true;
    pre(w, 87.6);
  },
  bubbles: { allow: ['late_guest', 'doorman'], icons: false, minDur: 3.3 },
  ambience: { crowd: 0.3 },
  frame(c) {
    const o = keyed(
      [
        [0, orb(36.6, 1.15, 58.4, 0, 9, 6.0, 30)],
        [4.9, orb(36.6, 1.15, 58.4, 0, 9, 5.2, 30), ease.linear],
      ],
      c.lt,
    );
    return cam(o, { focus: P(36.6, 70), post: { ...NIGHT_POST, tilt: 4, black: remap(c.lt, 4.05, 4.12) }, listener: P(36.6, 58.5) });
  },
};

export const SHOTS: Shot[] = [A1, A2, A3, A4, B1, B2, B3, C1a, C1b, C2, C3, C4, C5, C6, C7, D1a, D1b, D2, D3, D5, E1, E3a, E3b, E3c, E3d, E4, F1, F2];

// Sanity: contiguous timeline.
for (let i = 1; i < SHOTS.length; i++) {
  if (Math.abs(SHOTS[i].start - SHOTS[i - 1].end) > 1e-6) console.warn('[shots] gap/overlap at', SHOTS[i].id);
}
void drift;
void at;
void THREE;
