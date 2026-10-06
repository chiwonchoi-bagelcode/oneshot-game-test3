// DOM layers drawn over the 3D canvas: the game's own speech bubbles and suspicion icons
// (same CSS as the game, scaled for 1080p), plus trailer typography. Everything is driven by the
// trailer clock (no CSS animations / timers) so every rendered frame is deterministic.
import { REASON_LABEL_KO } from './labels';
import type { World } from '../../src/sim/World';
import type { TrailerView } from './TrailerView';

export const W = 1920;
export const H = 1080;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

interface Bubble {
  el: HTMLDivElement;
  id: string;
  born: number;
  until: number;
  kind: string;
}

export interface BubbleRules {
  /** Which speakers may show bubbles ('*' = everyone). */
  allow?: string[] | '*';
  /** Hide bubbles whose text matches. */
  deny?: RegExp;
  /** Force a minimum display time. */
  minDur?: number;
  scale?: number;
  icons?: boolean;
  /** Only these NPCs show suspicion icons. */
  iconAllow?: string[] | '*';
}

/** World-anchored bubbles & icons, fed by the shot's World. */
export class WorldUi {
  readonly root = el('div', 'world-ui');
  private bubbles = new Map<string, Bubble>();
  private icons = new Map<string, HTMLDivElement>();
  private unsub: (() => void)[] = [];
  now = 0;
  muted = false;
  rules: BubbleRules = { allow: '*', icons: true };

  constructor(parent: HTMLElement) {
    parent.append(this.root);
  }

  attach(w: World, rules: BubbleRules) {
    this.detach();
    this.rules = rules;
    this.unsub.push(w.events.on('bark', (e) => this.bark(e.id, e.text, e.dur, e.kind)));
  }

  detach() {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.root.innerHTML = '';
    this.bubbles.clear();
    this.icons.clear();
    this.queue = [];
  }

  clearBubbles() {
    for (const b of this.bubbles.values()) b.el.remove();
    this.bubbles.clear();
    this.queue = [];
  }

  private queue: { id: string; text: string; dur: number; kind: string; at: number }[] = [];

  bark(id: string, text: string, dur: number, kind: string) {
    if (this.muted) return;
    const r = this.rules;
    if (r.allow !== '*' && r.allow && !r.allow.includes(id)) return;
    if (r.deny && r.deny.test(text)) return;
    // The game shows one bubble per speaker, so two lines said in the same instant overwrite each
    // other (e.g. the host's discovery + scream). Let the first one be read before the second.
    const cur = this.bubbles.get(id);
    const pending = this.queue.filter((q) => q.id === id);
    const MIN_SHOW = 2.1;
    if ((cur && this.now - cur.born < MIN_SHOW) || pending.length) {
      const at = Math.max(cur ? cur.born + MIN_SHOW : this.now, ...pending.map((q) => q.at + MIN_SHOW));
      this.queue.push({ id, text, dur, kind, at });
      return;
    }
    this.show(id, text, dur, kind);
  }

  private show(id: string, text: string, dur: number, kind: string) {
    const r = this.rules;
    let b = this.bubbles.get(id);
    if (!b) {
      b = { el: el('div', 'bubble'), id, born: this.now, until: 0, kind };
      this.root.append(b.el);
      this.bubbles.set(id, b);
    }
    b.el.className = 'bubble ' + kind;
    b.el.textContent = text;
    b.born = this.now;
    b.until = this.now + Math.max(dur, r.minDur ?? 0);
    b.kind = kind;
  }

  update(dt: number, w: World, v: TrailerView) {
    this.now += dt;
    for (const q of this.queue.filter((x) => x.at <= this.now)) this.show(q.id, q.text, q.dur, q.kind);
    this.queue = this.queue.filter((x) => x.at > this.now);
    const p = w.player;
    const scale = this.rules.scale ?? 2.0;
    const posOf = (id: string) => (id === 'player' ? (p.gone ? null : p.pos) : w.npc(id)?.pos ?? null);
    for (const [id, b] of this.bubbles) {
      const pos = posOf(id);
      if (!pos || this.now > b.until) {
        b.el.remove();
        this.bubbles.delete(id);
        continue;
      }
      const s = v.project(pos.x, v.headTop(id) + 0.42, pos.z, W, H);
      if (s.behind || s.x < -200 || s.x > W + 200 || s.y < -100 || s.y > H + 200) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      // Cinematic framing: keep the whole bubble on screen (close-ups put heads near the top edge).
      const bh = b.el.offsetHeight * scale;
      const bw = b.el.offsetWidth * scale;
      s.y = Math.max(s.y, bh + 24);
      s.x = Math.min(Math.max(s.x, bw / 2 + 24), W - bw / 2 - 24);
      const age = this.now - b.born;
      const pop = age < 0.18 ? 0.6 + 0.4 * Math.sin((age / 0.18) * Math.PI * 0.5) * 1.08 : 1;
      const fade = this.now > b.until - 0.25 ? Math.max(0, (b.until - this.now) / 0.25) : 1;
      b.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%) scale(${(scale * pop).toFixed(3)})`;
      b.el.style.transformOrigin = '50% 100%';
      b.el.style.opacity = fade.toFixed(3);
    }
    // Suspicion / alert icons over heads (the game's "? / !" meters).
    const seen = new Set<string>();
    if (this.rules.icons !== false) {
      for (const n of w.npcs) {
        if (!n.active || !n.icon) continue;
        const ia = this.rules.iconAllow;
        if (ia && ia !== '*' && !ia.includes(n.id)) continue;
        const hasBubble = this.bubbles.has(n.id) && this.bubbles.get(n.id)!.el.style.display !== 'none';
        const s = v.project(n.pos.x, v.headTop(n.id) + (hasBubble ? 1.55 : 0.6), n.pos.z, W, H);
        if (!s.behind && s.y < 90 && s.y > -400) s.y = 90;
        if (s.behind || s.x < -100 || s.x > W + 100 || s.y < -100 || s.y > H + 100) continue;
        let e = this.icons.get(n.id);
        if (!e) {
          e = el('div', 'npc-icon');
          this.root.append(e);
          this.icons.set(n.id, e);
        }
        const ic = n.icon;
        const why = ic.meter !== undefined && ic.meter > 0.12 ? REASON_LABEL_KO[n.knowledge.reason] ?? '' : '';
        const key = `${ic.g}|${ic.color}|${ic.meter === undefined ? '' : Math.round(ic.meter * 20)}|${why}`;
        if (e.dataset.k !== key) {
          e.dataset.k = key;
          e.className = 'npc-icon c-' + ic.color;
          const ring =
            ic.meter !== undefined
              ? `<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="rgba(255,255,255,0.85)" stroke="rgba(0,0,0,0.25)" stroke-width="3"/><circle cx="17" cy="17" r="14" fill="none" stroke="${ic.meter > 0.6 ? '#ff7a1a' : '#e8b400'}" stroke-width="4" stroke-dasharray="${(ic.meter * 88).toFixed(1)} 88" transform="rotate(-90 17 17)" stroke-linecap="round"/></svg>`
              : '';
          e.innerHTML = `${ring}<span class="g">${ic.g}</span>${why ? `<span class="why">${why}</span>` : ''}`;
        }
        const pulse = ic.color === 'red' ? 1 + 0.12 * Math.abs(Math.sin(this.now * 6.3)) : 1;
        e.style.transform = `translate(${s.x}px, ${s.y}px) scale(${(scale * pulse).toFixed(3)})`;
        e.style.display = '';
        seen.add(n.id);
      }
    }
    for (const [id, e] of this.icons) if (!seen.has(id)) e.style.display = 'none';
  }
}

/** A typographic element with a per-frame animation function. */
export interface Title {
  start: number;
  end: number;
  build(): HTMLElement;
  /** lt = local time since start; u = 0..1 progress. */
  anim(e: HTMLElement, lt: number, u: number): void;
  el?: HTMLElement;
}

export class TitleLayer {
  readonly root = el('div', 'titles');
  constructor(
    parent: HTMLElement,
    private titles: Title[],
  ) {
    parent.append(this.root);
  }
  update(t: number) {
    for (const ti of this.titles) {
      const on = t >= ti.start && t < ti.end;
      if (on && !ti.el) {
        ti.el = ti.build();
        this.root.append(ti.el);
      }
      if (!on && ti.el) {
        ti.el.remove();
        ti.el = undefined;
      }
      if (on && ti.el) ti.anim(ti.el, t - ti.start, (t - ti.start) / (ti.end - ti.start));
    }
  }
}

export { el };
