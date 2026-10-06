// Full-screen menus: title, briefing, pause, journal, results.
import { fmtTime } from '../core/math';
import { INTEL, TODOS } from '../sim/level/content';
import { OUTFITS } from '../sim/rules';
import type { World } from '../sim/World';
import { MapPainter } from './MapPainter';

const root = () => document.getElementById('screens')!;

function el(html: string): HTMLDivElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLDivElement;
}

export function clearScreens() {
  root().innerHTML = '';
}

const CONTROLS = `
<div class="controls">
  <span class="k"><span class="key">WASD</span></span><span>이동 (방향키도 가능)</span>
  <span class="k"><span class="key">Shift</span></span><span>달리기 — 빠르지만 시끄럽고, 실내에선 수상해 보인다</span>
  <span class="k"><span class="key">C</span></span><span>웅크리기 토글 — 조용하고 어두운 곳에서 잘 안 보인다. 울타리 개구멍 통과</span>
  <span class="k"><span class="key">E</span></span><span>상호작용 (문, 물건, 변장, 소매치기, 숨기...)</span>
  <span class="k"><span class="key">R</span></span><span>할 수 있는 행동이 여럿일 때 선택 바꾸기</span>
  <span class="k"><span class="key">Q</span> / <span class="key">G</span></span><span>들고 있는 물건 던지기 / 내려놓기</span>
  <span class="k"><span class="key">Space</span></span><span>휘파람 — 근처 사람을 그 자리로 불러들인다</span>
  <span class="k"><span class="key">1~5</span></span><span>얻은 옷으로 갈아입기 (2초, 누가 보면 들킨다)</span>
  <span class="k"><span class="key">V</span> (누르고 있기)</span><span>관찰 모드 — 시야, 이름, 소지품, 변장을 간파하는 사람 표시</span>
  <span class="k"><span class="key">Tab</span></span><span>수첩 — 엿들은 소문(공략 힌트), 지도, 할 일</span>
  <span class="k"><span class="key">휠</span></span><span>카메라 확대·축소</span>
  <span class="k"><span class="key">Esc</span></span><span>일시정지 · <span class="key">M</span> 소리 끄기</span>
</div>`;

export function titleScreen(on: { start: () => void; howto: () => void; records: () => void }) {
  clearScreens();
  const s = el(`
  <div class="screen" style="background: radial-gradient(ellipse at center, rgba(20,22,40,0.05), rgba(20,22,40,0.65))">
    <div class="title-wrap">
      <h1>완벽한 불청객 <span class="duck">🦆</span></h1>
      <div class="sub">파티에 초대받지 못했다고? 괜찮아. 황금 오리만 가져가면 되니까.</div>
      <div class="menu">
        <button class="btn primary" data-a="start">잠입 시작</button>
        <button class="btn" data-a="howto">조작법 · 규칙</button>
        <button class="btn" data-a="records">나의 기록</button>
      </div>
      <div class="small-note" style="color:#cfd3ff">헤드폰 권장 · 키보드로 플레이</div>
    </div>
  </div>`);
  s.querySelector('[data-a=start]')!.addEventListener('click', on.start);
  s.querySelector('[data-a=howto]')!.addEventListener('click', on.howto);
  s.querySelector('[data-a=records]')!.addEventListener('click', on.records);
  root().append(s);
  (s.querySelector('[data-a=start]') as HTMLButtonElement).focus();
}

export function howtoScreen(back: () => void) {
  clearScreens();
  const s = el(`
  <div class="screen"><div class="card">
    <h2>조작법 · 규칙</h2>
    ${CONTROLS}
    <p><b>사람들은 자기가 보고 들은 것만 안다.</b> 누군가 수상한 짓을 보면 경비에게 달려가 알리고, 경비는 무전으로 동료들에게 퍼뜨린다. 아무도 보지 못했다면 아무도 모른다.</p>
    <p><b>옷차림이 곧 출입증이다.</b> 손님 옷은 파티장에서, 웨이터 옷은 주방과 파티장에서, 경비원 옷은 거의 어디서나 자연스럽다. 하지만 어떤 사람들(👁)은 변장을 꿰뚫어본다. 한 번 들킨 옷차림은 수배되니 갈아입자.</p>
    <p><b>머리 위 표시</b>: <b style="color:#e8b400">?</b> 의심이 쌓이는 중(게이지) · <b style="color:#ff7a1a">!</b> 제지하러 온다 · <b style="color:#ff2b2b">!</b> 추격/신고 중. 바닥의 원뿔은 그 사람의 시야, 퍼지는 원은 소리다.</p>
    <p><b>환경은 서로 연결되어 있다.</b> 전기를 끊으면 불이 꺼지고 카메라와 경보가 멈추지만, 사람들은 손전등을 켜고 전기기사가 고치러 온다. 약을 탄 음료, 깨진 꽃병, 꺼진 전등, 열린 문... 누군가는 그걸 발견하고 반응한다.</p>
    <p><b>붙잡히면 끝.</b> 황금 오리를 손에 들고(또는 상자에 숨겨) 정문·쪽문·울타리 개구멍·선착장 보트·배달 밴 중 하나로 빠져나가면 성공이다.</p>
    <div class="row-btns"><button class="btn small" data-a="back">돌아가기</button></div>
  </div></div>`);
  s.querySelector('[data-a=back]')!.addEventListener('click', back);
  root().append(s);
}

export interface Records {
  runs: number;
  wins: number;
  best: { time: number; title: string } | null;
  todos: string[];
  routes: string[];
}

export function loadRecords(): Records {
  try {
    const r = JSON.parse(localStorage.getItem('pug_records') || 'null');
    if (r && typeof r.runs === 'number') return r;
  } catch {
    /* ignore */
  }
  return { runs: 0, wins: 0, best: null, todos: [], routes: [] };
}
export function saveRecords(r: Records) {
  try {
    localStorage.setItem('pug_records', JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function recordsScreen(back: () => void) {
  clearScreens();
  const r = loadRecords();
  const all = TODOS.filter((t) => !t.main);
  const routes: Record<string, string> = { front: '정문', service: '쪽문', gap: '울타리 개구멍', boat: '보트', van: '배달 밴' };
  const s = el(`
  <div class="screen"><div class="card">
    <h2>나의 기록</h2>
    <div class="stats">
      <span>도전 횟수</span><span class="v">${r.runs}</span>
      <span>성공</span><span class="v">${r.wins}</span>
      <span>최고 기록</span><span class="v">${r.best ? `${fmtTime(r.best.time)} · ${r.best.title}` : '-'}</span>
      <span>탈출 경로</span><span class="v">${Object.keys(routes).map((k) => (r.routes.includes(k) ? '✅ ' : '⬜ ') + routes[k]).join('<br>')}</span>
    </div>
    <ul class="todo-summary">${all.map((t) => `<li class="${r.todos.includes(t.id) ? 'done' : ''}">${r.todos.includes(t.id) ? '✔' : '○'} ${t.text}</li>`).join('')}</ul>
    <div class="row-btns"><button class="btn small" data-a="back">돌아가기</button></div>
  </div></div>`);
  s.querySelector('[data-a=back]')!.addEventListener('click', back);
  root().append(s);
}

export function briefingScreen(go: () => void, back: () => void) {
  clearScreens();
  const s = el(`
  <div class="screen"><div class="card">
    <h2>오늘 밤의 작전</h2>
    <p class="letter">
      오늘 밤, 오리 수집광 <b>오덕수 회장</b>의 저택에서 성대한 가든 파티가 열린다.<br>
      손님은 서른 명 남짓, 직원과 경비도 잔뜩.<br>
      그리고 전시실 유리 진열장 안에는... 순금으로 만든 <b>황금 오리</b> 🦆<br><br>
      물론 나는 초대받지 못했다. 하지만 상관없다.<br>
      <b>저택에 숨어들어, 황금 오리를 훔쳐, 아무도 모르게 빠져나오자.</b>
    </p>
    <p>💡 <b>알고 있는 소문</b><br>
      · 거리에서 담배 피우는 <b>지각한 손님</b>이 초대장을 갖고 있다. 등 뒤에서 슬쩍하면 정문으로 당당히 들어갈 수 있다.<br>
      · 앞마당 <b>남동쪽 울타리</b>에 개구멍이 있다. 웅크리면(C) 지나갈 수 있다.<br>
      · 파티장의 대화를 엿들으면 더 많은 기회가 보일 것이다. (수첩: Tab)</p>
    ${CONTROLS}
    <div class="row-btns">
      <button class="btn primary" data-a="go">파티장으로!</button>
      <button class="btn small" data-a="back">뒤로</button>
    </div>
  </div></div>`);
  s.querySelector('[data-a=go]')!.addEventListener('click', go);
  s.querySelector('[data-a=back]')!.addEventListener('click', back);
  root().append(s);
  (s.querySelector('[data-a=go]') as HTMLButtonElement).focus();
}

export function pauseScreen(on: { resume: () => void; restart: () => void; title: () => void; mute: () => void; muted: boolean }) {
  clearScreens();
  const s = el(`
  <div class="screen"><div class="card" style="width:min(520px, calc(100vw - 32px)); text-align:center">
    <h2>잠깐 숨 돌리기</h2>
    <div class="menu" style="margin-top:12px">
      <button class="btn primary" data-a="resume">계속하기</button>
      <button class="btn" data-a="restart">처음부터 다시</button>
      <button class="btn" data-a="mute">${on.muted ? '🔇 소리 켜기' : '🔊 소리 끄기'}</button>
      <button class="btn" data-a="title">타이틀로</button>
    </div>
  </div></div>`);
  s.querySelector('[data-a=resume]')!.addEventListener('click', on.resume);
  s.querySelector('[data-a=restart]')!.addEventListener('click', on.restart);
  s.querySelector('[data-a=title]')!.addEventListener('click', on.title);
  s.querySelector('[data-a=mute]')!.addEventListener('click', on.mute);
  root().append(s);
}

export function journalScreen(w: World, close: () => void, tab: 'intel' | 'map' | 'todo' | 'help' = 'intel') {
  clearScreens();
  const known = INTEL.filter((i) => w.stats.intel.has(i.id));
  const unknown = INTEL.length - known.length;
  const s = el(`
  <div class="screen"><div class="card" style="width:min(900px, calc(100vw - 32px))">
    <div class="tabs">
      <button data-t="intel">👂 소문과 기회</button>
      <button data-t="map">🗺️ 지도</button>
      <button data-t="todo">✏️ 할 일</button>
      <button data-t="help">⌨️ 조작법</button>
      <span style="flex:1"></span>
      <button data-t="close">닫기 (Tab)</button>
    </div>
    <div class="body"></div>
  </div></div>`);
  const body = s.querySelector('.body') as HTMLDivElement;
  const render = (t: string) => {
    s.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
    if (t === 'intel') {
      body.innerHTML = `<div class="intel-list">${known
        .map((i) => `<div class="intel-item"><b>${i.title}</b><p>${i.hint}</p></div>`)
        .join('')}${unknown ? `<div class="intel-item unknown">아직 듣지 못한 소문이 ${unknown}개 더 있다... 사람들 곁에서 귀를 기울여 보자. (말풍선에 👂 표시)</div>` : ''}</div>`;
    } else if (t === 'map') {
      body.innerHTML = '<canvas class="bigmap"></canvas><div class="small-note">🦆 황금 오리 · 🚪 정문/쪽문 · 🕳️ 개구멍 · 🚣 보트 · 🚐 배달 밴 · ⚡ 두꺼비집 · 점: 지금 보이는 사람들 (파랑=경비, 초록=직원, 흰색=손님, 노랑=회장)</div>';
      const cv = body.querySelector('canvas') as HTMLCanvasElement;
      const W = Math.min(840, window.innerWidth - 80);
      cv.width = W;
      cv.height = Math.round((W * w.grid.h) / w.grid.w);
      new MapPainter(w).drawFull(cv.getContext('2d')!, cv.width, cv.height);
    } else if (t === 'todo') {
      body.innerHTML = `<ul class="todo-summary" style="columns:1">${TODOS.map(
        (td) => `<li class="${w.stats.todos.has(td.id) ? 'done' : ''}">${w.stats.todos.has(td.id) ? '✔' : '○'} ${td.main ? '<b>' + td.text + '</b>' : td.text}</li>`,
      ).join('')}</ul><p class="small-note">굵은 글씨는 꼭 해야 할 일, 나머지는 해보면 재밌는 일.</p>`;
    } else if (t === 'help') {
      body.innerHTML = CONTROLS;
    } else close();
  };
  s.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => render((b as HTMLElement).dataset.t!)));
  root().append(s);
  render(tab);
}

export interface ResultInfo {
  title: string;
  rating: string;
  lines: [string, string][];
}

export function rateRun(w: World): ResultInfo {
  const st = w.stats;
  const success = w.ended === 'escaped';
  const routes: Record<string, string> = {
    front: '정문으로 유유히',
    service: '직원용 쪽문으로',
    gap: '울타리 개구멍으로',
    boat: '보트를 저어',
    van: '배달 밴을 몰고',
  };
  const theftKnown = st.theftKnownAt >= 0;
  const tapes = w.security.tapes.filter((t) => t.severe).length;
  let rating = '';
  if (success) {
    if (st.spotted === 0 && st.compromised.size === 0 && !theftKnown && tapes === 0) rating = '완벽한 불청객';
    else if (st.spotted === 0 && !theftKnown) rating = '그림자 손님';
    else if (!st.lockdown && st.spotted <= 2) rating = '능숙한 불청객';
    else if (st.lockdown) rating = '소동의 주인공';
    else rating = '아슬아슬한 불청객';
  } else rating = '붙잡힌 불청객';
  const lines: [string, string][] = [
    ['걸린 시간', fmtTime(st.endTime)],
    ['탈출 경로', success ? routes[st.route] ?? st.route : '-'],
    ['발각 횟수', `${st.spotted}회`],
    ['수배된 옷차림', st.compromised.size ? [...st.compromised].map((o) => OUTFITS[o].name).join(', ') : '없음'],
    ['도난 발각', theftKnown ? `${fmtTime(st.theftKnownAt)}에 들통남` : '아무도 모름'],
    ['남은 녹화 기록', tapes ? `${tapes}건 (위험)` : '없음'],
    ['봉쇄', st.lockdown ? '발령됨' : '없음'],
    ['사용한 변장', [...st.outfitsUsed].map((o) => OUTFITS[o].icon).join(' ')],
    ['재운 사람 / 화장실 보낸 사람', `${st.drugged.size} / ${st.sickened.size}`],
    ['소매치기 / 자물쇠 따기', `${st.pickpockets} / ${st.lockpicks}`],
    ['엿들은 소문', `${st.intel.size} / ${INTEL.length}`],
  ];
  return { title: success ? '탈출 성공!' : '붙잡혔다!', rating, lines };
}

export function resultScreen(w: World, info: ResultInfo, on: { retry: () => void; title: () => void }) {
  clearScreens();
  const success = w.ended === 'escaped';
  const todos = TODOS.filter((t) => !t.main);
  const reason = !success ? `<p style="text-align:center"><b>${w.stats.caughtBy}</b>에게 붙잡혔다. (${w.stats.caughtWhy})</p>` : '';
  const tip = success
    ? '같은 저택, 다른 방법: 이번엔 다른 변장이나 다른 탈출로를 써 보는 건 어떨까?'
    : '팁: 의심 게이지(?)가 차기 전에 시야에서 벗어나거나, 옷을 갈아입거나, 숨을 곳(덤불·사물함·옷장)을 활용하자.';
  const s = el(`
  <div class="screen"><div class="card">
    <h2 class="result-title">${success ? '🦆 ' : '🚔 '}${info.title}</h2>
    <div class="rating"><span class="stamp">${info.rating}</span></div>
    ${reason}
    <div class="stats">${info.lines.map(([a, b]) => `<span>${a}</span><span class="v">${b}</span>`).join('')}</div>
    <ul class="todo-summary">${todos.map((t) => `<li class="${w.stats.todos.has(t.id) ? 'done' : ''}">${w.stats.todos.has(t.id) ? '✔' : '○'} ${t.text}</li>`).join('')}</ul>
    <p class="small-note">${tip}</p>
    <div class="row-btns">
      <button class="btn primary" data-a="retry">다시 도전</button>
      <button class="btn small" data-a="title">타이틀로</button>
    </div>
  </div></div>`);
  s.querySelector('[data-a=retry]')!.addEventListener('click', on.retry);
  s.querySelector('[data-a=title]')!.addEventListener('click', on.title);
  root().append(s);
  (s.querySelector('[data-a=retry]') as HTMLButtonElement).focus();
}
