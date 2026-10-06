// The game's own scene (LevelView / ItemView / FxView / CharacterModel, unchanged) with a
// cinematic camera instead of the follow camera. Mirrors src/view/GameView.ts; the differences are:
//  - the camera position/target/fov come from the shot, not from the player;
//  - the wall cut-away "focus" is chosen per shot;
//  - gameplay-only markers (interaction diamond, player ring) can be hidden;
//  - shading tweaks for night-time drama are exposed (exposure, hemi/sun intensity).
import * as THREE from 'three';
import type { V2 } from '../../src/core/math';
import type { Item } from '../../src/sim/Items';
import type { Appearance } from '../../src/sim/look';
import { PLAYER_LOOKS } from '../../src/sim/level/content';
import type { Npc } from '../../src/sim/npc/Npc';
import type { World } from '../../src/sim/World';
import { CharacterModel, type AnimState, type Carry } from '../../src/view/CharacterModel';
import { FxView } from '../../src/view/FxView';
import { ItemView } from '../../src/view/ItemView';
import { LevelView } from '../../src/view/LevelView';
import { LightMapShared, Mats } from '../../src/view/materials';
import { TrailerFireworks } from './fireworks';

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

export interface CamState {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll?: number;
}

export interface FrameOpts {
  cam: CamState;
  /** Cut-away focus (walls south of this point are lowered). */
  focus: V2;
  focusRoom?: string;
  showRing?: boolean;
  showMarker?: boolean;
  shake?: number;
  /** Extra light for readability in dark shots. */
  hemiBoost?: number;
  /** Override the player's facial expression. */
  playerExpr?: AnimState['expression'];
}

export class TrailerView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  private lm: LightMapShared;
  private mats: Mats;
  readonly level: LevelView;
  private items: ItemView;
  readonly fx: FxView;
  readonly fireworks: TrailerFireworks;
  private chars = new Map<string, { model: CharacterModel; look: Appearance }>();
  private player: CharacterModel;
  private playerOutfit = '';
  private flash = 0;
  private t = 0;
  private lastHop = false;
  private shakeAmt = 0;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly w: World,
    width: number,
    height: number,
  ) {
    this.scene.background = new THREE.Color('#2a2f52');
    this.scene.fog = new THREE.Fog('#2a2f52', 40, 70);
    this.camera = new THREE.PerspectiveCamera(36, width / height, 0.3, 260);

    this.hemi = new THREE.HemisphereLight('#e8e4ff', '#5b6b48', 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 1.25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.radius = 3;
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
    this.fireworks = new TrailerFireworks(w);
    this.scene.add(this.fireworks.points);

    for (const n of w.npcs) {
      const model = new CharacterModel(n.look, this.mats.lit);
      this.scene.add(model.root);
      this.chars.set(n.id, { model, look: n.look });
    }
    this.player = new CharacterModel(PLAYER_LOOKS[w.player.outfit], this.mats.lit);
    this.playerOutfit = w.player.outfit;
    this.scene.add(this.player.root);

    w.events.on('fx', (e) => {
      if (e.kind === 'fireworks') this.flash = 1;
    });
    w.events.on('shake', (e) => (this.shakeAmt = Math.max(this.shakeAmt, e.amount)));
    w.events.on('alarm', (e) => {
      if (e.on) this.shakeAmt = Math.max(this.shakeAmt, 0.25);
    });
  }

  headTop(id: string): number {
    if (id === 'player') return this.player.headTop;
    return this.chars.get(id)?.model.headTop ?? 1.9;
  }

  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, behind: v.z > 1 };
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

  update(dt: number, o: FrameOpts, rnd: () => number) {
    const w = this.w;
    this.t += dt;
    this.lm.update();
    this.fx.instinct = false;

    // Camera
    const c = o.cam;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.2);
    const sh = this.shakeAmt * this.shakeAmt * 0.5 + (o.shake ?? 0);
    this.camera.position.set(c.pos.x + (rnd() - 0.5) * sh, c.pos.y + (rnd() - 0.5) * sh, c.pos.z + (rnd() - 0.5) * sh * 0.5);
    this.camera.up.set(Math.sin(c.roll ?? 0), Math.cos(c.roll ?? 0), 0);
    this.camera.lookAt(c.look);
    if (this.camera.fov !== c.fov) {
      this.camera.fov = c.fov;
      this.camera.updateProjectionMatrix();
    }

    // Sun follows the subject for crisp shadows nearby.
    this.sun.position.set(c.look.x - 9, 24, c.look.z - 12);
    this.sun.target.position.set(c.look.x, 0, c.look.z);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const out = !w.power.on('B');
    const hTarget = (out ? 1.2 : 1.55) + (o.hemiBoost ?? 0);
    this.hemi.intensity += (hTarget + this.flash * 1.2 - this.hemi.intensity) * Math.min(1, dt * 4);
    if (this.flash > 0) this.hemi.color.setHSL((this.t * 0.3) % 1, 0.6, 0.85);
    else this.hemi.color.set('#e8e4ff');

    this.level.update(dt, w, o.focus, o.focusRoom);
    this.items.update(dt, w.items);

    for (const n of w.npcs) {
      const ch = this.chars.get(n.id)!;
      if (ch.look !== n.look) {
        ch.model.setAppearance(n.look);
        ch.look = n.look;
      }
      ch.model.root.visible = n.active;
      ch.model.root.position.set(n.pos.x, 0, n.pos.z);
      ch.model.root.rotation.y = n.facing;
      ch.model.update(dt, this.npcAnim(n));
      n.hop = false;
    }
    const p = w.player;
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
      expression: o.playerExpr ?? (chased ? 'scared' : noticed > 0.5 ? 'surprised' : noticed > 0.05 ? 'focused' : p.hasGoldenDuck() ? 'happy' : 'smug'),
      headYaw: 0,
      hop,
      shake: 0,
    });

    const opt = w.options[w.optionIdx];
    let marker: V2 | null = null;
    if (opt && o.showMarker) {
      if (opt.item) marker = opt.item.pos;
      else if (opt.target && opt.target.id !== 'self') marker = opt.target.pos(w);
    }
    this.fx.update(dt, marker, !!opt?.action.disabled, o.focus);
    this.fireworks.update(dt);
    // Flashlight cones are tuned for the game's high camera; at trailer distances they blow out.
    for (const cone of (this.fx as unknown as { flashes: Map<string, { mesh: THREE.Mesh }> }).flashes.values()) {
      const m = cone.mesh.material as THREE.Material & { opacity: number };
      if (m.opacity > 0.42) m.opacity = 0.42;
    }
    const ring = (this.fx as unknown as { playerRing: THREE.Object3D }).playerRing;
    if (!o.showRing) ring.visible = false;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const mats = new Set<THREE.Material>();
    this.scene.traverse((ob) => {
      const m = ob as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    for (const m of mats) m.dispose();
    this.lm.tex.dispose();
    this.renderer.renderLists.dispose();
  }
}
