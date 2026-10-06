// Game rules: outfits, zones, items.
import type { KeyId, OutfitId, Zone } from './level/types';

export interface OutfitDef {
  id: OutfitId;
  name: string;
  /** Zones where wearing this outfit is normal. */
  zones: Zone[];
  /** Short description shown in the HUD. */
  desc: string;
  icon: string;
}

export const OUTFITS: Record<OutfitId, OutfitDef> = {
  guest: {
    id: 'guest',
    name: '파티 정장',
    zones: ['street', 'public'],
    desc: '손님 구역(연회장·정원 등)에서 자연스럽다.',
    icon: '🤵',
  },
  waiter: {
    id: 'waiter',
    name: '웨이터 제복',
    zones: ['street', 'public', 'staff'],
    desc: '손님 구역과 직원 구역 모두 다닐 수 있다. 집사와 주방장은 얼굴을 알아볼 수 있다.',
    icon: '🍸',
  },
  chef: {
    id: 'chef',
    name: '요리사 복장',
    zones: ['street', 'staff'],
    desc: '주방과 직원 구역에서 자연스럽다. 주방장은 낯선 요리사를 알아본다.',
    icon: '👨‍🍳',
  },
  guard: {
    id: 'guard',
    name: '경비원 제복',
    zones: ['street', 'public', 'staff', 'sec_security', 'sec_elec', 'sec_study', 'sec_shed'],
    desc: '전시실을 뺀 거의 모든 곳을 다닐 수 있다. 보안실장은 부하 얼굴을 다 안다.',
    icon: '💂',
  },
  electrician: {
    id: 'electrician',
    name: '전기기사 작업복',
    zones: ['street', 'staff', 'sec_elec'],
    desc: '직원 구역과 전기실 출입 가능. 정전 중에는 어디서든 수리 중인 척할 수 있다.',
    icon: '🔧',
  },
};

export const ZONE_NAMES: Record<Zone, string> = {
  street: '거리',
  public: '손님 구역',
  staff: '직원 구역',
  sec_elec: '전기실 (출입 제한)',
  sec_security: '보안실 (출입 제한)',
  sec_gallery: '전시실 (출입 제한)',
  sec_study: '회장 서재 (출입 제한)',
  sec_shed: '정원 창고 (출입 제한)',
};

export type ItemType =
  | 'golden_duck'
  | 'fake_duck'
  | 'rubber_duck'
  | 'gold_paint'
  | 'sleeping_pills'
  | 'laxative'
  | 'lighter'
  | 'invitation'
  | 'gift_box'
  | 'tray'
  | 'bottle'
  | 'vase'
  | 'shards'
  | 'wrench'
  | KeyId;

export interface ItemDef {
  type: ItemType;
  name: string;
  /** pocket: small, goes to pockets. hand: carried visibly. */
  size: 'pocket' | 'hand';
  icon: string;
  desc: string;
  /** Carrying this visibly is a crime (duck). */
  contraband?: boolean;
  /** Carrying this visibly is a bit odd unless wearing a matching outfit. */
  odd?: OutfitId[];
  throwable?: boolean;
  fragile?: boolean;
  container?: boolean;
  /** Fits inside containers. */
  fits?: boolean;
}

export const ITEMS: Record<ItemType, ItemDef> = {
  golden_duck: {
    type: 'golden_duck',
    name: '황금 오리',
    size: 'hand',
    icon: '🦆',
    desc: '오덕수 회장의 보물. 들고 다니면 누구든 알아본다.',
    contraband: true,
    throwable: true,
    fits: true,
  },
  fake_duck: {
    type: 'fake_duck',
    name: '가짜 황금 오리',
    size: 'hand',
    icon: '🐤',
    desc: '금색으로 칠한 고무 오리. 멀리서 보면 진짜와 똑같다.',
    contraband: true,
    throwable: true,
    fits: true,
  },
  rubber_duck: {
    type: 'rubber_duck',
    name: '고무 오리',
    size: 'pocket',
    icon: '🐥',
    desc: '욕실 장난감. 크기가 황금 오리와 비슷하다.',
    fits: true,
  },
  gold_paint: { type: 'gold_paint', name: '금색 페인트', size: 'pocket', icon: '🎨', desc: '정원 오리 동상을 칠하던 페인트.' },
  sleeping_pills: { type: 'sleeping_pills', name: '수면제', size: 'pocket', icon: '💊', desc: '음료에 타면 마신 사람이 곯아떨어진다.' },
  laxative: { type: 'laxative', name: '설사약', size: 'pocket', icon: '🧪', desc: '음료에 타면 마신 사람이 화장실로 달려간다.' },
  lighter: { type: 'lighter', name: '라이터', size: 'pocket', icon: '🔥', desc: '불을 붙일 수 있다.' },
  invitation: { type: 'invitation', name: '초대장', size: 'pocket', icon: '✉️', desc: '정문 경비에게 보여주면 정식 손님이 된다.' },
  gift_box: {
    type: 'gift_box',
    name: '선물 상자',
    size: 'hand',
    icon: '🎁',
    desc: '손님이 들고 다녀도 이상하지 않다. 안에 물건을 숨길 수 있다.',
    container: true,
    throwable: true,
    odd: ['guard', 'chef', 'electrician'],
  },
  tray: {
    type: 'tray',
    name: '은쟁반',
    size: 'hand',
    icon: '🍽️',
    desc: '뚜껑 덮인 은쟁반. 웨이터가 들면 자연스럽다. 안에 물건을 숨길 수 있다.',
    container: true,
    odd: ['guest', 'guard', 'electrician'],
  },
  bottle: { type: 'bottle', name: '와인병', size: 'hand', icon: '🍾', desc: '던지면 깨지면서 큰 소리가 난다.', throwable: true, fragile: true },
  vase: { type: 'vase', name: '꽃병', size: 'hand', icon: '🏺', desc: '던지면 요란하게 깨진다.', throwable: true, fragile: true },
  shards: { type: 'shards', name: '깨진 조각', size: 'hand', icon: '✨', desc: '누군가 치워야 할 것이다.' },
  wrench: {
    type: 'wrench',
    name: '렌치',
    size: 'hand',
    icon: '🔧',
    desc: '무거운 공구. 전기기사가 아니면 들고 다니기 수상하다.',
    throwable: true,
    odd: ['guest', 'waiter', 'chef'],
  },
  key_gallery: { type: 'key_gallery', name: '전시실 열쇠', size: 'pocket', icon: '🗝️', desc: '전시실 정문을 연다.' },
  key_study: { type: 'key_study', name: '서재 열쇠', size: 'pocket', icon: '🔑', desc: '회장 서재와 전시실로 통하는 비밀문을 연다.' },
  key_elec: { type: 'key_elec', name: '전기실 열쇠', size: 'pocket', icon: '🔑', desc: '전기실 문을 연다.' },
  key_shed: { type: 'key_shed', name: '창고 열쇠', size: 'pocket', icon: '🔑', desc: '정원 창고 문을 연다.' },
  key_van: { type: 'key_van', name: '배달 밴 열쇠', size: 'pocket', icon: '🚐', desc: '서비스 마당의 배달 밴 열쇠.' },
};

export const KEY_TYPES: ItemType[] = ['key_gallery', 'key_study', 'key_elec', 'key_shed', 'key_van'];
export const isKey = (t: ItemType): t is KeyId => (KEY_TYPES as string[]).includes(t);
export const isDuck = (t: ItemType) => t === 'golden_duck' || t === 'fake_duck';

/** Movement constants. */
export const PLAYER_SPEED = { walk: 3.3, run: 5.7, crouch: 1.9 };
export const NPC_SPEED = { stroll: 1.35, walk: 1.75, fast: 2.6, run: 4.6, chase: 5.0 };
export const CHAR_RADIUS = 0.3;
