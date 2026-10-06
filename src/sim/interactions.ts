// Everything the player can do with [E]. Each interactable offers context
// sensitive actions; disabled actions explain what is missing.
import { angleDiff, angleOf, dist, type V2 } from '../core/math';
import type { DoorState, WindowState } from './Grid';
import type { Item } from './Items';
import type { Circuit, KeyId, OutfitId } from './level/types';
import type { Action, Npc } from './npc/Npc';
import type { HideSpot } from './Player';
import { isDuck, ITEMS, OUTFITS, type ItemType } from './rules';
import type { World } from './World';

export interface ActionDef {
  id: string;
  label: string;
  dur?: number;
  /** Crime description when witnessed while doing this. */
  illegal?: string;
  disabled?: string;
  anim?: Action;
  /** Sound played when starting. */
  sfx?: string;
  run: (w: World) => void;
  during?: (w: World, dt: number) => void;
}

export interface Interactable {
  id: string;
  name: string;
  pos: (w: World) => V2;
  range: number;
  /** Require line of sight from the player (furniture). */
  los?: boolean;
  /** Ranking bias (lower = preferred). */
  bias?: number;
  actions: (w: World) => ActionDef[];
}

const pick = (w: World, item: Item) => w.playerPickUp(item);

export function buildInteractables(w: World): Interactable[] {
  const out: Interactable[] = [];
  const p = () => w.player;

  // ---------------------------------------------------------------- Doors
  for (const d of w.grid.doors) {
    out.push({
      id: 'door:' + d.def.id,
      name: d.def.name,
      pos: () => d.center,
      range: d.def.style === 'double' || d.def.gate ? 1.9 : 1.45,
      actions: (w) => doorActions(w, d),
    });
  }
  // ---------------------------------------------------------------- Windows
  for (const win of w.grid.windows) {
    if (win.def.fixed) continue;
    out.push({
      id: 'win:' + win.def.id,
      name: '창문',
      pos: () => win.center,
      range: 1.35,
      actions: (w) => windowActions(w, win),
    });
  }
  // ---------------------------------------------------------------- Light switches
  for (const r of w.grid.rooms) {
    if (!r.indoor || !r.switchAt) continue;
    const pos = { x: r.switchAt[0], z: r.switchAt[1] };
    out.push({
      id: 'switch:' + r.id,
      name: `${r.name} 전등 스위치`,
      pos: () => pos,
      range: 1.15,
      bias: 0.4,
      actions: (w) => {
        const on = !!w.lighting.switches.get(r.id);
        return [
          {
            id: 'switch',
            label: on ? '불 끄기' : '불 켜기',
            sfx: 'switch',
            run: (w) => w.setSwitch(r.id, !on, 'player'),
          },
        ];
      },
    });
  }
  // ---------------------------------------------------------------- Fuse box
  out.push({
    id: 'fusebox',
    name: '두꺼비집 (차단기)',
    pos: () => ({ x: 14.5, z: 14.75 }),
    range: 1.3,
    actions: (w) => {
      const elec = w.player.outfit === 'electrician';
      const illegal = elec ? undefined : '전기 차단기를 만지작거린다';
      const names: Record<'main' | Circuit, string> = { main: '메인', A: '서비스동', B: '본관(파티장)', C: '보안 시스템' };
      return (['B', 'C', 'A', 'main'] as const).map((c) => {
        const on = w.power.breakers[c];
        return {
          id: 'breaker_' + c,
          label: `${names[c]} 차단기 ${on ? '내리기' : '올리기'}`,
          dur: 1,
          illegal,
          anim: 'work' as Action,
          sfx: 'breaker',
          run: (w: World) => w.setBreaker(c, !on, 'player'),
        };
      });
    },
  });
  // ---------------------------------------------------------------- Security console
  out.push({
    id: 'console',
    name: '보안 콘솔',
    pos: () => ({ x: 22.6, z: 15.35 }),
    range: 1.3,
    actions: (w) => {
      const sec = w.security;
      const noPower = !w.power.on('A') ? '보안실 전원이 나갔다' : undefined;
      const noC = !w.power.on('C') ? '보안 시스템 전원이 나갔다' : undefined;
      const illegal = '보안 콘솔을 조작한다';
      return [
        {
          id: 'erase',
          label: `녹화 기록 삭제 (${sec.tapes.length}건)`,
          dur: 3,
          illegal,
          anim: 'type',
          disabled: noPower ?? noC ?? (sec.tapes.length === 0 ? '삭제할 기록이 없다' : undefined),
          run: (w) => {
            sec.eraseTapes(w);
            w.events.emit('notify', { text: '녹화 기록을 모두 지웠다.', kind: 'good' });
            w.completeTodo('erase_tapes');
          },
        },
        {
          id: 'alarm',
          label: sec.alarmArmed ? '진열장 경보 해제' : '진열장 경보 다시 켜기',
          dur: 2,
          illegal,
          anim: 'type',
          disabled: noPower ?? noC,
          run: (w) => {
            sec.alarmArmed = !sec.alarmArmed;
            w.events.emit('notify', { text: sec.alarmArmed ? '진열장 경보를 다시 켰다.' : '진열장 경보를 껐다! 이제 오리를 들어도 울리지 않는다.', kind: 'good' });
            if (!sec.alarmArmed) w.completeTodo('disable_alarm');
          },
        },
        {
          id: 'cams',
          label: sec.camerasEnabled ? '감시카메라 끄기' : '감시카메라 켜기',
          dur: 1.5,
          illegal,
          anim: 'type',
          disabled: noPower ?? noC,
          run: (w) => {
            sec.camerasEnabled = !sec.camerasEnabled;
            w.events.emit('notify', { text: sec.camerasEnabled ? '카메라를 다시 켰다.' : '감시카메라를 껐다. (근무자가 보면 이상하게 여길 것이다)', kind: 'good' });
            const op = sec.operatorWatching(w);
            if (!sec.camerasEnabled && op) w.brain.noticePowerOut(w, op, ['C']);
          },
        },
      ];
    },
  });
  // ---------------------------------------------------------------- Outfit sources
  const outfitSource = (id: string, name: string, pos: V2, outfit: OutfitId, label: string, illegal: string) =>
    out.push({
      id,
      name,
      pos: () => pos,
      range: 1.3,
      actions: (w) => [
        {
          id: 'take_' + outfit,
          label: w.player.owned.has(outfit) ? `${OUTFITS[outfit].name}으로 갈아입기` : label,
          dur: 2.2,
          illegal,
          anim: 'reach',
          sfx: 'cloth',
          disabled: w.player.outfit === outfit ? '이미 입고 있다' : undefined,
          run: (w) => w.changeOutfit(outfit, true),
        },
      ],
    });
  outfitSource('locker_waiter', '직원 사물함', { x: 17.85, z: 23.5 }, 'waiter', '웨이터 제복 꺼내 입기', '남의 사물함을 뒤진다');
  outfitSource('chef_hook', '요리사 복장', { x: 22.5, z: 23.1 }, 'chef', '요리사 복장 갈아입기', '남의 옷을 슬쩍한다');
  outfitSource('guard_locker', '경비원 사물함', { x: 18.15, z: 16.5 }, 'guard', '예비 경비원 제복 갈아입기', '경비원 사물함을 뒤진다');
  outfitSource('evan_suit', '전기기사 밴', { x: 5.3, z: 44.6 }, 'electrician', '작업복 꺼내 입기', '남의 차를 뒤진다');

  // ---------------------------------------------------------------- Pickup-ish fixtures
  const fixture = (id: string, name: string, pos: V2, type: ItemType, label: string, illegal?: string, intel?: string) => {
    let taken = false;
    out.push({
      id,
      name,
      pos: () => pos,
      range: 1.3,
      actions: (w) => [
        {
          id: 'take',
          label,
          dur: 1,
          illegal,
          anim: 'reach',
          disabled: taken ? '이미 챙겼다' : undefined,
          run: (w) => {
            taken = true;
            w.givePlayer(type);
            if (intel) w.learnIntel(intel);
          },
        },
      ],
    });
  };
  fixture('key_hook', '열쇠 고리', { x: 12.75, z: 40.5 }, 'key_van', '배달 밴 열쇠 챙기기', '열쇠를 슬쩍한다');
  fixture('key_cabinet', '열쇠 보관함', { x: 23.3, z: 17 }, 'key_shed', '창고 열쇠 챙기기', '열쇠 보관함을 뒤진다');
  fixture('firstaid', '구급상자', { x: 12.75, z: 27.5 }, 'laxative', '설사약 챙기기', '구급상자를 뒤진다');
  fixture('medicine', '욕실 약장', { x: 53.2, z: 39.5 }, 'sleeping_pills', '수면제 챙기기', '남의 약장을 뒤진다', 'intel_pills');
  fixture('desk', '회장님 책상 서랍', { x: 44.5, z: 18.45 }, 'sleeping_pills', '서랍 뒤지기 (수면제·메모)', '책상 서랍을 뒤진다', 'intel_weight');
  fixture('fireplace', '벽난로 선반', { x: 42.5, z: 15.25 }, 'lighter', '라이터 챙기기', undefined);
  fixture('evan_tools', '전기기사 공구함', { x: 5.3, z: 46.6 }, 'wrench', '렌치 꺼내기', '남의 차를 뒤진다', 'intel_fusebox');
  fixture('street_car', '잠기지 않은 차', { x: 20, z: 61.7 }, 'invitation', '차 안 뒤지기', '남의 차를 뒤진다');

  // ---------------------------------------------------------------- Drinks (spiking)
  const drink = (id: string, name: string, pos: V2, key: 'coffee' | 'cooler' | 'punch') =>
    out.push({
      id,
      name,
      pos: () => pos,
      range: 1.3,
      actions: (w) => {
        const acts: ActionDef[] = [];
        const cur = w.spiked[key];
        for (const t of ['sleeping_pills', 'laxative'] as const) {
          if (!w.player.hasItem(t)) continue;
          acts.push({
            id: 'spike_' + t,
            label: `${ITEMS[t].name} 타기`,
            dur: 1.4,
            illegal: '음료에 뭔가를 몰래 탄다',
            anim: 'reach',
            sfx: 'pour',
            disabled: cur ? '이미 뭔가 타 놓았다' : undefined,
            run: (w) => w.spike(key, t),
          });
        }
        if (!acts.length)
          acts.push({ id: 'look', label: '살펴보기', run: (w) => w.events.emit('notify', { text: w.content.drinkHint(key), kind: 'info' }) });
        return acts;
      },
    });
  drink('coffee', '직원용 커피 머신', { x: 13.3, z: 23.5 }, 'coffee');
  drink('cooler', '정수기', { x: 27.5, z: 23.2 }, 'cooler');
  drink('punch', '파티 펀치 볼', { x: 45.7, z: 27.5 }, 'punch');

  // ---------------------------------------------------------------- Fun stuff
  out.push({
    id: 'jukebox',
    name: '주크박스',
    pos: () => ({ x: 58.8, z: 26.3 }),
    range: 1.3,
    actions: (w) => [
      {
        id: 'juke',
        label: w.flags.jukeboxOn ? '주크박스 끄기' : '주크박스 크게 틀기',
        sfx: 'click',
        disabled: !w.power.on('B') ? '전기가 나갔다' : undefined,
        run: (w) => w.setJukebox(!w.flags.jukeboxOn, 'player'),
      },
    ],
  });
  out.push({
    id: 'fireworks',
    name: '불꽃놀이 발사대',
    pos: () => ({ x: 28, z: 5.2 }),
    range: 1.5,
    actions: (w) => [
      {
        id: 'light',
        label: '불꽃놀이에 불 붙이기',
        dur: 1.6,
        illegal: '불꽃놀이에 몰래 불을 붙인다',
        anim: 'reach',
        disabled: w.flags.fireworksUsed ? '이미 다 터졌다' : !w.player.hasItem('lighter') ? '불을 붙일 라이터가 필요하다' : undefined,
        run: (w) => w.director.launchFireworks('player'),
      },
    ],
  });
  for (const fa of [
    { id: 'firealarm_foyer', pos: { x: 34.5, z: 43.25 } },
    { id: 'firealarm_kitchen', pos: { x: 23.2, z: 38.5 } },
  ]) {
    out.push({
      id: fa.id,
      name: '화재 경보기',
      pos: () => fa.pos,
      range: 1.2,
      actions: (w) => [
        {
          id: 'pull',
          label: '화재 경보 울리기',
          dur: 0.8,
          illegal: '화재 경보기를 당긴다',
          anim: 'reach',
          disabled: w.flags.fireAlarm ? '이미 울리고 있다' : undefined,
          run: (w) => w.director.fireAlarm(fa.pos),
        },
      ],
    });
  }
  // ---------------------------------------------------------------- Notes
  const note = (id: string, name: string, pos: V2, intel: string) =>
    out.push({
      id,
      name,
      pos: () => pos,
      range: 1.3,
      bias: 0.3,
      actions: (w) => [{ id: 'read', label: '읽기', anim: 'read', dur: 0.6, run: (w) => w.readNote(intel) }],
    });
  note('note_staff', '직원 게시판', { x: 16.9, z: 22.75 }, 'intel_coffee');
  note('note_security', '근무 일지', { x: 23.2, z: 18.0 }, 'intel_alarm');

  // ---------------------------------------------------------------- Duck case
  out.push({
    id: 'case',
    name: '황금 오리 진열장',
    pos: () => ({ x: 36, z: 18 }),
    range: 2.05,
    actions: (w) => caseActions(w),
  });

  // ---------------------------------------------------------------- Exits
  out.push({
    id: 'boat',
    name: '선착장 보트',
    pos: () => ({ x: 61, z: 1.5 }),
    range: 1.6,
    actions: (w) => [
      {
        id: 'row',
        label: '보트를 타고 탈출',
        dur: 1.5,
        anim: 'reach',
        disabled: !w.player.hasGoldenDuck() ? '황금 오리 없이 떠날 순 없다' : w.closestChaser() < 5 ? '쫓기는 중엔 보트를 풀 시간이 없다' : undefined,
        run: (w) => w.escape('boat'),
      },
    ],
  });
  out.push({
    id: 'van',
    name: '배달 밴',
    pos: () => ({ x: 5.35, z: 26.5 }),
    range: 1.5,
    actions: (w) => [
      {
        id: 'drive',
        label: '밴을 몰고 탈출',
        dur: 1.8,
        anim: 'reach',
        sfx: 'engine',
        disabled: !w.player.hasItem('key_van')
          ? '밴 열쇠가 필요하다'
          : !w.player.hasGoldenDuck()
            ? '황금 오리 없이 떠날 순 없다'
            : w.closestChaser() < 4
              ? '쫓기는 중이라 시동 걸 틈이 없다'
              : undefined,
        run: (w) => w.escape('van'),
      },
    ],
  });

  // ---------------------------------------------------------------- Bins
  for (const bin of w.bins.values()) {
    out.push({
      id: 'bin:' + bin.id,
      name: bin.name,
      pos: () => bin.pos,
      range: bin.id === 'dumpster' ? 1.7 : 1.2,
      actions: (w) => {
        const acts: ActionDef[] = [];
        const h = w.player.hand;
        if (h && h.type !== 'shards') {
          acts.push({
            id: 'put',
            label: `${h.name} 버리기(숨기기)`,
            dur: 0.8,
            anim: 'reach',
            illegal: h.type === 'golden_duck' ? '황금 오리를 쓰레기통에 숨긴다' : undefined,
            disabled: bin.items.length >= bin.capacity ? '꽉 찼다' : undefined,
            run: (w) => w.putInBin(bin.id),
          });
        }
        if (bin.items.length) {
          const top = bin.items[bin.items.length - 1];
          acts.push({
            id: 'take',
            label: `뒤져서 ${top.name} 꺼내기`,
            dur: 1.2,
            anim: 'search',
            disabled: w.player.hand && top.def.size === 'hand' && !w.player.hand.def.container ? '손이 비어 있어야 한다' : undefined,
            run: (w) => w.takeFromBin(bin.id),
          });
        }
        if (!acts.length) acts.push({ id: 'look', label: '들여다보기', run: (w) => w.events.emit('notify', { text: '비어 있다.', kind: 'info' }) });
        return acts;
      },
    });
  }

  // ---------------------------------------------------------------- Hiding spots
  for (const h of w.hideSpots) {
    out.push({
      id: 'hide:' + h.id,
      name: h.name,
      pos: () => h.pos,
      range: h.kind === 'bush' ? 1.45 : h.kind === 'table' ? 2.2 : 1.35,
      bias: 0.2,
      actions: (w) => hideActions(w, h),
    });
  }

  // ---------------------------------------------------------------- NPCs (pickpocket / sleeping)
  for (const n of w.npcs) {
    out.push({
      id: 'npc:' + n.id,
      name: n.name,
      pos: () => n.pos,
      range: 1.35,
      bias: 0.1,
      actions: (w) => npcActions(w, n),
    });
  }

  // ---------------------------------------------------------------- Self
  out.push({
    id: 'self',
    name: '나',
    pos: () => p().pos,
    range: 99,
    bias: 3,
    actions: (w) => selfActions(w),
  });
  return out;
}

function doorActions(w: World, d: DoorState): ActionDef[] {
  const p = w.player;
  const keys = p.keys();
  const acts: ActionDef[] = [];
  if (d.def.gate && d.locked) {
    return [{ id: 'gate', label: '문 열기', disabled: '봉쇄로 굳게 잠겨 있다', run: () => {} }];
  }
  if (d.open) {
    acts.push({ id: 'close', label: '문 닫기', run: (w) => w.setDoorOpen(d, false, 'player', p.pos) });
    return acts;
  }
  if (!d.locked) {
    acts.push({ id: 'open', label: '문 열기', run: (w) => w.setDoorOpen(d, true, 'player', p.pos) });
    if (d.def.lock && keys.has(d.def.lock))
      acts.push({ id: 'lock', label: '열쇠로 잠그기', dur: 0.8, anim: 'reach', sfx: 'unlock', run: (w) => w.setDoorLocked(d, true, 'player') });
    return acts;
  }
  const need: KeyId | undefined = d.def.lock;
  if (need && keys.has(need)) {
    acts.push({
      id: 'unlock',
      label: `${ITEMS[need].name}로 열기`,
      dur: 0.8,
      anim: 'reach',
      sfx: 'unlock',
      illegal: d.def.id === 'd_gallery' || d.def.id === 'd_study_gallery' ? '전시실 문을 연다' : undefined,
      run: (w) => {
        w.setDoorLocked(d, false, 'player');
        w.setDoorOpen(d, true, 'player', p.pos);
      },
    });
  } else if (d.def.pickable) {
    acts.push({
      id: 'pick',
      label: '자물쇠 따기',
      dur: 5,
      illegal: '자물쇠를 따고 있다',
      anim: 'lockpick',
      run: (w) => {
        w.setDoorLocked(d, false, 'player');
        d.tampered = true;
        w.stats.lockpicks++;
        w.events.emit('notify', { text: '찰칵! 자물쇠를 땄다.', kind: 'good' });
        w.setDoorOpen(d, true, 'player', p.pos);
      },
      during: (w, dt) => {
        if (w.rng.next() < dt * 3) w.events.emit('sfx', { name: 'lockpick', x: d.center.x, z: d.center.z, volume: 0.5 });
        if (w.rng.next() < dt * 0.8) w.emitNoise({ pos: { ...d.center }, radius: 3.5, kind: 'step', source: 'player' });
      },
    });
  } else {
    acts.push({ id: 'locked', label: '문 열기', disabled: need ? `잠겨 있다 — ${ITEMS[need].name} 필요` : '잠겨 있다', run: () => {} });
  }
  return acts;
}

function windowActions(w: World, win: WindowState): ActionDef[] {
  const p = w.player;
  const side = win.def.axis === 'h' ? (p.pos.z < win.def.at ? -1 : 1) : p.pos.x < win.def.at ? -1 : 1;
  const insideSide = win.inward.x + win.inward.z; // -1 or 1
  const inside = side === insideSide;
  if (!win.open) {
    if (!inside && !win.def.outsideOpen) return [{ id: 'open', label: '창문 열기', disabled: '바깥에서는 열 수 없다 (안쪽 걸쇠)', run: () => {} }];
    return [{ id: 'open', label: '창문 열기', dur: 0.6, anim: 'reach', sfx: 'door_open', run: (w) => w.setWindow(win, true, 'player') }];
  }
  return [
    {
      id: 'climb',
      label: '창문 넘기',
      dur: 0.9,
      illegal: '창문을 넘는다',
      anim: 'reach',
      disabled: p.hand && (p.hand.type === 'tray') ? '쟁반을 들고는 못 넘는다' : undefined,
      run: (w) => w.climbWindow(win),
    },
    { id: 'close', label: '창문 닫기', dur: 0.5, anim: 'reach', run: (w) => w.setWindow(win, false, 'player') },
  ];
}

function caseActions(w: World): ActionDef[] {
  const p = w.player;
  const shown = w.caseItem;
  const h = p.hand;
  const acts: ActionDef[] = [];
  const armed = w.security.alarmArmed && w.power.on('C');
  if (shown && shown.type === 'golden_duck') {
    if (h && h.type === 'fake_duck') {
      acts.push({
        id: 'swap',
        label: '가짜 오리와 바꿔치기',
        dur: 1.6,
        illegal: '황금 오리를 바꿔치기한다',
        anim: 'grab',
        run: (w) => w.swapDuck(),
      });
    }
    if (!h || (h.def.container && !h.contents)) {
      acts.push({
        id: 'take',
        label: h ? `황금 오리를 ${h.name}에 담기${armed ? ' (경보 주의!)' : ''}` : `황금 오리 들어 올리기${armed ? ' (경보 주의!)' : ''}`,
        dur: 1.3,
        illegal: '황금 오리를 훔친다',
        anim: 'grab',
        run: (w) => w.takeDuckFromCase(),
      });
    } else if (!acts.length) {
      acts.push({ id: 'take', label: '황금 오리 들어 올리기', disabled: '손에 든 것을 먼저 내려놓자', run: () => {} });
    }
    acts.push({ id: 'look', label: '살펴보기', run: (w) => w.events.emit('notify', { text: w.content.caseHint(w), kind: 'info' }) });
  } else if (shown && shown.type === 'fake_duck') {
    if (h && h.type === 'golden_duck')
      acts.push({ id: 'putback', label: '진짜 오리 되돌려 놓기', dur: 1.2, anim: 'grab', run: (w) => w.swapDuck() });
    acts.push({ id: 'look', label: '살펴보기', run: (w) => w.events.emit('notify', { text: '고무 오리가 늠름하게 진열되어 있다. 가까이서 보면 들킬지도...', kind: 'info' }) });
  } else {
    if (h && isDuck(h.type)) {
      acts.push({
        id: 'place',
        label: h.type === 'golden_duck' ? '황금 오리 되돌려 놓기' : '가짜 오리 올려놓기',
        dur: 1.2,
        anim: 'grab',
        illegal: h.type === 'fake_duck' ? '진열장에 뭔가를 올려놓는다' : undefined,
        run: (w) => w.placeOnCase(),
      });
    } else acts.push({ id: 'look', label: '빈 진열장', run: (w) => w.events.emit('notify', { text: '진열장이 비어 있다.', kind: 'info' }) });
  }
  return acts;
}

function hideActions(w: World, h: HideSpot): ActionDef[] {
  const p = w.player;
  if (p.hidden === h) return [{ id: 'exit', label: '밖으로 나오기', run: (w) => w.player.exitHide(w) }];
  const occupied = w.hideOccupied(h);
  return [
    {
      id: 'hide',
      label: `${h.name}에 숨기`,
      dur: 0.5,
      anim: 'reach',
      illegal: '수상하게 숨어든다',
      disabled: occupied ? '누가 쓰고 있다' : p.hand && p.hand.def.size === 'hand' && h.kind !== 'bush' && h.kind !== 'table' ? '큰 물건을 들고는 못 들어간다' : undefined,
      run: (w) => w.player.enterHide(w, h),
    },
  ];
}

function npcActions(w: World, n: Npc): ActionDef[] {
  const p = w.player;
  if (!n.active) return [];
  const acts: ActionDef[] = [];
  const asleep = !n.awake;
  const behind = Math.abs(angleDiff(n.facing, angleOf({ x: p.pos.x - n.pos.x, z: p.pos.z - n.pos.z }))) > 1.75;
  const stealable = n.pockets.filter((i) => i.state === 'pocket');
  if (asleep) {
    if (stealable.length)
      acts.push({
        id: 'loot',
        label: `주머니 뒤지기 (${stealable.map((i) => i.name).join(', ')})`,
        dur: 1.6,
        illegal: '잠든 사람의 주머니를 뒤진다',
        anim: 'search',
        run: (w) => w.pickpocket(n, true),
      });
    if (n.uniform && !n.stripped)
      acts.push({
        id: 'strip',
        label: `${OUTFITS[n.uniform].name} 벗겨 입기`,
        dur: 3,
        illegal: '잠든 사람의 옷을 벗긴다',
        anim: 'grab',
        sfx: 'cloth',
        run: (w) => w.stripNpc(n),
      });
    return acts;
  }
  if (!stealable.length) return acts;
  const label = `소매치기: ${stealable.map((i) => i.name).join(', ')}`;
  acts.push({
    id: 'pick',
    label,
    dur: 1.2,
    illegal: '소매치기를 한다',
    anim: 'reach',
    disabled: !behind ? '등 뒤에서만 가능하다' : n.moving && n.speed > 2.2 ? '너무 빨리 움직인다' : undefined,
    run: (w) => w.pickpocket(n, false),
  });
  void dist;
  return acts;
}

function selfActions(w: World): ActionDef[] {
  const p = w.player;
  const acts: ActionDef[] = [];
  if (p.hasItem('rubber_duck') && p.hasItem('gold_paint') && !p.hand) {
    acts.push({
      id: 'paint',
      label: '고무 오리를 금색으로 칠하기',
      dur: 3,
      illegal: '수상한 칠 작업을 한다',
      anim: 'paint',
      run: (w) => w.paintDuck(),
    });
  }
  if (p.hand && p.hand.contents) {
    acts.push({
      id: 'takeout',
      label: `${p.hand.name}에서 ${p.hand.contents.name} 꺼내기`,
      dur: 0.6,
      anim: 'reach',
      illegal: p.hand.contents.type === 'golden_duck' ? '황금 오리를 꺼낸다' : undefined,
      run: (w) => w.takeOutOfContainer(),
    });
  }
  return acts;
}

/** Interactions for a loose item. */
export function itemActions(w: World, it: Item): ActionDef[] {
  const p = w.player;
  const h = p.hand;
  const acts: ActionDef[] = [];
  const isPocket = it.def.size === 'pocket';
  const illegal = it.type === 'golden_duck' ? '황금 오리를 줍는다' : undefined;
  if (it.def.container && it.contents && !h) {
    acts.push({ id: 'pick', label: `줍기: ${it.name} (안에 ${it.contents.name})`, dur: 0.35, anim: 'reach', illegal, run: () => pick(w, it) });
    return acts;
  }
  if (isPocket || !h) {
    acts.push({ id: 'pick', label: `줍기: ${it.name}`, dur: 0.35, anim: 'reach', illegal, run: () => pick(w, it) });
  } else if (h.def.container && !h.contents && it.def.fits) {
    acts.push({ id: 'put', label: `${h.name}에 ${it.name} 담기`, dur: 0.7, anim: 'reach', illegal, run: () => w.putIntoHeld(it) });
  } else if (it.def.container && !it.contents && h.def.fits) {
    acts.push({ id: 'putin', label: `${it.name}에 ${h.name} 넣고 들기`, dur: 0.8, anim: 'reach', run: () => w.putHeldInto(it) });
  } else {
    acts.push({ id: 'swap', label: `${h.name} 내려놓고 ${it.name} 들기`, dur: 0.5, anim: 'reach', illegal, run: () => w.swapHand(it) });
  }
  return acts;
}
