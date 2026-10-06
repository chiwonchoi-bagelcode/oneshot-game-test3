// Trailer typography. Styled after the game's own paper to-do list (Gaegu handwriting on ruled
// paper with a red margin) and its Jua title logo; the opening caption uses a serif for the
// "elegant party" mood. All motion is computed from the trailer clock.
import { clamp01, ease, lerp, remap } from './cam';
import { el, type Title } from './overlay';

const css = (e: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(e.style, s);
const fadeIO = (lt: number, dur: number, fin = 0.35, fout = 0.3) => Math.min(clamp01(lt / fin), clamp01((dur - lt) / fout));

// ---------------------------------------------------------------------------------------------
// Opening caption
// ---------------------------------------------------------------------------------------------
const opening: Title = {
  start: 1.1,
  end: 4.45,
  build() {
    const e = el(
      'div',
      'tt-open',
      `<div class="l1">오덕수 회장 저택 · 오후 8시</div><div class="l2">황금 오리 공개 파티</div><div class="rule"></div>`,
    );
    return e;
  },
  anim(e, lt) {
    const d = this.end - this.start;
    const a = fadeIO(lt, d, 0.6, 0.35);
    css(e, { opacity: a.toFixed(3), transform: `translate(-50%, ${(1 - ease.out(clamp01(lt / 1.2))) * 14}px)` });
    const l2 = e.querySelector('.l2') as HTMLElement;
    l2.style.letterSpacing = `${lerp(0.32, 0.12, ease.out(clamp01(lt / 2.5)))}em`;
    (e.querySelector('.rule') as HTMLElement).style.transform = `scaleX(${ease.out(clamp01((lt - 0.3) / 1.2))})`;
  },
};

// ---------------------------------------------------------------------------------------------
// Paper to-do card (B3) — big, centre screen
// ---------------------------------------------------------------------------------------------
const todoCard: Title = {
  start: 20.1,
  end: 22.1,
  build() {
    return el(
      'div',
      'tt-paper tt-todo-big',
      `<h3>할 일</h3><ul><li class="a"><span>저택 안으로 숨어들기</span><i class="strike"></i></li><li class="b"><span>황금 오리 손에 넣기</span></li><li class="c"><span>황금 오리를 들고 빠져나가기</span></li></ul>`,
    );
  },
  anim(e, lt) {
    const inK = ease.out(clamp01(lt / 0.28));
    const outK = ease.in(clamp01((lt - 1.82) / 0.18));
    css(e, {
      transform: `translate(-50%, -50%) translateY(${(1 - inK) * 60 + outK * -900}px) rotate(${lerp(-6, -1.6, inK)}deg) scale(${lerp(0.92, 1, inK)})`,
      opacity: String(clamp01(lt / 0.12)),
    });
    // Items are "written" one by one, then the first one is crossed out.
    e.querySelectorAll('li').forEach((li, i) => {
      const k = clamp01((lt - 0.12 - i * 0.18) / 0.25);
      (li as HTMLElement).style.clipPath = `inset(0 ${(1 - k) * 100}% 0 0)`;
    });
    (e.querySelector('.strike') as HTMLElement).style.transform = `scaleX(${ease.out(clamp01((lt - 0.95) / 0.3))}) rotate(-1.5deg)`;
  },
};

// ---------------------------------------------------------------------------------------------
// Montage to-do list: grows by one line per vignette and ticks it off when it pays off.
// ---------------------------------------------------------------------------------------------
const MONTAGE: { at: number; tick: number; text: string }[] = [
  { at: 22.1, tick: 22.55, text: '웨이터로 변장하기' },
  { at: 26.1, tick: 27.1, text: '휘파람으로 꾀어내기' },
  { at: 30.1, tick: 31.2, text: '저택에 정전 일으키기' },
  { at: 34.1, tick: 36.45, text: '누군가를 꿈나라로 보내기' },
  { at: 38.1, tick: 39.75, text: '누군가를 화장실로 달려가게 하기' },
  { at: 42.1, tick: 43.47, text: '소매치기 성공하기' },
  { at: 44.1, tick: 44.35, text: '불꽃놀이 몰래 터뜨리기' },
];

const montageList: Title = {
  start: 22.1,
  end: 46.0,
  build() {
    const lis = MONTAGE.map((m, i) => `<li data-i="${i}"><b class="box"></b><span>${m.text}</span><i class="tick">✓</i><i class="strike"></i></li>`).join('');
    return el('div', 'tt-paper tt-todo-side', `<h3>할 일 <small>그리고 덤으로…</small></h3><ul>${lis}</ul>`);
  },
  anim(e, lt) {
    const t = this.start + lt;
    const inK = ease.out(clamp01(lt / 0.3));
    const outK = ease.in(clamp01((lt - (this.end - this.start - 0.25)) / 0.25));
    css(e, { transform: `translateX(${(1 - inK) * -420 + outK * -460}px) rotate(-1.4deg)` });
    e.querySelectorAll('li').forEach((li) => {
      const m = MONTAGE[Number((li as HTMLElement).dataset.i)];
      const shown = t >= m.at;
      const h = li as HTMLElement;
      h.style.display = shown ? '' : 'none';
      if (!shown) return;
      const wk = clamp01((t - m.at) / 0.3);
      (h.querySelector('span') as HTMLElement).style.clipPath = `inset(0 ${(1 - wk) * 100}% 0 0)`;
      const tk = clamp01((t - m.tick) / 0.22);
      const tick = h.querySelector('.tick') as HTMLElement;
      tick.style.opacity = String(tk > 0 ? 1 : 0);
      tick.style.transform = `scale(${tk > 0 ? lerp(1.9, 1, ease.out(tk)) : 0}) rotate(-8deg)`;
      (h.querySelector('.strike') as HTMLElement).style.transform = `scaleX(${ease.out(clamp01((t - m.tick - 0.08) / 0.3))})`;
      h.classList.toggle('done', t >= m.tick);
      h.classList.toggle('current', t >= m.at && t < m.at + 4 && t < this.start + (this.end - this.start));
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Fake duck recipe
// ---------------------------------------------------------------------------------------------
function handLabel(start: number, end: number, html: string, x: number, y: number, rot: number, cls = ''): Title {
  return {
    start,
    end,
    build() {
      const e = el('div', 'tt-hand ' + cls, html);
      css(e, { left: `${x}px`, top: `${y}px` });
      return e;
    },
    anim(e, lt) {
      const k = ease.out(clamp01(lt / 0.25));
      const out = clamp01((this.end - this.start - lt) / 0.15);
      css(e, { opacity: String(Math.min(1, out)), transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${lerp(1.35, 1, k)})`, clipPath: `inset(0 ${(1 - clamp01(lt / 0.3)) * 100}% 0 0)` });
    },
  };
}

const recipe: Title[] = [
  handLabel(46.55, 48.1, '고무 오리', 1440, 330, -4),
  handLabel(48.55, 50.1, '+ 금색 페인트', 1330, 300, 3),
  handLabel(49.35, 50.1, '= ?', 1700, 300, -2, 'big'),
  handLabel(53.37, 54.1, '= 가짜 황금 오리!', 1440, 190, -3, 'gold'),
];

// Single to-do strip that slides in for the plan's milestones.
function todoStrip(start: number, end: number, text: string, tick: number): Title {
  return {
    start,
    end,
    build() {
      return el('div', 'tt-paper tt-strip', `<b class="box"></b><span>${text}</span><i class="tick">✓</i><i class="strike"></i>`);
    },
    anim(e, lt) {
      const t = this.start + lt;
      const inK = ease.out(clamp01(lt / 0.25));
      const outK = ease.in(clamp01((lt - (this.end - this.start - 0.2)) / 0.2));
      css(e, { transform: `translateX(${(1 - inK) * -520 + outK * -560}px) rotate(-1.6deg)` });
      const tk = clamp01((t - tick) / 0.22);
      const tickEl = e.querySelector('.tick') as HTMLElement;
      tickEl.style.opacity = String(tk > 0 ? 1 : 0);
      tickEl.style.transform = `scale(${tk > 0 ? lerp(1.9, 1, ease.out(tk)) : 0}) rotate(-8deg)`;
      (e.querySelector('.strike') as HTMLElement).style.transform = `scaleX(${ease.out(clamp01((t - tick - 0.08) / 0.3))})`;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The game's own UI moments (toast & ending banner), restyled 1:1 from src/style.css
// ---------------------------------------------------------------------------------------------
function toast(start: number, end: number, text: string, kind: string): Title {
  return {
    start,
    end,
    build() {
      const e = el('div', 'tt-toast toast ' + kind);
      e.textContent = text;
      return e;
    },
    anim(e, lt) {
      const k = ease.out(clamp01(lt / 0.2));
      css(e, { opacity: String(Math.min(k, clamp01((this.end - this.start - lt) / 0.25))), transform: `translateX(${(1 - k) * 60}px) scale(1.5)` });
    },
  };
}

const escapeBanner: Title = {
  start: 80.37,
  end: 84.1,
  build() {
    return el('div', 'ending-banner win tt-banner', `<div class="big">🦆 탈출 성공!</div><div class="small">울타리 개구멍으로 기어 나갔다</div>`);
  },
  anim(e, lt) {
    const k = ease.out(clamp01(lt / 0.3));
    css(e, { opacity: String(Math.min(k, clamp01((this.end - this.start - lt) / 0.2))), transform: `translate(-50%, -50%) scale(${lerp(1.6, 1.25, k)}) rotate(${lerp(-4, -2, k)}deg)` });
  },
};

// ---------------------------------------------------------------------------------------------
// Title & end card
// ---------------------------------------------------------------------------------------------
const logo: Title = {
  start: 84.1,
  end: 92.1,
  build() {
    return el(
      'div',
      'tt-logo',
      `<div class="mark"><span class="duck">🦆</span><span class="name">완벽한 불청객</span></div><div class="en">THE PERFECT UNINVITED GUEST</div>`,
    );
  },
  anim(e, lt) {
    const k = ease.outExpo(clamp01(lt / 0.32));
    const out = clamp01((this.end - this.start - lt) / 1.1);
    const breathe = 1 + Math.sin(lt * 1.3) * 0.006;
    css(e, { opacity: String(Math.min(clamp01(lt / 0.06), out)), transform: `translate(-50%, -50%) scale(${(lerp(1.5, 1, k) * breathe).toFixed(4)})` });
    (e.querySelector('.en') as HTMLElement).style.opacity = String(clamp01((lt - 0.7) / 0.6));
    (e.querySelector('.en') as HTMLElement).style.letterSpacing = `${lerp(0.7, 0.42, ease.out(clamp01((lt - 0.7) / 2)))}em`;
    (e.querySelector('.duck') as HTMLElement).style.transform = `rotate(${Math.sin(lt * 3.2) * 6}deg) translateY(${-Math.abs(Math.sin(lt * 3.2)) * 6}px)`;
  },
};

const tagline: Title = {
  start: 87.15,
  end: 92.1,
  build() {
    return el('div', 'tt-tagline', `<span class="a">길은 여럿.</span> <span class="b">오리는 하나.</span>`);
  },
  anim(e, lt) {
    const out = clamp01((this.end - this.start - lt) / 1.1);
    css(e, { opacity: String(out) });
    const a = e.querySelector('.a') as HTMLElement;
    const b = e.querySelector('.b') as HTMLElement;
    a.style.opacity = String(clamp01(lt / 0.3));
    b.style.opacity = String(clamp01((lt - 0.85) / 0.3));
    a.style.clipPath = `inset(0 ${(1 - clamp01(lt / 0.35)) * 100}% 0 0)`;
    b.style.clipPath = `inset(0 ${(1 - clamp01((lt - 0.85) / 0.35)) * 100}% 0 0)`;
  },
};

const REMAINING = ['화재 경보로 모두 대피시키기', '주크박스로 파티 흥 돋우기', '녹화 기록 지우기', '아무에게도 들키지 않고 탈출하기'];
const remaining: Title = {
  start: 88.9,
  end: 92.1,
  build() {
    const lis = REMAINING.map((t) => `<li><b class="box"></b><span>${t}</span></li>`).join('');
    return el('div', 'tt-paper tt-remaining', `<h3>아직 남은 할 일</h3><ul>${lis}</ul><div class="more">…그리고 아직 아무도 모르는 방법들</div>`);
  },
  anim(e, lt) {
    const inK = ease.out(clamp01(lt / 0.35));
    const out = clamp01((this.end - this.start - lt) / 1.0);
    css(e, { opacity: String(out), transform: `translateX(${(1 - inK) * 520}px) rotate(2.2deg)` });
    e.querySelectorAll('li').forEach((li, i) => {
      const k = clamp01((lt - 0.25 - i * 0.16) / 0.25);
      (li as HTMLElement).style.clipPath = `inset(0 ${(1 - k) * 100}% 0 0)`;
    });
    (e.querySelector('.more') as HTMLElement).style.opacity = String(clamp01((lt - 1.1) / 0.4));
  },
};

const footer: Title = {
  start: 89.6,
  end: 92.1,
  build() {
    return el('div', 'tt-footer', '초대장 없이 입장 가능 · 데스크톱 브라우저 게임');
  },
  anim(e, lt) {
    css(e, { opacity: String(Math.min(clamp01(lt / 0.5), clamp01((this.end - this.start - lt) / 1.0))) });
  },
};

// Disclosure required by the TTS model licence (OpenRAIL-M, Attachment A(e)).
const finePrint: Title = {
  start: 89.6,
  end: 92.1,
  build() {
    return el('div', 'tt-fine', '내레이션: AI 합성 음성 (Supertone Supertonic 3) · 게임 화면은 실제 게임 시뮬레이션으로 연출');
  },
  anim(e, lt) {
    css(e, { opacity: String(Math.min(clamp01(lt / 0.5), clamp01((this.end - this.start - lt) / 1.0)) * 0.75) });
  },
};

// Hard black for the very end (covers bubbles too).
const endBlack: Title = {
  start: 96.15,
  end: 97.1,
  build() {
    return el('div', 'tt-black');
  },
  anim() {},
};

// White flash on the title slam.
const flash: Title = {
  start: 84.1,
  end: 84.5,
  build() {
    return el('div', 'tt-flash');
  },
  anim(e, lt) {
    e.style.opacity = String(1 - remap(lt, 0, 0.4));
  },
};

export const TITLES: Title[] = [
  opening,
  todoCard,
  montageList,
  ...recipe,
  todoStrip(50.1, 54.1, '가짜 황금 오리 만들기', 53.37),
  todoStrip(58.1, 62.1, '황금 오리 바꿔치기', 60.6),
  toast(68.45, 71.2, '📢 "손님 여러분, 안전을 위해 모두 연회장으로 모여 주십시오!"', 'danger'),
  escapeBanner,
  flash,
  logo,
  tagline,
  remaining,
  footer,
  finePrint,
  endBlack,
];
