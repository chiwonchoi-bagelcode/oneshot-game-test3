// Trailer-scale rendering of the game's fireworks: the simulation (Director) decides when and where
// every burst happens and emits the same 'fx' events the game uses; the game draws them as small
// particles meant for its close top-down camera, so wide trailer shots draw them bigger and glowing.
import * as THREE from 'three';
import type { World } from '../../src/sim/World';

const MAX = 6000;

export class TrailerFireworks {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private max = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3);
  private n = 0;
  private geo = new THREE.BufferGeometry();

  constructor(w: World, private scale = 1) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 900 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC * a * 1.6, a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    w.events.on('fx', (e) => {
      if (e.kind === 'fireworks') this.burst(e.x, e.y ?? 8, e.z);
    });
  }

  burst(x: number, y: number, z: number) {
    const hue = Math.random();
    const count = 220;
    const sp0 = (6 + Math.random() * 2.5) * this.scale;
    for (let i = 0; i < count; i++) {
      if (this.n >= MAX) this.n = 0;
      const k = this.n++;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = sp0 * (0.75 + Math.random() * 0.3);
      this.vel[k * 3] = Math.cos(th) * r * sp;
      this.vel[k * 3 + 1] = u * sp;
      this.vel[k * 3 + 2] = Math.sin(th) * r * sp;
      this.pos[k * 3] = x;
      this.pos[k * 3 + 1] = y;
      this.pos[k * 3 + 2] = z;
      const c = new THREE.Color().setHSL((hue + (i % 3) * 0.07) % 1, 0.95, 0.62);
      this.base[k * 3] = c.r;
      this.base[k * 3 + 1] = c.g;
      this.base[k * 3 + 2] = c.b;
      this.max[k] = this.life[k] = 1.6 + Math.random() * 0.9;
    }
  }

  update(dt: number) {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.size[k] = 0;
        continue;
      }
      this.life[k] -= dt;
      const drag = Math.exp(-1.6 * dt);
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * drag - 2.6 * dt;
      this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const f = Math.max(0, this.life[k] / this.max[k]);
      const tw = 0.75 + 0.25 * Math.sin(k * 12.9 + this.life[k] * 30);
      const fl = Math.min(1, f * 1.6) * tw;
      this.col[k * 3] = this.base[k * 3] * fl + (1 - f) * 0.05;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * fl;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * fl;
      this.size[k] = (0.22 + 0.25 * f) * this.scale;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
