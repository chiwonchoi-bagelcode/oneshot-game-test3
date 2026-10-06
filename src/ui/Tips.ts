// Contextual one-time tips that teach the systems the first time they matter.
import type { World } from '../sim/World';

interface Tip {
  id: string;
  when: (w: World) => boolean;
  text: string;
}

const TIPS: Tip[] = [
  {
    id: 'start',
    when: (w) => w.time > 2.5,
    text: '💡 정문 경비는 초대장을 확인한다. 초대장이 없다면 지각한 손님 등 뒤에서 슬쩍하거나(E), 다른 길을 찾아보자. V를 누르고 있으면 사람들이 보인다.',
  },
  { id: 'trespass', when: (w) => w.playerStatus.trespass && !w.playerStatus.inStreet, text: '💡 이 옷차림으로는 있으면 안 되는 구역이다. 누가 보면 쫓아낸다 — 맞는 옷으로 갈아입거나 들키지 말자.' },
  {
    id: 'noticed',
    when: (w) => [...w.player.noticedBy.values()].some((v) => v > 0.3),
    text: '💡 누군가 나를 수상하게 본다! 머리 위 게이지(?)가 다 차기 전에 시야에서 벗어나거나 수상한 행동을 멈추자.',
  },
  { id: 'duck', when: (w) => w.playerStatus.duckVisible, text: '💡 황금 오리는 누구나 알아본다! 선물 상자나 은쟁반에 담으면(E) 들키지 않고 옮길 수 있다.' },
  { id: 'chase', when: (w) => w.player.chasers.size > 0, text: '💡 쫓기고 있다! 달려서(Shift) 시야를 끊고, 덤불·사물함·옷장에 숨거나 옷을 갈아입어 따돌리자.' },
  {
    id: 'wanted',
    when: (w) => w.stats.compromised.has(w.player.outfit),
    text: '💡 이 옷차림은 경비들에게 수배됐다. 다른 옷으로 갈아입자 (숫자키 1~5, 2초 — 아무도 안 볼 때!).',
  },
  { id: 'intel', when: (w) => w.stats.intel.size > 2, text: '💡 엿들은 소문은 수첩(Tab)에 공략 힌트로 기록된다.' },
  { id: 'lockdown', when: (w) => w.security.lockdown, text: '💡 저택이 봉쇄됐다! 정문과 쪽문이 닫히고 경비들이 수색한다. 개구멍, 보트, 밴 같은 다른 길을 찾자.' },
  { id: 'power', when: (w) => !w.power.on('B'), text: '💡 정전! 어두운 곳에선 잘 안 보이지만, 경비들은 손전등을 켜고 전기기사가 고치러 온다.' },
  { id: 'alarm', when: (w) => w.security.alarmOn, text: '💡 경보가 울렸다! 경비들이 전시실로 몰려온다. 당장 빠져나가자!' },
  { id: 'hidden', when: (w) => !!w.player.hidden, text: '💡 숨어 있는 동안엔 보이지 않는다. 숨는 모습을 들키지만 않았다면. 움직이면 나온다.' },
  { id: 'legit', when: (w) => w.player.legit, text: '💡 이제 정식 손님이다. 손님 구역에서는 아무도 의심하지 않는다. 직원 구역과 전시실은 예외!' },
];

export class Tips {
  private fired = new Set<string>();
  private cooldown = 0;
  update(w: World, dt: number) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    for (const t of TIPS) {
      if (this.fired.has(t.id)) continue;
      if (t.when(w)) {
        this.fired.add(t.id);
        w.events.emit('notify', { text: t.text, kind: 'intel' });
        this.cooldown = 4;
        return;
      }
    }
  }
}
