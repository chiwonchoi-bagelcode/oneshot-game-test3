// Game shell: screens, the main loop, input → simulation, simulation → audio.
import * as THREE from 'three';
import { audio, type MusicState } from '../audio/Audio';
import { dist } from '../core/math';
import type { OutfitId } from '../sim/level/types';
import { World } from '../sim/World';
import { Hud } from '../ui/Hud';
import { Tips } from '../ui/Tips';
import {
  briefingScreen,
  clearScreens,
  howtoScreen,
  journalScreen,
  loadRecords,
  pauseScreen,
  rateRun,
  recordsScreen,
  resultScreen,
  saveRecords,
  titleScreen,
} from '../ui/Screens';
import { GameView } from '../view/GameView';
import { Input } from './Input';

type Mode = 'title' | 'menu' | 'playing' | 'paused' | 'journal' | 'ending' | 'result';

const STEP = 1 / 60;
const OUTFIT_KEYS: OutfitId[] = ['guest', 'waiter', 'chef', 'guard', 'electrician'];

export class App {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private input = new Input(window);
  world!: World;
  view!: GameView;
  private hud: Hud | null = null;
  private tips = new Tips();
  private stepAcc = new Map<string, number>();
  mode: Mode = 'title';
  private acc = 0;
  private last = performance.now();
  private crouchToggle = false;
  private endTimer = 0;
  private unsub: (() => void)[] = [];
  /** Test hook: run the simulation without rendering when true. */
  headlessStep = false;

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = GameView.createRenderer(this.canvas);
    window.addEventListener('resize', () => this.view?.resize());
    const unlock = () => audio.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.newWorld(true);
    this.showTitle();
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------------------
  private newWorld(title: boolean) {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.hud?.dispose();
    this.hud = null;
    this.view?.dispose();
    audio.stopAllLoops();
    this.world = new World(Math.floor(Math.random() * 1e6));
    this.view = new GameView(this.renderer, this.canvas, this.world);
    this.crouchToggle = false;
    this.input.zoom = 0.85;
    this.tips = new Tips();
    this.stepAcc.clear();
    if (!title) {
      this.hud = new Hud(this.world, this.view);
      this.bindAudio();
      this.unsub.push(
        this.world.events.on('caught', () => this.beginEnding()),
        this.world.events.on('escaped', () => this.beginEnding()),
      );
    } else {
      // Title backdrop: the party goes on without us.
      this.world.player.gone = true;
    }
  }

  private showTitle() {
    this.mode = 'title';
    if (this.hud) this.newWorld(true);
    audio.setMusic('title');
    titleScreen({
      start: () => this.showBriefing(),
      howto: () => howtoScreen(() => this.showTitle()),
      records: () => recordsScreen(() => this.showTitle()),
    });
  }

  private showBriefing() {
    audio.play('click');
    this.mode = 'menu';
    briefingScreen(
      () => this.startGame(),
      () => this.showTitle(),
    );
  }

  startGame() {
    audio.play('click');
    clearScreens();
    this.newWorld(false);
    this.mode = 'playing';
    audio.setMusic('calm');
    this.canvas.focus();
  }

  private pause() {
    this.mode = 'paused';
    pauseScreen({
      resume: () => this.resume(),
      restart: () => this.startGame(),
      title: () => this.showTitle(),
      mute: () => {
        audio.setMuted(!audio.muted);
        this.pause();
      },
      muted: audio.muted,
    });
  }

  private resume() {
    clearScreens();
    this.mode = 'playing';
  }

  private openJournal() {
    this.mode = 'journal';
    journalScreen(this.world, () => this.resume());
  }

  private beginEnding() {
    if (this.mode === 'ending' || this.mode === 'result') return;
    this.mode = 'ending';
    this.endTimer = this.world.ended === 'escaped' ? 2.2 : 2.6;
    const ok = this.world.ended === 'escaped';
    audio.setMusic(ok ? 'victory' : 'fail');
    audio.play(ok ? 'success' : 'fail');
    if (ok) this.world.events.emit('fx', { kind: 'confetti', x: this.world.player.pos.x, z: this.world.player.pos.z });
    const routes: Record<string, string> = {
      front: '정문으로 유유히 빠져나갔다',
      service: '직원용 쪽문으로 빠져나갔다',
      gap: '울타리 개구멍으로 기어 나갔다',
      boat: '보트를 저어 호수 너머로',
      van: '배달 밴을 몰고 쪽문을 들이받았다',
    };
    const banner = document.createElement('div');
    banner.className = 'ending-banner ' + (ok ? 'win' : 'lose');
    banner.innerHTML = ok
      ? `<div class="big">🦆 탈출 성공!</div><div class="small">${routes[this.world.stats.route] ?? ''}</div>`
      : `<div class="big">🚔 붙잡혔다!</div><div class="small">${this.world.stats.caughtBy}: "${this.world.stats.caughtWhy}"</div>`;
    clearScreens();
    document.getElementById('screens')!.append(banner);
  }

  private showResult() {
    this.mode = 'result';
    const w = this.world;
    const info = rateRun(w);
    const rec = loadRecords();
    rec.runs++;
    if (w.ended === 'escaped') {
      rec.wins++;
      if (!rec.best || w.stats.endTime < rec.best.time) rec.best = { time: w.stats.endTime, title: info.rating };
      if (!rec.routes.includes(w.stats.route)) rec.routes.push(w.stats.route);
    }
    for (const t of w.stats.todos) if (!rec.todos.includes(t)) rec.todos.push(t);
    saveRecords(rec);
    this.hud?.setVisible(false);
    resultScreen(w, info, { retry: () => this.startGame(), title: () => this.showTitle() });
  }

  // ---------------------------------------------------------------------------
  private bindAudio() {
    const w = this.world;
    this.unsub.push(
      w.events.on('sfx', (e) => audio.play(e.name as never, { x: e.x, z: e.z, volume: e.volume, pitch: e.pitch })),
      w.events.on('voice', (e) => audio.voice(e.kind as never, { x: e.x, z: e.z, pitch: e.pitch, volume: e.volume })),
      w.events.on('intel', () => undefined),
    );
  }

  private updateAudio() {
    const w = this.world;
    const p = w.player;
    audio.setListener(p.pos.x, p.pos.z);
    // Loops
    if (w.security.alarmOn) audio.loop('alarm', 'alarm', { x: 36, z: 18 });
    else audio.stopLoop('alarm');
    if (w.flags.fireAlarm) audio.loop('fire', 'fire_bell', { x: p.pos.x, z: p.pos.z - 2, volume: 0.7 });
    else audio.stopLoop('fire');
    if (w.flags.jukeboxOn) audio.loop('juke', 'jukebox', { x: 59.4, z: 25.7 });
    else audio.stopLoop('juke');
    const pianist = w.npc('pianist');
    if (pianist && pianist.awake && pianist.action === 'piano') audio.loop('piano', 'piano', { x: 28.5, z: 32.5, volume: 0.8 });
    else audio.stopLoop('piano');
    if (w.power.on('C') || true) audio.loop('fountain', 'fountain', { x: 36, z: 51.5, volume: 0.5 });
    audio.loop('duckfountain', 'fountain', { x: 36, z: 7, volume: 0.4 });
    if (w.power.on('A')) audio.loop('hum', 'hum', { x: 14.5, z: 15, volume: 0.6 });
    else audio.stopLoop('hum');
    // Crowd murmur near the party.
    const guests = w.npcs.filter((n) => n.role === 'guest' && n.awake && dist(n.pos, p.pos) < 14).length;
    if (guests >= 3) audio.loop('crowd', 'crowd', { x: p.pos.x, z: p.pos.z, volume: Math.min(1, guests / 8) });
    else audio.stopLoop('crowd');
    // Adaptive music
    let m: MusicState = 'calm';
    const noticed = [...p.noticedBy.values()].reduce((a, b) => Math.max(a, b), 0);
    if (w.security.lockdown) m = p.chasers.size ? 'chase' : 'lockdown';
    else if (p.chasers.size) m = 'chase';
    else if (w.security.alarmOn || w.searchers.size || noticed > 0.5 || p.confrontedBy.size) m = 'tension';
    else if (!w.power.on('B') && w.grid.roomAt(p.pos)?.indoor) m = 'blackout';
    else if (w.playerStatus.trespass || noticed > 0.05 || p.crouching || p.hasGoldenDuck()) m = 'sneak';
    audio.setMusic(m);
  }

  /** Footsteps of nearby people: you can hear a guard coming before you see him. */
  private npcFootsteps(dt: number) {
    const w = this.world;
    const p = w.player;
    for (const n of w.npcs) {
      if (!n.active || n.speed < 0.3) continue;
      const d = dist(n.pos, p.pos);
      if (d > 12) continue;
      const acc = (this.stepAcc.get(n.id) ?? 0) + n.speed * dt;
      const stride = n.speed > 3.2 ? 1.5 : 1.15;
      if (acc >= stride) {
        this.stepAcc.set(n.id, acc - stride);
        const room = w.grid.roomAt(n.pos);
        const soft = !room || !room.indoor || room.floor.startsWith('carpet');
        audio.play(soft ? 'step_grass' : n.speed > 3.2 ? 'step_run' : 'step', {
          x: n.pos.x,
          z: n.pos.z,
          volume: (n.isGuard ? 0.55 : 0.32) * (n.speed > 3.2 ? 1.3 : 1),
          pitch: n.isGuard ? 0.85 : 1.05,
        });
      } else this.stepAcc.set(n.id, acc);
    }
  }

  // ---------------------------------------------------------------------------
  private handleInput() {
    const w = this.world;
    const p = w.player;
    const inp = this.input;
    const presses = inp.consume();
    for (const b of presses) {
      switch (b) {
        case 'pause':
          this.pause();
          return;
        case 'journal':
          this.openJournal();
          return;
        case 'mute':
          audio.setMuted(!audio.muted);
          break;
        case 'interact':
          if (p.hidden && !w.options.length) p.exitHide(w);
          else w.activateOption();
          break;
        case 'cycle':
          w.cycleOption();
          audio.play('hover');
          break;
        case 'throw':
          if (!p.action && !p.hidden) w.throwHeld();
          break;
        case 'drop':
          if (!p.action && !p.hidden) w.dropHeld();
          break;
        case 'whistle':
          w.whistle();
          break;
        case 'crouch':
          this.crouchToggle = !this.crouchToggle;
          break;
        case 'o1':
        case 'o2':
        case 'o3':
        case 'o4':
        case 'o5': {
          const o = OUTFIT_KEYS[Number(b.slice(1)) - 1];
          if (!p.owned.has(o)) w.events.emit('notify', { text: `${o === 'guest' ? '' : '아직 '}이 옷은 없다. 사물함이나 옷걸이 등에서 구해야 한다.`, kind: 'info' });
          else w.requestOutfit(o);
          break;
        }
      }
    }
    p.input = inp.move();
    p.run = inp.run;
    p.crouching = this.crouchToggle || inp.crouchHeld;
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    const w = this.world;

    if (this.mode === 'playing') this.handleInput();
    else this.input.consume();
    if (this.mode === 'journal') {
      // Tab closes the journal
      if (this.input.isDown('Tab') || this.input.isDown('Escape')) {
        /* handled by keydown below */
      }
    }

    const simulate = this.mode === 'playing' || this.mode === 'title' || this.mode === 'menu' || this.mode === 'ending' || this.mode === 'result';
    if (simulate) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        w.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }
    if (this.mode === 'ending') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.showResult();
    }
    const titleMode = this.mode === 'title' || this.mode === 'menu';
    this.view.update(dt, { instinct: this.mode === 'playing' && this.input.instinct, zoom: this.input.zoom, titleMode });
    this.view.render();
    if (this.hud && !titleMode) this.hud.update(dt, this.mode === 'playing' && this.input.instinct);
    if (this.mode === 'playing' || this.mode === 'ending') {
      this.updateAudio();
      this.npcFootsteps(dt);
    }
    if (this.mode === 'playing') this.tips.update(w, dt);
    audio.update(dt);
  };

  /** Close the journal with Tab/Esc. */
  handleMenuKey(code: string) {
    if (this.mode === 'journal' && (code === 'Tab' || code === 'Escape' || code === 'KeyJ')) this.resume();
    else if (this.mode === 'paused' && (code === 'Escape' || code === 'KeyP')) this.resume();
  }
}
