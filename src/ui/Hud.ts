// HUD and world-anchored UI (speech bubbles, alert icons, edge arrows, minimap...).
import { clamp, dist, fmtClock, type V2 } from '../core/math';
import { INTEL, TODOS } from '../sim/level/content';
import type { BarkKind } from '../sim/events';
import type { OutfitId } from '../sim/level/types';
import { ITEMS, OUTFITS, ZONE_NAMES } from '../sim/rules';
import type { World } from '../sim/World';
import type { GameView } from '../view/GameView';
import { MapPainter } from './MapPainter';

interface Bubble {
  el: HTMLDivElement;
  id: string;
  until: number;
  kind: BarkKind;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const OUTFIT_ORDER: OutfitId[] = ['guest', 'waiter', 'chef', 'guard', 'electrician'];

/** Why someone is getting suspicious (shown under their ? meter). */
const REASON_LABEL: Record<string, string> = {
  trespass: '구역 침입',
  disguise: '변장 의심',
  uninvited: '초대 명단?',
  behavior: '수상한 행동',
  item: '이상한 물건',
  lockdown: '봉쇄 위반',
  crime: '범행 목격!',
  duck: '황금 오리!',
  recognized: '수배범!',
};

export class Hud {
  private worldEl: HTMLElement;
  private hudEl: HTMLElement;
  private bubbles = new Map<string, Bubble>();
  private icons = new Map<string, HTMLDivElement>();
  private tags = new Map<string, HTMLDivElement>();
  private arrows: HTMLDivElement[] = [];
  private todoEl = h('div', 'todo');
  private statusEl = h('div', 'status');
  private outfitEl = h('div', 'outfit-card');
  private invEl = h('div', 'inventory');
  private promptEl = h('div', 'prompt');
  private progressEl = h('div', 'progress');
  private toastsEl = h('div', 'toasts');
  private miniEl = h('div', 'minimap');
  private miniCanvas = h('canvas');
  private miniLabel = h('div', 'room-label');
  private keysEl = h('div', 'keys-hint');
  private veil = h('div', 'instinct-veil');
  private danger = h('div', 'danger-veil');
  private hideVeil = h('div', 'hide-veil', '<div class="hide-label">🫥 숨어 있다 — 방향키나 E로 나오기</div>');
  private intelPop: HTMLDivElement | null = null;
  private intelPopUntil = 0;
  private recentTodo: { id: string; until: number } | null = null;
  private lastKeys = { todo: '', status: '', outfit: '', inv: '', prompt: '', progress: '' };
  private painter: MapPainter;
  private unsub: (() => void)[] = [];
  private now = 0;

  constructor(
    private w: World,
    private view: GameView,
  ) {
    this.worldEl = document.getElementById('world-ui')!;
    this.hudEl = document.getElementById('hud')!;
    this.worldEl.innerHTML = '';
    this.hudEl.innerHTML = '';
    this.miniCanvas.width = 230;
    this.miniCanvas.height = 176;
    this.miniEl.append(this.miniCanvas, this.miniLabel);
    this.keysEl.innerHTML =
      '<b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>C</b> 웅크리기 · <b>E</b> 행동 · <b>R</b> 선택 바꾸기 · <b>Q</b> 던지기 · <b>G</b> 내려놓기 · <b>Space</b> 휘파람 · <b>V</b> 관찰 · <b>1~5</b> 옷 갈아입기 · <b>Tab</b> 수첩 · <b>Esc</b> 메뉴';
    this.veil.style.display = 'none';
    this.danger.style.display = 'none';
    this.progressEl.style.display = 'none';
    this.hideVeil.style.display = 'none';
    this.hudEl.append(this.veil, this.danger, this.hideVeil, this.todoEl, this.statusEl, this.outfitEl, this.invEl, this.promptEl, this.progressEl, this.toastsEl, this.miniEl, this.keysEl);
    this.painter = new MapPainter(w);

    this.unsub.push(
      w.events.on('bark', (e) => this.bark(e.id, e.text, e.dur, e.kind)),
      w.events.on('notify', (e) => this.toast(e.text, e.kind)),
      w.events.on('intel', (e) => this.showIntel(e.id, e.title)),
      w.events.on('todo', (e) => {
        const def = TODOS.find((t) => t.id === e.id);
        if (def && !def.main) this.recentTodo = { id: e.id, until: this.now + 6 };
        if (def) this.toast(`✏️ 할 일 완료: ${def.text}`, 'good');
      }),
    );
  }

  dispose() {
    for (const u of this.unsub) u();
    this.worldEl.innerHTML = '';
    this.hudEl.innerHTML = '';
  }

  setVisible(v: boolean) {
    this.hudEl.style.display = v ? '' : 'none';
    this.worldEl.style.display = v ? '' : 'none';
  }

  // ---------------------------------------------------------------------------
  private bark(id: string, text: string, dur: number, kind: BarkKind) {
    let b = this.bubbles.get(id);
    if (!b) {
      b = { el: h('div', 'bubble'), id, until: 0, kind };
      this.worldEl.append(b.el);
      this.bubbles.set(id, b);
    }
    b.el.className = 'bubble ' + kind;
    b.el.textContent = text;
    b.until = this.now + dur;
    b.kind = kind;
  }

  toast(text: string, kind: string) {
    const t = h('div', 'toast ' + kind);
    t.textContent = text;
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 6) this.toastsEl.lastChild?.remove();
    setTimeout(() => t.classList.add('fade'), kind === 'intel' ? 9000 : 5200);
    setTimeout(() => t.remove(), kind === 'intel' ? 9700 : 5900);
  }

  private showIntel(id: string, title: string) {
    this.intelPop?.remove();
    const def = INTEL.find((i) => i.id === id);
    this.intelPop = h('div', 'intel-pop', `👂 새 소문: <b>${title}</b><small>${def?.hint ?? ''} <i>(Tab: 수첩)</i></small>`);
    this.hudEl.append(this.intelPop);
    this.intelPopUntil = this.now + 6;
  }

  // ---------------------------------------------------------------------------
  update(dt: number, instinct: boolean) {
    this.now += dt;
    const w = this.w;
    const p = w.player;
    this.veil.style.display = instinct ? '' : 'none';
    // Key reminder fades out after the first minute (it is always in the journal/pause menu).
    this.keysEl.style.opacity = w.time < 60 ? '1' : '0';
    this.keysEl.style.transition = 'opacity 1.5s';
    this.danger.style.display = p.chasers.size > 0 || w.security.alarmOn ? '' : 'none';
    this.hideVeil.style.display = p.hidden ? '' : 'none';
    if (p.hidden) {
      const cls = 'hide-veil ' + (p.hidden.kind === 'bush' ? 'leafy' : p.hidden.kind === 'table' ? 'cloth' : 'slats');
      if (this.hideVeil.className !== cls) this.hideVeil.className = cls;
    }
    if (this.intelPop && this.now > this.intelPopUntil) {
      this.intelPop.remove();
      this.intelPop = null;
    }
    this.updateWorldUi(instinct);
    this.updateTodo();
    this.updateStatus();
    this.updateOutfit();
    this.updateInventory();
    this.updatePrompt();
    this.updateMinimap();
  }

  private updateWorldUi(instinct: boolean) {
    const w = this.w;
    const v = this.view;
    const p = w.player;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const posOf = (id: string): V2 | null => (id === 'player' ? p.pos : w.npc(id)?.pos ?? null);
    // Bubbles
    for (const [id, b] of this.bubbles) {
      const pos = posOf(id);
      if (!pos || this.now > b.until || (id === 'player' && p.gone)) {
        b.el.remove();
        this.bubbles.delete(id);
        continue;
      }
      const d = dist(pos, p.pos);
      const maxD = b.kind === 'alert' || b.kind === 'radio' || b.kind === 'speech' ? 30 : b.kind === 'intel' ? 14 : 17;
      const s = v.project(pos.x, v.headTop(id) + 0.45, pos.z);
      if (!s || d > maxD || s.x < -100 || s.x > W + 100 || s.y < -50 || s.y > H + 100) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      b.el.classList.toggle('far', d > 12 && b.kind !== 'alert');
      b.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      b.el.style.opacity = this.now > b.until - 0.3 ? '0' : '1';
    }
    // Icons + tags
    const seenIcons = new Set<string>();
    for (const n of w.npcs) {
      if (!n.active) continue;
      const d = dist(n.pos, p.pos);
      if (d > 28) continue;
      const hasBubble = this.bubbles.has(n.id) && this.bubbles.get(n.id)!.el.style.display !== 'none';
      if (n.icon) {
        const s = v.project(n.pos.x, v.headTop(n.id) + (hasBubble ? 1.25 : 0.55), n.pos.z);
        if (s) {
          let el = this.icons.get(n.id);
          if (!el) {
            el = h('div', 'npc-icon');
            this.worldEl.append(el);
            this.icons.set(n.id, el);
          }
          const ic = n.icon;
          const why = ic.meter !== undefined && ic.meter > 0.12 ? REASON_LABEL[n.knowledge.reason] ?? '' : '';
          const key = `${ic.g}|${ic.color}|${ic.meter === undefined ? '' : Math.round(ic.meter * 20)}|${why}`;
          if (el.dataset.k !== key) {
            el.dataset.k = key;
            el.className = 'npc-icon c-' + ic.color;
            const ring =
              ic.meter !== undefined
                ? `<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="rgba(255,255,255,0.85)" stroke="rgba(0,0,0,0.25)" stroke-width="3"/><circle cx="17" cy="17" r="14" fill="none" stroke="${ic.meter > 0.6 ? '#ff7a1a' : '#e8b400'}" stroke-width="4" stroke-dasharray="${(ic.meter * 88).toFixed(1)} 88" transform="rotate(-90 17 17)" stroke-linecap="round"/></svg>`
                : '';
            el.innerHTML = `${ring}<span class="g">${ic.g}</span>${why ? `<span class="why">${why}</span>` : ''}`;
          }
          el.style.transform = `translate(${s.x}px, ${s.y}px)`;
          el.style.display = '';
          seenIcons.add(n.id);
        }
      }
      // Instinct tags: names, roles and who sees through disguises.
      if (instinct && d < 24) {
        const s = v.project(n.pos.x, v.headTop(n.id) + (n.icon ? 1.05 : 0.45), n.pos.z);
        if (s) {
          let el = this.tags.get(n.id);
          if (!el) {
            el = h('div', 'tag');
            this.worldEl.append(el);
            this.tags.set(n.id, el);
          }
          const enf = n.enforces.has(p.outfit) && !(p.outfit === 'guest' && p.legit);
          el.className = 'tag' + (n.isGuard ? ' guard' : '') + (enf ? ' enforcer' : '');
          const keys = n.pockets.filter((i) => i.state === 'pocket').map((i) => ITEMS[i.type].icon).join('');
          el.textContent = `${n.name}${enf ? ' 👁 변장 간파' : ''}${keys ? ' ' + keys : ''}${!n.awake ? ' 💤' : ''}`;
          el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
          el.style.display = '';
        }
      }
    }
    for (const [id, el] of this.icons) if (!seenIcons.has(id)) el.style.display = 'none';
    for (const [id, el] of this.tags) {
      const n = w.npc(id);
      if (!instinct || !n || dist(n.pos, p.pos) >= 24) el.style.display = 'none';
    }
    // Contraband marker over the player's head.
    {
      let el = this.icons.get('player');
      const show = !p.gone && !p.hidden && w.playerStatus.duckVisible;
      if (show) {
        const s = v.project(p.pos.x, v.headTop('player') + 0.6, p.pos.z);
        if (s) {
          if (!el) {
            el = h('div', 'npc-icon c-red');
            el.innerHTML = '<span class="g" style="font-size:26px">🦆</span>';
            this.worldEl.append(el);
            this.icons.set('player', el);
          }
          el.style.transform = `translate(${s.x}px, ${s.y}px)`;
          el.style.display = '';
        }
      } else if (el) el.style.display = 'none';
      seenIcons.add('player');
    }
    // Edge arrows for off-screen watchers.
    const watchers = w.npcs.filter((n) => (p.noticedBy.get(n.id) ?? 0) > 0.05 || p.chasers.has(n.id));
    let ai = 0;
    for (const n of watchers) {
      const s = v.project(n.pos.x, 1, n.pos.z);
      if (!s) continue;
      const m = 40;
      if (s.x > m && s.x < W - m && s.y > m && s.y < H - m) continue;
      const cx = W / 2;
      const cy = H / 2;
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const ex = clamp(cx + Math.cos(ang) * W, m, W - m);
      const ey = clamp(cy + Math.sin(ang) * H, m, H - m);
      let a = this.arrows[ai];
      if (!a) {
        a = h('div', 'edge-arrow');
        this.worldEl.append(a);
        this.arrows.push(a);
      }
      const sus = p.chasers.has(n.id) ? 1 : p.noticedBy.get(n.id) ?? 0;
      a.style.borderBottomColor = sus >= 1 ? '#ff4a4a' : sus > 0.5 ? '#ff9a3c' : '#ffd84a';
      a.style.transform = `translate(${ex - 14}px, ${ey - 13}px) rotate(${ang + Math.PI / 2}rad)`;
      a.style.display = '';
      ai++;
    }
    for (; ai < this.arrows.length; ai++) this.arrows[ai].style.display = 'none';
  }

  private updateTodo() {
    const w = this.w;
    const done = w.stats.todos;
    const bonus = TODOS.filter((t) => !t.main);
    const bonusDone = bonus.filter((t) => done.has(t.id)).length;
    const recent = this.recentTodo && this.now < this.recentTodo.until ? this.recentTodo.id : '';
    const key = [...done].join(',') + '|' + recent;
    if (key === this.lastKeys.todo) return;
    this.lastKeys.todo = key;
    const main = TODOS.filter((t) => t.main)
      .map((t) => `<li class="${done.has(t.id) ? 'done' : ''}">${t.text}</li>`)
      .join('');
    // A few open bonus ideas (rotating as they get done) hint at other ways to play.
    const open = bonus.filter((t) => !done.has(t.id) && t.id !== 'ghost').slice(0, 3);
    const extra =
      (recent ? `<li class="done">${TODOS.find((t) => t.id === recent)!.text}</li>` : '') + open.map((t) => `<li>${t.text}</li>`).join('');
    this.todoEl.innerHTML = `<h3>할 일</h3><ul>${main}</ul><div class="bonus">그리고 덤으로… (${bonusDone}/${bonus.length})<ul>${extra}</ul></div><div class="hint">Tab: 수첩 (소문·지도·할 일)</div>`;
  }

  private updateStatus() {
    const w = this.w;
    const p = w.player;
    const noticed = [...p.noticedBy.values()].reduce((a, b) => Math.max(a, b), 0);
    let cls = 'calm';
    let text = '🎉 평온한 파티';
    if (w.security.lockdown) {
      cls = 'lockdown';
      text = '🚨 저택 봉쇄 중!';
    } else if (p.chasers.size) {
      cls = 'chase';
      text = '🏃 추격당하는 중!';
    } else if (w.security.alarmOn) {
      cls = 'chase';
      text = '🔔 경보 울리는 중!';
    } else if (w.searchers.size) {
      cls = 'search';
      text = '🔦 누군가를 찾는 중';
    } else if (noticed > 0.05) {
      cls = 'wary';
      text = '👀 누군가 나를 보고 있다';
    } else if (w.flags.fireAlarm) {
      cls = 'wary';
      text = '🔔 화재 대피 중';
    } else if (w.stats.theftKnownAt >= 0) {
      cls = 'search';
      text = '⚠ 도난 사실이 들통났다';
    }
    const offs = (['B', 'A', 'C'] as const).filter((c) => !w.power.on(c)).map((c) => ({ A: '서비스동', B: '본관', C: '보안' })[c]);
    const clock = fmtClock(w.time);
    const key = cls + text + offs.join() + clock;
    if (key === this.lastKeys.status) return;
    this.lastKeys.status = key;
    this.statusEl.innerHTML = `<div class="pill clock">🕰️ ${clock}</div><div class="pill ${cls}">${text}</div>${
      offs.length ? `<div class="power-row">${offs.map((o) => `<span>⚡ ${o} 정전</span>`).join('')}</div>` : ''
    }`;
  }

  private updateOutfit() {
    const w = this.w;
    const p = w.player;
    const st = w.playerStatus;
    const o = OUTFITS[p.outfit];
    let zone = `<div class="zone ok">✔ 여기선 자연스럽다 · ${ZONE_NAMES[st.zone]}</div>`;
    if (st.lockdownViolation) zone = `<div class="zone bad">🚨 봉쇄 중 — 연회장 밖에 있으면 제지당한다</div>`;
    else if (st.trespass && st.zone.startsWith('sec')) zone = `<div class="zone bad">⛔ ${ZONE_NAMES[st.zone]} — 들키면 쫓겨나거나 붙잡힌다</div>`;
    else if (st.trespass) zone = `<div class="zone warn">⚠ ${ZONE_NAMES[st.zone]} — 이 옷차림은 눈에 띈다</div>`;
    if (st.illegal) zone += `<div class="zone bad">🚫 불법 행동 중: ${st.illegal}</div>`;
    const badges: string[] = [];
    if (p.outfit === 'guest') badges.push(p.legit ? '<span class="badge good">정식 손님 ✉️</span>' : '<span class="badge">초대 명단에 없음 (집사·정문 경비가 알아본다)</span>');
    if (w.stats.compromised.has(p.outfit)) badges.push('<span class="badge bad">🚨 수배된 옷차림!</span>');
    if (p.outfit === 'electrician' && w.power.anyOff()) badges.push('<span class="badge good">정전 중: 어디서든 수리 중인 척</span>');
    if (p.crouching) badges.push('<span class="badge">웅크림: 조용하지만 수상해 보인다</span>');
    if (p.hidden) badges.push(`<span class="badge good">🫥 ${p.hidden.name}에 숨어 있다</span>`);
    const slots = OUTFIT_ORDER.map((id, i) => {
      const owned = p.owned.has(id);
      return `<div class="slot ${p.outfit === id ? 'on' : owned ? '' : 'off'}"><b>${OUTFITS[id].icon}</b>${i + 1}</div>`;
    }).join('');
    const key = [p.outfit, zone, badges.join(), slots].join('|');
    if (key === this.lastKeys.outfit) return;
    this.lastKeys.outfit = key;
    this.outfitEl.innerHTML = `<div class="row"><div class="ic">${o.icon}</div><div><div class="name">${o.name}</div></div></div>${zone}<div class="badges">${badges.join('')}</div><div class="wardrobe">${slots}</div>`;
  }

  private updateInventory() {
    const p = this.w.player;
    const hd = p.hand;
    const handHtml = hd
      ? `<div class="hand ${hd.def.contraband ? 'danger' : ''}"><div class="big">${hd.def.icon}${hd.contents ? '<small>' + hd.contents.def.icon + '</small>' : ''}</div><div class="lbl">${hd.name}${hd.contents ? ` (안에 ${hd.contents.name})` : ''}${hd.def.contraband ? '<br>⚠ 다 보인다!' : ''}</div></div>`
      : `<div class="hand"><div class="big">✋</div><div class="lbl">빈손</div></div>`;
    const pockets = p.pockets.map((i) => `<span class="it" title="${i.def.desc}">${i.def.icon} ${i.name}</span>`).join('');
    const key = handHtml + pockets;
    if (key === this.lastKeys.inv) return;
    this.lastKeys.inv = key;
    this.invEl.innerHTML = `${handHtml}<div class="pockets">${pockets}</div>`;
  }

  private updatePrompt() {
    const w = this.w;
    const p = w.player;
    if (p.action) {
      const a = p.action;
      const k = `${a.label}|${Math.round((a.t / a.dur) * 50)}`;
      if (k !== this.lastKeys.progress) {
        this.lastKeys.progress = k;
        this.progressEl.className = 'progress' + (a.illegal ? ' illegal' : '');
        this.progressEl.innerHTML = `${a.illegal ? '🚫 ' : ''}${a.label}…${a.illegal ? ' <small>(들키면 큰일!)</small>' : ''}<div class="bar"><i style="width:${Math.min(100, (a.t / a.dur) * 100)}%"></i></div>`;
      }
      this.progressEl.style.display = '';
      this.promptEl.style.display = 'none';
      return;
    }
    this.progressEl.style.display = 'none';
    this.promptEl.style.display = '';
    const opts = w.options;
    const sel = w.optionIdx;
    const shown = opts.slice(0, 4);
    const key = shown.map((o) => o.action.label + (o.action.disabled ?? '') + o.name).join('|') + sel;
    if (key === this.lastKeys.prompt) return;
    this.lastKeys.prompt = key;
    this.promptEl.innerHTML = shown
      .map((o, i) => {
        const isSel = i === sel || (sel >= shown.length && i === 0);
        const cls = ['opt', isSel ? 'sel' : 'dim', o.action.disabled ? 'disabled' : '', o.action.illegal ? 'illegal' : ''].join(' ');
        const kb = isSel ? '<span class="key">E</span>' : '<span class="key">R</span>';
        const name = o.target?.id === 'self' ? '' : `<small>${o.name}</small> · `;
        return `<div class="${cls}">${kb}${name}${o.action.label}${o.action.illegal ? '<span class="ill">수상한 행동</span>' : ''}${o.action.disabled ? `<span class="why">${o.action.disabled}</span>` : ''}</div>`;
      })
      .join('');
  }

  private updateMinimap() {
    const w = this.w;
    const p = w.player;
    const ctx = this.miniCanvas.getContext('2d')!;
    this.painter.drawMini(ctx, this.miniCanvas.width, this.miniCanvas.height, p.pos);
    const room = w.grid.roomAt(p.pos);
    const label = room?.name ?? '';
    if (this.miniLabel.textContent !== label) this.miniLabel.textContent = label;
  }
}
