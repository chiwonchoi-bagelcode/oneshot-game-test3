// Frame-exact trailer runtime: shot switching, live simulation, camera, overlays and the game's
// audio recorded on trailer time. `renderFrame(f)` must be called with f = 0, 1, 2, ... in order.
import * as THREE from 'three';
import { GameAudio } from '../../src/audio/Audio';
import { dist, type V2 } from '../../src/core/math';
import { World } from '../../src/sim/World';
import type { Script } from './bot';
import type { CamState } from './TrailerView';
import { TrailerView } from './TrailerView';
import { H, TitleLayer, W, WorldUi, type BubbleRules, type Title } from './overlay';
import { installOfflineAudio, type OfflineRecorder } from './offlineAudio';
import { Post, type PostOpts } from './post';

export const FPS = 30;
const SUB = 2;

export interface ShotCtx {
  /** Local shot time (trailer seconds since shot start). */
  lt: number;
  dt: number;
  w: World;
  view: TrailerView;
  /** Free-form per-shot state. */
  s: Record<string, unknown>;
  /** Simulation time when the shot started. */
  simStart: number;
}

export interface ShotFrame {
  cam: CamState;
  focus?: V2;
  focusRoom?: string;
  showRing?: boolean;
  showMarker?: boolean;
  shake?: number;
  hemiBoost?: number;
  post?: PostOpts;
  listener?: V2;
  /** Point size scale for the trailer fireworks. */
  fwScale?: number;
  playerExpr?: Parameters<TrailerView['update']>[1]['playerExpr'];
}

export interface Shot {
  id: string;
  start: number;
  end: number;
  seed: number;
  /** Off-camera preparation (runs synchronously before the first frame). */
  setup?(w: World, s: Record<string, unknown>): void;
  /** Live actions, one yield per simulation sub-step. */
  script?(w: World, c: ShotCtx): Script;
  /** Simulation speed (1 = real time, 0.3 = slow motion). */
  timeScale?(lt: number, c: ShotCtx): number;
  frame(c: ShotCtx): ShotFrame;
  bubbles?: BubbleRules;
  /** Called after each simulation sub-step (for staging tweaks). */
  each?(c: ShotCtx): void;
  /** Ambience levels for this shot. */
  ambience?: { crowd?: number; footsteps?: number; sfx?: number };
}

/** Deterministic Math.random replacement (FX particles, camera shake, synth variations). */
export function seedRandom(seed: number) {
  let a = seed >>> 0 || 1;
  Math.random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly rec: OfflineRecorder;
  readonly audio: GameAudio;
  private worldUi: WorldUi;
  private titles: TitleLayer;
  private post: Post;
  private cur: { shot: Shot; w: World; view: TrailerView; ctx: ShotCtx; script: Script | null; unsub: (() => void)[] } | null = null;
  private stepAcc = new Map<string, number>();
  private muted = false;
  private flushBark: (() => void) | null = null;
  readonly fade: HTMLDivElement;
  frameHook: ((t: number) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private shots: Shot[],
    titles: Title[],
    readonly duration: number,
  ) {
    this.rec = installOfflineAudio(duration);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.post = new Post(this.renderer, W, H);
    const stage = document.getElementById('stage')!;
    this.worldUi = new WorldUi(stage);
    this.titles = new TitleLayer(stage, titles);
    this.fade = document.createElement('div');
    this.fade.className = 'fade';
    stage.append(this.fade);
    this.audio = new GameAudio();
    this.audio.init();
    this.audio.setMusic('off');
  }

  get frames() {
    return Math.round(this.duration * FPS);
  }

  private enter(shot: Shot) {
    this.leave();
    seedRandom(shot.seed * 7919 + 13);
    const w = new World(shot.seed);
    const s: Record<string, unknown> = {};
    shot.setup?.(w, s);
    const view = new TrailerView(this.renderer, w, W, H);
    const ctx: ShotCtx = { lt: 0, dt: 1 / FPS, w, view, s, simStart: w.time };
    const unsub: (() => void)[] = [];
    const sfxGain = shot.ambience?.sfx ?? 1;
    unsub.push(
      w.events.on('sfx', (e) => !this.muted && this.audio.play(e.name as never, { x: e.x, z: e.z, volume: (e.volume ?? 1) * sfxGain, pitch: e.pitch })),
      w.events.on('voice', (e) => {
        if (pendingBark) pendingBark.voiced = true;
        if (!this.muted) this.audio.voice(e.kind as never, { x: e.x, z: e.z, pitch: e.pitch, volume: e.volume });
      }),
      // Npc.say() rate-limits voices with a module-level timestamp shared by every World in the
      // page; with many seeded worlds per trailer it would silence later shots. Voice the bark
      // ourselves (same kind mapping as Npc.say) when the game skipped it for that reason.
      w.events.on('bark', (e) => {
        flushBark();
        const n = w.npc(e.id);
        if (!n || e.kind === 'radio') return;
        pendingBark = { kind: e.kind === 'alert' ? 'shout' : e.kind === 'thought' ? 'hmm' : 'chatter', x: n.pos.x, z: n.pos.z, pitch: n.def.pitch, alert: e.kind === 'alert', voiced: false };
      }),
    );
    let pendingBark: { kind: string; x: number; z: number; pitch: number; alert: boolean; voiced: boolean } | null = null;
    let lastVoiceT = -1;
    const flushBark = () => {
      const b = pendingBark;
      pendingBark = null;
      if (!b || b.voiced || this.muted) return;
      if (w.time - lastVoiceT <= 0.05 && !b.alert) return;
      lastVoiceT = w.time;
      this.audio.voice(b.kind as never, { x: b.x, z: b.z, pitch: b.pitch });
    };
    this.flushBark = flushBark;
    // Like the game's App: confetti where the player made it out.
    unsub.push(
      w.events.on('escaped', () => {
        w.events.emit('fx', { kind: 'confetti', x: w.player.pos.x, z: w.player.pos.z });
        if (!this.muted) this.audio.play('success');
      }),
    );
    this.worldUi.attach(w, shot.bubbles ?? { allow: '*', icons: true });
    this.stepAcc.clear();
    this.cur = { shot, w, view, ctx, script: shot.script ? shot.script(w, ctx) : null, unsub };
  }

  private leave() {
    if (!this.cur) return;
    for (const u of this.cur.unsub) u();
    this.audio.stopAllLoops();
    this.worldUi.detach();
    this.cur.view.dispose();
    this.cur = null;
  }

  renderFrame(f: number) {
    const t = f / FPS;
    this.rec.clock.t = t;
    const shot = this.shots.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? this.shots[this.shots.length - 1];
    if (!this.cur || this.cur.shot !== shot) this.enter(shot);
    const c = this.cur!;
    const ctx = c.ctx;
    const lt = t - shot.start;
    const dtF = 1 / FPS;
    const ts = Math.max(0, shot.timeScale?.(lt, ctx) ?? 1);
    ctx.lt = lt;
    ctx.dt = dtF;
    const simDt = (dtF * ts) / SUB;
    // First frame of a shot: no simulation advance (shows the prepared state).
    if (lt > 1e-6 && simDt > 0) {
      for (let i = 0; i < SUB; i++) {
        if (c.script) {
          const r = c.script.next();
          if (r.done) c.script = null;
          else if ((r.value as unknown) && typeof (r.value as unknown) === 'object' && 'skip' in (r.value as unknown as object)) {
            // Off-camera time jump inside a shot (used on a cut): simulate silently.
            const sec = (r.value as unknown as { skip: number }).skip;
            this.muted = true;
            const end = c.w.time + sec;
            while (c.w.time < end) c.w.update(1 / 30);
            this.muted = false;
            this.worldUi.clearBubbles();
          }
        }
        c.w.update(simDt);
        this.flushBark?.();
        shot.each?.(ctx);
      }
    }
    const fr = shot.frame(ctx);
    const focus = fr.focus ?? { x: fr.cam.look.x, z: fr.cam.look.z };
    const animDt = lt > 1e-6 ? dtF * ts : 1 / 60;
    if (lt <= 1e-6) {
      // Warm up character poses so the first frame isn't a T-pose blend.
      for (let i = 0; i < 20; i++)
        c.view.update(1 / 30, { cam: fr.cam, focus, focusRoom: fr.focusRoom, showRing: fr.showRing, showMarker: fr.showMarker, hemiBoost: fr.hemiBoost }, Math.random);
    }
    c.view.update(
      animDt,
      { cam: fr.cam, focus, focusRoom: fr.focusRoom, showRing: fr.showRing, showMarker: fr.showMarker, shake: fr.shake, hemiBoost: fr.hemiBoost, playerExpr: fr.playerExpr },
      Math.random,
    );
    (c.view.fireworks.points.material as THREE.ShaderMaterial).uniforms.uScale.value = fr.fwScale ?? 900;
    this.worldUi.update(animDt, c.w, c.view);
    this.titles.update(t);
    this.frameHook?.(t);
    // Audio: listener at the subject, ambience loops & footsteps like the game's App does.
    const L = fr.listener ?? focus;
    this.audio.setListener(L.x, L.z);
    this.ambience(c.w, L, dtF * ts, shot);
    this.audio.update(dtF);
    this.post.render(c.view.scene, c.view.camera, fr.post ?? {}, t);
  }

  private ambience(w: World, L: V2, dt: number, shot: Shot) {
    const a = this.audio;
    if (w.security.alarmOn) a.loop('alarm', 'alarm', { x: 36, z: 18 });
    else a.stopLoop('alarm');
    if (w.flags.fireAlarm) a.loop('fire', 'fire_bell', { x: L.x, z: L.z - 2, volume: 0.7 });
    else a.stopLoop('fire');
    if (w.flags.jukeboxOn) a.loop('juke', 'jukebox', { x: 59.4, z: 25.7 });
    else a.stopLoop('juke');
    a.loop('fountain', 'fountain', { x: 36, z: 51.5, volume: 0.5 });
    a.loop('duckfountain', 'fountain', { x: 36, z: 7, volume: 0.4 });
    if (w.power.on('A')) a.loop('hum', 'hum', { x: 14.5, z: 15, volume: 0.6 });
    else a.stopLoop('hum');
    const crowdK = shot.ambience?.crowd ?? 1;
    const guests = w.npcs.filter((n) => n.role === 'guest' && n.awake && dist(n.pos, L) < 14).length;
    if (guests >= 3 && crowdK > 0) a.loop('crowd', 'crowd', { x: L.x, z: L.z, volume: Math.min(1, guests / 8) * crowdK });
    else a.stopLoop('crowd');
    const fk = shot.ambience?.footsteps ?? 1;
    if (fk <= 0) return;
    for (const n of w.npcs) {
      if (!n.active || n.speed < 0.3) continue;
      const d = dist(n.pos, L);
      if (d > 12) continue;
      const acc = (this.stepAcc.get(n.id) ?? 0) + n.speed * dt;
      const stride = n.speed > 3.2 ? 1.5 : 1.15;
      if (acc >= stride) {
        this.stepAcc.set(n.id, acc - stride);
        const room = w.grid.roomAt(n.pos);
        const soft = !room || !room.indoor || room.floor.startsWith('carpet');
        a.play(soft ? 'step_grass' : n.speed > 3.2 ? 'step_run' : 'step', {
          x: n.pos.x,
          z: n.pos.z,
          volume: (n.isGuard ? 0.55 : 0.32) * (n.speed > 3.2 ? 1.3 : 1) * fk,
          pitch: n.isGuard ? 0.85 : 1.05,
        });
      } else this.stepAcc.set(n.id, acc);
    }
  }

  async renderAudio(): Promise<AudioBuffer> {
    this.leave();
    return this.rec.render();
  }
}
