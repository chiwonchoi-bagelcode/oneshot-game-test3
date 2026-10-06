// Meshes for loose items (ducks, gift boxes, bottles...).
import * as THREE from 'three';
import type { Item } from '../sim/Items';
import type { ItemType } from '../sim/rules';
import { GeoBuilder } from './geo';
import type { Mats } from './materials';

const GIFT = [
  ['#e05a5a', '#f2d16b'],
  ['#5a8be0', '#f4f1ea'],
  ['#7bc47f', '#e05a5a'],
];

export function buildItemGeo(type: ItemType, variant = 0): GeoBuilder {
  const g = new GeoBuilder();
  switch (type) {
    case 'golden_duck':
    case 'fake_duck': {
      const c = type === 'golden_duck' ? '#e8b923' : '#f2c63a';
      const beak = type === 'golden_duck' ? '#d8941a' : '#f29a2a';
      g.add('sphere', 0, 0.15, 0, 0.2, 0.14, 0.26, c);
      g.add('sphere', 0, 0.33, 0.14, 0.11, 0.11, 0.11, c);
      g.add('cone', 0, 0.31, 0.27, 0.05, 0.1, 0.05, beak, 0, Math.PI / 2);
      g.add('sphere', 0, 0.22, -0.2, 0.08, 0.07, 0.06, c);
      g.add('sphere', 0.07, 0.36, 0.22, 0.018, 0.018, 0.018, '#2b1d14');
      g.add('sphere', -0.07, 0.36, 0.22, 0.018, 0.018, 0.018, '#2b1d14');
      g.add('cyl', 0, 0.01, 0, 0.17, 0.02, 0.2, c);
      break;
    }
    case 'rubber_duck':
      g.add('sphere', 0, 0.07, 0, 0.09, 0.07, 0.11, '#ffd23f');
      g.add('sphere', 0, 0.15, 0.06, 0.055, 0.055, 0.055, '#ffd23f');
      g.add('cone', 0, 0.14, 0.12, 0.025, 0.05, 0.025, '#f28a2a', 0, Math.PI / 2);
      break;
    case 'gift_box': {
      const [a, b] = GIFT[variant % GIFT.length];
      g.box(0, 0, 0, 0.42, 0.34, 0.42, a);
      g.box(0, 0, 0, 0.44, 0.35, 0.08, b);
      g.box(0, 0, 0, 0.08, 0.35, 0.44, b);
      g.add('sphere', 0, 0.38, 0, 0.09, 0.06, 0.09, b);
      break;
    }
    case 'tray':
      g.add('cyl', 0, 0.02, 0, 0.3, 0.03, 0.3, '#d9dde2');
      g.add('sphere', 0, 0.04, 0, 0.22, 0.18, 0.22, '#e8ecf0');
      g.add('sphere', 0, 0.24, 0, 0.035, 0.035, 0.035, '#c9a24a');
      break;
    case 'bottle':
      g.add('cyl', 0, 0.14, 0, 0.065, 0.28, 0.065, '#2f6f4f');
      g.add('cyl', 0, 0.33, 0, 0.025, 0.12, 0.025, '#2f6f4f');
      g.add('cyl', 0, 0.12, 0, 0.068, 0.08, 0.068, '#f4efe6');
      break;
    case 'vase':
      g.add('sphere', 0, 0.16, 0, 0.13, 0.17, 0.13, '#5f8fd0');
      g.add('cyl', 0, 0.36, 0, 0.06, 0.12, 0.06, '#f4f1ea');
      g.add('sphere', 0, 0.48, 0, 0.12, 0.08, 0.12, '#f28fa8');
      break;
    case 'shards':
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1;
        g.add('box', Math.sin(a) * 0.18, 0.01, Math.cos(a) * 0.15, 0.08, 0.015, 0.05, i % 2 ? '#cfefff' : '#2f6f4f', a);
      }
      break;
    case 'wrench':
      g.add('box', 0, 0.02, 0, 0.06, 0.03, 0.34, '#8d949c');
      g.add('cyl', 0, 0.02, 0.18, 0.06, 0.03, 0.06, '#8d949c');
      break;
    case 'gold_paint':
      g.add('cyl', 0, 0.09, 0, 0.09, 0.18, 0.09, '#d9b44a');
      g.add('cyl', 0, 0.185, 0, 0.092, 0.02, 0.092, '#a8873a');
      break;
    case 'sleeping_pills':
    case 'laxative':
      g.add('cyl', 0, 0.06, 0, 0.04, 0.12, 0.04, type === 'laxative' ? '#7bc47f' : '#9b7fc9');
      g.add('cyl', 0, 0.13, 0, 0.042, 0.03, 0.042, '#ffffff');
      break;
    case 'lighter':
      g.box(0, 0, 0, 0.05, 0.09, 0.025, '#d33');
      break;
    case 'invitation':
      g.box(0, 0, 0, 0.22, 0.01, 0.15, '#fbf7ef');
      g.box(0, 0.011, 0, 0.05, 0.005, 0.05, '#c0392b');
      break;
    default:
      // keys
      g.add('torus', 0, 0.02, -0.04, 0.035, 0.035, 0.12, '#d9b44a', 0, Math.PI / 2);
      g.box(0, 0, 0.04, 0.02, 0.02, 0.1, '#d9b44a');
  }
  return g;
}

export class ItemView {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Object3D>();
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private t = 0;
  constructor(private mats: Mats) {}

  private geo(type: ItemType, variant: number) {
    const k = type + ':' + variant;
    let g = this.geoCache.get(k);
    if (!g) {
      g = buildItemGeo(type, variant).build();
      this.geoCache.set(k, g);
    }
    return g;
  }

  update(dt: number, items: Item[]) {
    this.t += dt;
    const seen = new Set<number>();
    for (const it of items) {
      const show = it.state === 'ground' || it.state === 'display' || it.state === 'flying';
      if (!show) continue;
      seen.add(it.id);
      let m = this.meshes.get(it.id);
      if (!m) {
        const mat = it.type === 'golden_duck' ? new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#5a3a00' }) : this.mats.vertex;
        if (it.type === 'golden_duck') this.mats.lm.patch(mat);
        const mesh = new THREE.Mesh(this.geo(it.type, it.variant), mat);
        mesh.castShadow = true;
        m = mesh;
        this.meshes.set(it.id, m);
        this.group.add(m);
      }
      m.position.set(it.pos.x, it.y, it.pos.z);
      if (it.state === 'display') {
        m.rotation.y = this.t * 0.6;
        m.position.y = it.y + Math.sin(this.t * 1.5) * 0.02;
      } else if (it.state === 'flying') {
        m.rotation.x += dt * it.spin;
        m.rotation.z += dt * it.spin * 0.6;
      } else {
        m.rotation.x = 0;
        m.rotation.z = 0;
        m.rotation.y = (it.id * 1.7) % (Math.PI * 2);
      }
      m.visible = true;
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) m.visible = false;
    }
  }
}
