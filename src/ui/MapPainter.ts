// 2D map rendering for the minimap and the journal map.
import { dist, type V2 } from '../core/math';
import { E_CRAWL, E_DOOR, E_FENCE, E_HEDGE, E_WALL, E_WINDOW } from '../sim/level/types';
import type { World } from '../sim/World';

const S = 6; // px per metre in the static image

export class MapPainter {
  readonly img: HTMLCanvasElement;
  constructor(private w: World) {
    const G = w.grid;
    this.img = document.createElement('canvas');
    this.img.width = G.w * S;
    this.img.height = G.h * S;
    const c = this.img.getContext('2d')!;
    for (let z = 0; z < G.h; z++) {
      for (let x = 0; x < G.w; x++) {
        const ri = G.room[x + z * G.w];
        const r = ri >= 0 ? G.rooms[ri] : null;
        let col = '#2b2a33';
        if (r) {
          if (r.floor === 'water') col = '#4f8fa8';
          else if (r.indoor) col = r.zone === 'public' ? '#eadcc0' : r.zone === 'staff' ? '#c9d6c0' : '#e7b3a8';
          else if (r.zone === 'street') col = '#5a5f6e';
          else if (r.zone === 'staff') col = '#8f8c84';
          else col = '#86a764';
        }
        if (G.isBlockedCell(x, z) && r && r.floor !== 'water') col = r.indoor ? '#bfae90' : '#5f7f48';
        c.fillStyle = col;
        c.fillRect(x * S, z * S, S, S);
      }
    }
    const edge = (x0: number, z0: number, x1: number, z1: number, k: number) => {
      if (k === E_WALL) c.strokeStyle = '#2b2a33';
      else if (k === E_WINDOW) c.strokeStyle = '#9fd3e6';
      else if (k === E_DOOR) c.strokeStyle = '#c49a6c';
      else if (k === E_HEDGE) c.strokeStyle = '#3f6b36';
      else if (k === E_FENCE) c.strokeStyle = '#f4efe6';
      else if (k === E_CRAWL) c.strokeStyle = '#ffd84a';
      else return;
      c.lineWidth = k === E_WALL ? 2 : 2.5;
      c.beginPath();
      c.moveTo(x0 * S, z0 * S);
      c.lineTo(x1 * S, z1 * S);
      c.stroke();
    };
    for (let z = 0; z <= G.h; z++) for (let x = 0; x < G.w; x++) edge(x, z, x + 1, z, G.hKind(x, z));
    for (let z = 0; z < G.h; z++) for (let x = 0; x <= G.w; x++) edge(x, z, x, z + 1, G.vKind(x, z));
  }

  private dyn(c: CanvasRenderingContext2D, scale: number, ox: number, oz: number, big: boolean) {
    const w = this.w;
    const p = w.player;
    const P = (v: V2) => ({ x: (v.x - ox) * scale, y: (v.z - oz) * scale });
    // Points of interest
    const poi = (v: V2, ch: string, size = 13) => {
      const q = P(v);
      c.font = `${size}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(ch, q.x, q.y);
    };
    if (w.flags.sawDuck || big) poi({ x: 36, z: 18 }, w.caseItem?.type === 'golden_duck' ? '🦆' : '⬜', big ? 16 : 13);
    poi({ x: 36, z: 59.5 }, '🚪');
    poi({ x: 4.5, z: 59.5 }, '🚪');
    if (w.stats.intel.has('intel_hedge')) poi({ x: 68.5, z: 59.5 }, '🕳️');
    poi({ x: 61, z: 1 }, '🚣');
    if (w.stats.intel.has('intel_van') || p.hasItem('key_van')) poi({ x: 3.5, z: 26.5 }, '🚐');
    if (w.stats.intel.has('intel_fusebox') || w.stats.intel.has('intel_alarm')) poi({ x: 14.5, z: 15 }, '⚡', 11);
    // Cameras
    if (w.security.camsPowered(w)) {
      for (const cam of w.security.cams) {
        const q = P(cam.pos);
        c.fillStyle = cam.meter > 0.05 ? '#ff4a4a' : '#d7f0ff';
        c.beginPath();
        c.arc(q.x, q.y, 2.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    // NPCs the player can currently perceive (in sight or very close)
    for (const n of w.npcs) {
      if (!n.active) continue;
      const d = dist(n.pos, p.pos);
      if (d > 22) continue;
      if (d > 3 && !w.grid.los(p.pos, n.pos)) continue;
      const q = P(n.pos);
      const b = n.behavior.name;
      c.fillStyle = !n.awake
        ? '#8a8aa0'
        : b === 'chase'
          ? '#ff3030'
          : b === 'confront' || b === 'search' || b === 'report'
            ? '#ff9a3c'
            : n.isGuard
              ? '#5b8cff'
              : n.role === 'staff'
                ? '#7bd389'
                : n.role === 'host'
                  ? '#ffd84a'
                  : '#ffffff';
      c.beginPath();
      c.arc(q.x, q.y, big ? 3.5 : 3, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 1;
      c.stroke();
    }
    // Player arrow
    if (!p.gone) {
      const q = P(p.pos);
      c.save();
      c.translate(q.x, q.y);
      c.rotate(-p.facing + Math.PI);
      c.fillStyle = '#7ff0c0';
      c.strokeStyle = '#123';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, -7);
      c.lineTo(5, 5);
      c.lineTo(0, 2.5);
      c.lineTo(-5, 5);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  drawMini(c: CanvasRenderingContext2D, W: number, H: number, center: V2) {
    const scale = 4.2;
    const ox = center.x - W / 2 / scale;
    const oz = center.z - H / 2 / scale;
    c.fillStyle = '#5f7f48';
    c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.img, ox * S, oz * S, (W / scale) * S, (H / scale) * S, 0, 0, W, H);
    this.dyn(c, scale, ox, oz, false);
  }

  drawFull(c: CanvasRenderingContext2D, W: number, H: number) {
    const G = this.w.grid;
    const scale = Math.min(W / G.w, H / G.h);
    c.fillStyle = '#2b2a33';
    c.fillRect(0, 0, W, H);
    c.drawImage(this.img, 0, 0, G.w * scale, G.h * scale);
    c.font = `${Math.round(scale * 1.15)}px Jua, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const r of G.rooms) {
      if (r.id === 'lake' || r.id === 'dock') continue;
      const [x0, z0, x1, z1] = r.rect;
      const x = ((x0 + x1) / 2) * scale;
      const y = ((z0 + z1) / 2) * scale;
      c.fillStyle = r.indoor ? '#2b2a33' : 'rgba(255,255,255,0.85)';
      const label = r.name;
      if (r.id === 'backgarden') c.fillText(label, x, 11 * scale);
      else if (r.id === 'frontyard') c.fillText(label, x, 52 * scale);
      else c.fillText(label, x, y);
    }
    this.dyn(c, scale, 0, 0, true);
  }
}
