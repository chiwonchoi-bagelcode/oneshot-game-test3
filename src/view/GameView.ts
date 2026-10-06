// Scene setup, camera and per-frame syncing of simulation state into meshes.
import * as THREE from 'three';
import { clamp, type V2 } from '../core/math';
import type { Appearance } from '../sim/look';
import { PLAYER_LOOKS } from '../sim/level/content';
import type { Item } from '../sim/Items';
import type { Npc } from '../sim/npc/Npc';
import type { World } from '../sim/World';
import { CharacterModel, type AnimState, type Carry } from './CharacterModel';
import { FxView } from './FxView';
import { ItemView } from './ItemView';
import { LevelView } from './LevelView';
import { LightMapShared, Mats } from './materials';

const carryOf = (it: Item | null): Carry => {
  if (!it) return 'none';
  switch (it.type) {
    case 'golden_duck':
      return 'duck';
    case 'fake_duck':
      return 'fake_duck';
    case 'gift_box':
      return 'box';
    case 'tray':
      return 'tray';
    case 'bottle':
      return 'bottle';
    case 'vase':
      return 'vase';
    case 'wrench':
      return 'wrench';
    default:
      return 'generic';
  }
};

export interface ViewOptions {
  instinct: boolean;
  zoom: number;
  titleMode: boolean;
}

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private lm: LightMapShared;
  private mats: Mats;
  private level: LevelView;
  private items: ItemView;
  readonly fx: FxView;
  private chars = new Map<string, { model: CharacterModel; look: Appearance; hopSeen: boolean }>();
  private player: CharacterModel;
  private playerOutfit = '';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private flash = 0;
  private t = 0;
  private focus: V2;
  private lastHop = false;

  static createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    private canvas: HTMLCanvasElement,
    private w: World,
  ) {
    this.renderer = renderer;
    this.scene.background = new THREE.Color('#2a2f52');
    this.scene.fog = new THREE.Fog('#2a2f52', 40, 70);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);

    this.hemi = new THREE.HemisphereLight('#e8e4ff', '#5b6b48', 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 1.25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 70;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.lm = new LightMapShared(w.lighting, w.grid.w, w.grid.h);
    this.mats = new Mats(this.lm);
    this.level = new LevelView(w.grid, this.mats);
    this.scene.add(this.level.group);
    this.items = new ItemView(this.mats);
    this.scene.add(this.items.group);
    this.fx = new FxView(w);
    this.scene.add(this.fx.group);

    for (const n of w.npcs) {
      const model = new CharacterModel(n.look, this.mats.lit);
      this.scene.add(model.root);
      this.chars.set(n.id, { model, look: n.look, hopSeen: false });
    }
    this.player = new CharacterModel(PLAYER_LOOKS[w.player.outfit], this.mats.lit);
    this.playerOutfit = w.player.outfit;
    this.scene.add(this.player.root);
    this.focus = { ...w.player.pos };
    this.camLook.set(this.focus.x, 0, this.focus.z);
    this.camPos.set(this.focus.x, 19, this.focus.z + 14);

    w.events.on('shake', (e) => (this.shake = Math.max(this.shake, e.amount)));
    w.events.on('fx', (e) => {
      if (e.kind === 'fireworks') this.flash = 1;
    });
    w.events.on('caught', () => (this.shake = 0.6));
    w.events.on('alarm', (e) => {
      if (e.on) this.shake = 0.4;
    });
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const wdt = Math.max(1, r.width || window.innerWidth);
    const hgt = Math.max(1, r.height || window.innerHeight);
    this.renderer.setSize(wdt, hgt, false);
    this.camera.aspect = wdt / hgt;
    this.camera.updateProjectionMatrix();
  }

  /** Project a world point to CSS pixels (or null if behind the camera). */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
  }

  headTop(id: string): number {
    if (id === 'player') return this.player.headTop;
    return this.chars.get(id)?.model.headTop ?? 1.9;
  }

  private npcAnim(n: Npc): AnimState {
    return {
      pose: n.pose,
      speed: n.speed,
      action: n.action,
      carry: n.hand ? carryOf(n.hand) : n.carry,
      expression: n.expr,
      headYaw: n.headYaw,
      hop: n.hop,
      shake: n.shake > 0 ? Math.min(1, n.shake) : 0,
      flashlight: n.flashlightOn,
    };
  }

  update(dt: number, o: ViewOptions) {
    const w = this.w;
    this.t += dt;
    this.lm.update();
    this.fx.instinct = o.instinct;

    // Camera
    const p = w.player;
    if (o.titleMode) {
      const a = this.t * 0.05;
      this.focus = { x: 36 + Math.sin(a) * 6, z: 32 + Math.cos(a) * 4 };
      const target = new THREE.Vector3(this.focus.x, 0, this.focus.z);
      this.camLook.lerp(target, 1 - Math.exp(-2 * dt));
      this.camPos.set(this.camLook.x + Math.sin(a) * 6, 34, this.camLook.z + 30);
    } else {
      const look = { x: p.pos.x + p.vel.x * 0.25, z: p.pos.z + p.vel.z * 0.25 };
      if (!p.gone) this.focus = { ...p.pos };
      const k = 1 - Math.exp(-5 * dt);
      this.camLook.x += (look.x - this.camLook.x) * k;
      this.camLook.z += (look.z - this.camLook.z) * k;
      const zoom = clamp(o.zoom, 0.6, 1.7);
      const tx = this.camLook.x;
      const ty = 19 * zoom;
      const tz = this.camLook.z + 14 * zoom;
      this.camPos.x += (tx - this.camPos.x) * k;
      this.camPos.y += (ty - this.camPos.y) * Math.min(1, k * 1.5);
      this.camPos.z += (tz - this.camPos.z) * k;
    }
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const sh = this.shake * this.shake * 0.5;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, this.camPos.z);
    this.camera.lookAt(this.camLook.x, 0.6, this.camLook.z);

    // Sun follows the focus for crisp shadows nearby.
    this.sun.position.set(this.camLook.x - 9, 24, this.camLook.z - 12);
    this.sun.target.position.set(this.camLook.x, 0, this.camLook.z);
    // Global mood: darker when the main house is out, fireworks flash.
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const out = !w.power.on('B');
    const hTarget = out ? 1.2 : 1.55;
    this.hemi.intensity += (hTarget + this.flash * 1.2 - this.hemi.intensity) * Math.min(1, dt * 4);
    if (this.flash > 0) this.hemi.color.setHSL((this.t * 0.3) % 1, 0.6, 0.85);
    else this.hemi.color.set('#e8e4ff');

    // Level
    const focusRoom = o.titleMode ? undefined : w.grid.roomAt(this.focus)?.id;
    this.level.update(dt, w, o.titleMode ? { x: 36, z: 80 } : this.focus, focusRoom);
    this.items.update(dt, w.items);

    // NPCs
    for (const n of w.npcs) {
      const c = this.chars.get(n.id)!;
      if (c.look !== n.look) {
        c.model.setAppearance(n.look);
        c.look = n.look;
      }
      c.model.root.visible = n.active;
      c.model.root.position.set(n.pos.x, 0, n.pos.z);
      c.model.root.rotation.y = n.facing;
      c.model.update(dt, this.npcAnim(n));
      n.hop = false;
    }
    // Player
    if (this.playerOutfit !== p.outfit) {
      this.playerOutfit = p.outfit;
      this.player.setAppearance(PLAYER_LOOKS[p.outfit]);
    }
    this.player.root.visible = !p.gone && !p.hidden;
    this.player.root.position.set(p.pos.x, 0, p.pos.z);
    this.player.root.rotation.y = p.facing;
    const chased = p.chasers.size > 0;
    const noticed = [...p.noticedBy.values()].reduce((a, b) => Math.max(a, b), 0);
    const hop = p.hop && !this.lastHop;
    this.lastHop = p.hop;
    p.hop = false;
    this.player.update(dt, {
      pose: p.hidden ? 'hidden' : p.climb ? 'sneak' : p.crouching ? 'sneak' : p.speed > 4 ? 'run' : p.speed > 0.2 ? 'walk' : 'stand',
      speed: p.speed,
      action: p.action ? (p.action.anim as AnimState['action']) : 'none',
      carry: carryOf(p.hand),
      expression: chased ? 'scared' : noticed > 0.5 ? 'surprised' : noticed > 0.05 ? 'focused' : p.hasGoldenDuck() ? 'happy' : 'smug',
      headYaw: 0,
      hop,
      shake: 0,
    });

    // FX
    const opt = w.options[w.optionIdx];
    let marker: V2 | null = null;
    if (opt && !o.titleMode) {
      if (opt.item) marker = opt.item.pos;
      else if (opt.target && opt.target.id !== 'self') marker = opt.target.pos(w);
    }
    this.fx.update(dt, marker, !!opt?.action.disabled, this.focus);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.lm.tex.dispose();
    this.renderer.renderLists.dispose();
  }
}
