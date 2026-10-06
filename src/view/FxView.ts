// Readability effects: vision cones, camera cones, flashlights, noise rings,
// particles, the player's ground ring and the interaction marker.
import * as THREE from 'three';
import type { V2 } from '../core/math';
import { FLASH, lightFactor, VISION } from '../sim/npc/perception';
import type { Npc } from '../sim/npc/Npc';
import type { World } from '../sim/World';

const RAYS = 22;

class Cone {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  pos: Float32Array;
  col: Float32Array;
  constructor(parent: THREE.Object3D, additive = false) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((RAYS + 2) * 3);
    this.col = new Float32Array((RAYS + 2) * 4);
    const idx: number[] = [];
    for (let i = 0; i < RAYS; i++) idx.push(0, i + 1, i + 2);
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
  }
  set(w: World, origin: V2, angle: number, half: number, range: number, color: THREE.Color, alpha: number, y = 0.05) {
    this.pos[0] = origin.x;
    this.pos[1] = y;
    this.pos[2] = origin.z;
    this.col.set([color.r, color.g, color.b, alpha], 0);
    for (let i = 0; i <= RAYS; i++) {
      const a = angle - half + (2 * half * i) / RAYS;
      const d = w.grid.castRay(origin, a, range);
      const k = (i + 1) * 3;
      this.pos[k] = origin.x + Math.sin(a) * d;
      this.pos[k + 1] = y;
      this.pos[k + 2] = origin.z + Math.cos(a) * d;
      const c = (i + 1) * 4;
      this.col[c] = color.r;
      this.col[c + 1] = color.g;
      this.col[c + 2] = color.b;
      this.col[c + 3] = alpha * 0.3;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mesh.visible = true;
  }
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  g: number;
  color: THREE.Color;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  max: number;
  radius: number;
}

const COLORS = {
  calm: new THREE.Color('#fff4c2'),
  yellow: new THREE.Color('#ffd84a'),
  orange: new THREE.Color('#ff9a3c'),
  red: new THREE.Color('#ff4a4a'),
  cam: new THREE.Color('#9fd8ff'),
  flash: new THREE.Color('#fff2b8'),
  guard: new THREE.Color('#5b8cff'),
  staff: new THREE.Color('#5fd38d'),
  guest: new THREE.Color('#ffe27a'),
};

export class FxView {
  readonly group = new THREE.Group();
  private cones = new Map<string, Cone>();
  private peri = new Map<string, [Cone, Cone]>();
  private flashes = new Map<string, Cone>();
  private camCones: Cone[] = [];
  private camModels: { body: THREE.Object3D; led: THREE.Mesh }[] = [];
  private rings: Ring[] = [];
  private particles: Particle[] = [];
  private pMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private playerRing: THREE.Mesh;
  private marker: THREE.Mesh;
  private t = 0;
  instinct = false;

  constructor(private w: World) {
    // Particles
    this.pMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 500);
    this.pMesh.count = 0;
    this.pMesh.frustumCulled = false;
    this.pMesh.renderOrder = 3;
    this.group.add(this.pMesh);
    // Player ring
    this.playerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 32),
      new THREE.MeshBasicMaterial({ color: '#7ff0c0', transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.playerRing.rotation.x = -Math.PI / 2;
    this.playerRing.renderOrder = 4;
    this.group.add(this.playerRing);
    // Interaction marker
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshBasicMaterial({ color: '#ffd84a' }));
    this.marker.renderOrder = 5;
    this.group.add(this.marker);
    // Security cameras (models)
    for (const c of w.security.cams) {
      const body = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.42), new THREE.MeshLambertMaterial({ color: '#e9ecef' }));
      box.position.z = 0.15;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), new THREE.MeshBasicMaterial({ color: '#202428' }));
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.38;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: '#3dff7a' }));
      led.position.set(0.07, 0.1, 0.3);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.25), new THREE.MeshLambertMaterial({ color: '#9aa0a6' }));
      arm.position.z = -0.08;
      body.add(box, lens, led, arm);
      body.position.set(c.pos.x, 2.45, c.pos.z);
      this.group.add(body);
      this.camModels.push({ body, led });
      this.camCones.push(new Cone(this.group));
    }
    w.events.on('noise', (e) => {
      if (e.kind === 'step' && e.radius < 4) return;
      this.ring({ x: e.x, z: e.z }, Math.min(e.radius, 18), e.kind === 'alarm' || e.kind === 'fire_alarm' ? 2.2 : 1.1);
    });
    w.events.on('fx', (e) => this.burst(e.kind, e.x, e.y ?? 0.5, e.z));
  }

  private ring(p: V2, radius: number, dur: number) {
    let r = this.rings.find((x) => x.t >= x.max);
    if (!r) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1.0, 48),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      r = { mesh, t: 0, max: dur, radius };
      this.rings.push(r);
    }
    r.t = 0;
    r.max = dur;
    r.radius = radius;
    r.mesh.position.set(p.x, 0.08, p.z);
    r.mesh.visible = true;
  }

  private spawn(p: Partial<Particle> & { x: number; y: number; z: number; color: THREE.Color }) {
    if (this.particles.length >= 500) this.particles.shift();
    this.particles.push({ vx: 0, vy: 0, vz: 0, life: 1, max: 1, size: 0.08, grow: 0, g: 0, ...p } as Particle);
  }

  burst(kind: string, x: number, y: number, z: number) {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    switch (kind) {
      case 'shards':
        for (let i = 0; i < 14; i++)
          this.spawn({ x, y: 0.3, z, vx: rnd(-2.5, 2.5), vy: rnd(1.5, 4), vz: rnd(-2.5, 2.5), g: 12, life: 0.7, max: 0.7, size: 0.05, color: new THREE.Color(i % 2 ? '#d9f3ff' : '#ffffff') });
        break;
      case 'sparkle':
        for (let i = 0; i < 18; i++)
          this.spawn({ x, y, z, vx: rnd(-1, 1), vy: rnd(0.5, 2.2), vz: rnd(-1, 1), g: 1, life: 1, max: 1, size: 0.05, color: new THREE.Color('#ffe066') });
        break;
      case 'smoke':
        for (let i = 0; i < 3; i++)
          this.spawn({ x: x + rnd(-0.1, 0.1), y, z: z + rnd(-0.1, 0.1), vx: rnd(-0.1, 0.1), vy: rnd(0.3, 0.6), vz: rnd(-0.1, 0.1), life: 2.2, max: 2.2, size: 0.08, grow: 0.12, color: new THREE.Color('#d9d9e0') });
        break;
      case 'poof':
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          this.spawn({ x, y: rnd(0.3, 1.4), z, vx: Math.sin(a) * 1.6, vy: rnd(0, 0.6), vz: Math.cos(a) * 1.6, life: 0.6, max: 0.6, size: 0.14, grow: 0.25, color: new THREE.Color('#ffffff') });
        }
        break;
      case 'paint':
        for (let i = 0; i < 16; i++)
          this.spawn({ x, y, z, vx: rnd(-1.4, 1.4), vy: rnd(1, 3), vz: rnd(-1.4, 1.4), g: 9, life: 0.8, max: 0.8, size: 0.05, color: new THREE.Color('#e8b923') });
        break;
      case 'pills':
        for (let i = 0; i < 8; i++)
          this.spawn({ x, y, z, vx: rnd(-0.5, 0.5), vy: rnd(0.5, 1.5), vz: rnd(-0.5, 0.5), g: 6, life: 0.6, max: 0.6, size: 0.04, color: new THREE.Color('#c9a8ff') });
        break;
      case 'dust':
        for (let i = 0; i < 4; i++)
          this.spawn({ x, y: 0.05, z, vx: rnd(-0.4, 0.4), vy: rnd(0.2, 0.5), vz: rnd(-0.4, 0.4), life: 0.5, max: 0.5, size: 0.06, grow: 0.15, color: new THREE.Color('#e8e0d0') });
        break;
      case 'splash':
        for (let i = 0; i < 14; i++)
          this.spawn({ x, y: 0.1, z, vx: rnd(-1.5, 1.5), vy: rnd(1.5, 3.5), vz: rnd(-1.5, 1.5), g: 10, life: 0.7, max: 0.7, size: 0.06, color: new THREE.Color('#bfe8f5') });
        break;
      case 'fireworks': {
        const hue = Math.random();
        const n = 60;
        for (let i = 0; i < n; i++) {
          const u = Math.random() * 2 - 1;
          const th = Math.random() * Math.PI * 2;
          const r = Math.sqrt(1 - u * u);
          const sp = rnd(5, 7.5);
          const c = new THREE.Color().setHSL((hue + (i % 3) * 0.08) % 1, 0.9, 0.62);
          this.spawn({ x, y, z, vx: Math.cos(th) * r * sp, vy: u * sp, vz: Math.sin(th) * r * sp, g: 3, life: rnd(1.4, 2), max: 2, size: 0.16, color: c });
        }
        break;
      }
      case 'confetti':
        for (let i = 0; i < 40; i++)
          this.spawn({ x, y: 2, z, vx: rnd(-3, 3), vy: rnd(2, 6), vz: rnd(-3, 3), g: 6, life: 2, max: 2, size: 0.06, color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6) });
        break;
    }
  }

  private npcCone(n: Npc): { show: boolean; color: THREE.Color; alpha: number } {
    const k = n.knowledge;
    const b = n.behavior.name;
    if (!n.awake || !n.active) return { show: false, color: COLORS.calm, alpha: 0 };
    if (b === 'chase') return { show: true, color: COLORS.red, alpha: 0.6 };
    if (b === 'confront' || b === 'search' || b === 'lockdown' || b === 'alarm') return { show: true, color: COLORS.orange, alpha: 0.55 };
    if (k.suspicion > 0.03 && (k.seesPlayer || b === 'notice')) {
      const c = k.suspicion > 0.6 ? COLORS.orange : COLORS.yellow;
      return { show: true, color: c, alpha: 0.4 + k.suspicion * 0.25 };
    }
    if (b === 'investigate') return { show: true, color: COLORS.yellow, alpha: 0.45 };
    if (this.instinct) return { show: true, color: n.isGuard ? COLORS.guard : n.role === 'staff' ? COLORS.staff : COLORS.guest, alpha: n.isGuard ? 0.5 : 0.36 };
    if (n.isGuard && n.knowledge.wary > 0) return { show: true, color: COLORS.guard, alpha: 0.3 };
    return { show: false, color: COLORS.calm, alpha: 0 };
  }

  update(dt: number, markerTarget: V2 | null, markerDisabled: boolean, focus: V2) {
    const w = this.w;
    this.t += dt;
    // NPC vision cones
    const used = new Set<string>();
    for (const n of w.npcs) {
      const dd = Math.hypot(n.pos.x - focus.x, n.pos.z - focus.z);
      if (dd > 26) continue;
      const s = this.npcCone(n);
      if (s.show) {
        let c = this.cones.get(n.id);
        if (!c) {
          c = new Cone(this.group);
          this.cones.set(n.id, c);
        }
        const vis = VISION[n.role];
        const lf = Math.max(0.45, lightFactor(w.lighting.at(n.pos)));
        c.set(w, n.pos, n.viewAngle, vis.half, vis.range * lf, s.color, s.alpha);
        // Peripheral vision: wider, shorter, fainter.
        let pc = this.peri.get(n.id);
        if (!pc) {
          pc = [new Cone(this.group), new Cone(this.group)];
          this.peri.set(n.id, pc);
        }
        const pr = vis.range * lf * 0.45;
        pc[0].set(w, n.pos, n.viewAngle - vis.half - 0.375, 0.375, pr, s.color, s.alpha * 0.55);
        pc[1].set(w, n.pos, n.viewAngle + vis.half + 0.375, 0.375, pr, s.color, s.alpha * 0.55);
        used.add(n.id);
      }
      // Flashlights
      if (n.flashlightOn) {
        let f = this.flashes.get(n.id);
        if (!f) {
          f = new Cone(this.group, true);
          this.flashes.set(n.id, f);
        }
        f.set(w, n.pos, n.viewAngle, FLASH.half, FLASH.range, COLORS.flash, 2.4, 0.06);
        used.add('f:' + n.id);
      }
    }
    for (const [id, c] of this.cones) if (!used.has(id)) c.mesh.visible = false;
    for (const [id, pc] of this.peri)
      if (!used.has(id)) {
        pc[0].mesh.visible = false;
        pc[1].mesh.visible = false;
      }
    for (const [id, c] of this.flashes) if (!used.has('f:' + id)) c.mesh.visible = false;

    // Security cameras
    const powered = w.security.camsPowered(w);
    w.security.cams.forEach((cam, i) => {
      const m = this.camModels[i];
      m.body.rotation.y = cam.angle;
      const ledCol = !powered ? '#333' : cam.meter > 0.9 ? '#ff3030' : cam.meter > 0.05 ? '#ffb030' : Math.sin(this.t * 4 + i) > 0 ? '#3dff7a' : '#1d8a40';
      (m.led.material as THREE.MeshBasicMaterial).color.set(ledCol);
      const cone = this.camCones[i];
      if (powered && Math.hypot(cam.pos.x - focus.x, cam.pos.z - focus.z) < 28) {
        const color = cam.meter > 0.6 ? COLORS.red : cam.meter > 0.05 ? COLORS.orange : COLORS.cam;
        cone.set(w, cam.pos, cam.angle, cam.fov / 2, cam.range, color, cam.meter > 0.05 ? 0.55 : 0.34, 0.045);
      } else cone.mesh.visible = false;
    });

    // Rings
    for (const r of this.rings) {
      if (r.t >= r.max) {
        r.mesh.visible = false;
        continue;
      }
      r.t += dt;
      const k = Math.min(1, r.t / r.max);
      const rad = Math.max(0.2, r.radius * (0.15 + 0.85 * (1 - (1 - k) * (1 - k))));
      r.mesh.scale.set(rad, rad, rad);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }

    // Particles
    let n = 0;
    const d = this.dummy;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy = 0;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      p.size += p.grow * dt;
      const k = Math.min(1, p.life / (p.max * 0.4));
      d.position.set(p.x, p.y, p.z);
      const s = p.size * k;
      d.scale.set(s, s, s);
      d.updateMatrix();
      this.pMesh.setMatrixAt(n, d.matrix);
      this.pMesh.setColorAt(n, p.color);
      n++;
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    // A carried duck glitters (and everybody notices).
    const p = w.player;
    if (!p.gone && !p.hidden && w.playerStatus.duckVisible && Math.random() < dt * 14) {
      this.spawn({
        x: p.pos.x + (Math.random() - 0.5) * 0.7,
        y: 0.9 + Math.random() * 0.9,
        z: p.pos.z + (Math.random() - 0.5) * 0.7,
        vy: 0.6,
        life: 0.7,
        max: 0.7,
        size: 0.06,
        color: new THREE.Color('#ffe066'),
      });
    }
    // Player ring
    this.playerRing.visible = !p.gone && !p.hidden;
    this.playerRing.position.set(p.pos.x, 0.06, p.pos.z);
    const chased = p.chasers.size > 0;
    const noticed = [...p.noticedBy.values()].reduce((a, b) => Math.max(a, b), 0);
    const ringCol = chased ? '#ff4a4a' : noticed > 0.5 ? '#ff9a3c' : noticed > 0.05 ? '#ffd84a' : w.playerStatus.trespass || w.playerStatus.illegal ? '#ffb070' : '#7ff0c0';
    (this.playerRing.material as THREE.MeshBasicMaterial).color.set(ringCol);
    const pulse = 1 + Math.sin(this.t * (chased ? 10 : 3)) * 0.06;
    this.playerRing.scale.set(pulse, pulse, pulse);

    // Interaction marker
    if (markerTarget) {
      this.marker.visible = true;
      this.marker.position.set(markerTarget.x, 1.9 + Math.sin(this.t * 4) * 0.1, markerTarget.z);
      this.marker.rotation.y += dt * 2;
      (this.marker.material as THREE.MeshBasicMaterial).color.set(markerDisabled ? '#9a9aa8' : '#ffd84a');
    } else this.marker.visible = false;
  }
}
