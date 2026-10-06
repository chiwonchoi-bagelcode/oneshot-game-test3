// People, places, rumours and lines: everything that makes the party feel alive.
import type { V2 } from '../../core/math';
import type { Appearance } from '../look';
import type { Report } from '../npc/behaviors';
import type { Npc, NpcDef, SusReason } from '../npc/Npc';
import type { Task } from '../npc/routine';
import type { HideSpot } from '../Player';
import { OUTFITS, type ItemType } from '../rules';
import type { World } from '../World';
import type { OutfitId, StationDef, Zone } from './types';

const N = Math.PI;
const S = 0;
const E = Math.PI / 2;
const W = -Math.PI / 2;

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------
const ST: [string, number, number, number][] = [
  ['st_doorman', 36, 57.6, S],
  ['st_svcguard', 6.4, 57.2, W],
  ['st_smoke_a', 9.4, 35.8, S],
  ['st_smoke_b', 9.4, 37.1, N],
  ['st_galguard', 36, 23.7, S],
  ['st_cooler', 31.5, 23.3, N],
  ['st_operator', 20.5, 15.75, N],
  ['st_coffee', 13.35, 23.5, W],
  ['st_staff_sofa', 15.5, 27.55, N],
  ['st_staff_sofa2', 14.6, 27.55, N],
  ['st_staff_sofa3', 16.4, 27.55, N],
  ['st_guard_locker', 18.2, 16.5, W],
  ['st_staff_locker', 17.85, 24.5, E],
  ['st_fusebox', 14.5, 15.05, N],
  ['st_secdesk', 22.6, 15.95, N],
  ['st_case', 36, 19.65, N],
  ['st_case_look', 36, 18, N],
  ['st_tour_door', 36, 23.3, N],
  ['st_podium', 36.5, 26.45, S],
  ['st_piano', 30.05, 32.5, W],
  ['st_bar', 51, 34.45, N],
  ['st_bar_front1', 50.2, 32.45, S],
  ['st_bar_front2', 51.8, 32.45, S],
  ['st_punch', 45.6, 27.5, E],
  ['st_buffet1', 26.5, 42.4, S],
  ['st_buffet2', 29.5, 42.4, S],
  ['st_butler', 37, 40.6, S],
  ['st_butler_dining', 30.6, 37.3, W],
  ['st_butler_ball', 36.5, 33.6, N],
  ['st_pantry', 21.5, 25.5, W],
  ['st_stove', 15.5, 33.65, N],
  ['st_plating', 20, 34.45, S],
  ['st_prep', 18.5, 30.35, N],
  ['st_sink', 17, 42.55, S],
  ['st_pass', 20, 36.6, N],
  ['st_wc_wait', 46.5, 41.5, E],
  ['st_dumpster', 9.5, 40.4, S],
  ['st_evan', 6.6, 49.2, W],
  ['st_eyard', 8, 30, W],
  ['st_shed_in', 3.4, 5.2, W],
  ['st_hedge1', 21.4, 4.5, E],
  ['st_hedge2', 11.6, 6, W],
  ['st_hedge3', 30, 11.4, S],
  ['st_fireworks', 28, 5.4, N],
  ['st_maid_wc', 50, 40, E],
  ['st_maid_bath', 55, 38, S],
  ['st_maid_lib', 28.5, 19.4, N],
  ['st_maid_study', 44.5, 19.8, N],
  ['st_maid_gal', 41, 23.5, N],
  ['st_maid_cons', 54, 17, N],
  ['st_maid_foyer', 35, 38.2, E],
  ['st_late', 54.6, 61.3, W],
  ['st_assembly', 36.5, 47, N],
  ['st_jukebox', 58.8, 26.3, E],
  ['st_read1', 28.5, 16.35, S],
  ['st_read2', 30.35, 18.5, W],
  ['st_art1', 30, 23.05, N],
  ['st_art2', 42.5, 23.05, N],
  ['st_art3', 54, 26.1, N],
  ['st_art4', 35.5, 15.2, N],
  ['st_dance1', 35.2, 29.6, S],
  ['st_dance2', 37.8, 29.4, W],
  ['st_dance3', 36.4, 31.4, N],
  ['st_dance4', 38.3, 31.2, E],
  // Chief's beat
  ['c_sec', 21.6, 17.3, N],
  ['c_hall', 19, 20.5, E],
  ['c_svc', 25, 27, S],
  ['c_gal', 34.4, 23.6, E],
  ['c_ball', 40, 29.6, S],
  ['c_foyer', 37, 38.5, S],
  ['c_front', 37, 47, S],
  ['c_lounge', 53, 31.6, E],
  ['c_cons', 54, 19.6, N],
  ['c_galhall_e', 45, 23.6, W],
  // Back garden patrol
  ['pb1', 7, 10.5, W],
  ['pb2', 16, 11.2, S],
  ['pb3', 26.5, 7, N],
  ['pb4', 38.5, 10.5, N],
  ['pb5', 50, 8.5, E],
  ['pb6', 61, 5.2, N],
  ['pb7', 64.5, 14.5, S],
  ['pb8', 55, 12.6, W],
  ['pb9', 42.5, 3, W],
  ['pb10', 24.5, 11.6, N],
  // Front patrol
  ['pf1', 36.5, 46.4, S],
  ['pf2', 20, 46.5, W],
  ['pf3', 13.6, 51.5, W],
  ['pf4', 22, 57.6, S],
  ['pf5', 45, 57.8, S],
  ['pf6', 58, 52, E],
  ['pf7', 65, 46, N],
  ['pf8', 63, 39.5, W],
  ['pf9', 63.6, 28, N],
  ['pf10', 65, 46.5, S],
  ['pf11', 52, 46.5, W],
  // Inside patrol
  ['pi1', 18.5, 20.5, E],
  ['pi2', 25, 17, S],
  ['pi3', 28.5, 20.6, N],
  ['pi4', 40, 23.6, E],
  ['pi5', 53, 22.5, S],
  ['pi6', 54, 31.6, W],
  ['pi7', 37, 27.6, S],
  ['pi8', 37, 41.5, S],
  ['pi9', 30.5, 37.3, W],
  ['pi10', 25, 30.5, N],
  ['pi11', 18, 32, W],
  ['pd1', 34.6, 57.4, S],
  ['pd2', 37.6, 57.4, S],
];

export const STATIONS: StationDef[] = ST.map(([id, x, z, face]) => ({ id, x, z, face }));

// ---------------------------------------------------------------------------
// Conversation spots
// ---------------------------------------------------------------------------
export interface SpotDef {
  id: string;
  x: number;
  z: number;
  slots: number;
  r?: number;
  room: string;
}
export const SPOTS: SpotDef[] = [
  { id: 'sp_ball1', x: 34, z: 30.2, slots: 4, room: 'ballroom' },
  { id: 'sp_ball2', x: 39.6, z: 31, slots: 3, room: 'ballroom' },
  { id: 'sp_ball3', x: 29.6, z: 27.4, slots: 3, room: 'ballroom' },
  { id: 'sp_ball4', x: 44, z: 31.2, slots: 3, room: 'ballroom' },
  { id: 'sp_ball5', x: 37, z: 33.7, slots: 3, room: 'ballroom' },
  { id: 'sp_lounge1', x: 52, z: 29.5, slots: 3, room: 'lounge' },
  { id: 'sp_lounge2', x: 57.8, z: 32.8, slots: 2, room: 'lounge' },
  { id: 'sp_foyer', x: 35, z: 41.6, slots: 3, room: 'foyer' },
  { id: 'sp_cons1', x: 54, z: 18.6, slots: 3, room: 'conserv' },
  { id: 'sp_cons2', x: 52.5, z: 23, slots: 2, room: 'conserv' },
  { id: 'sp_terrace1', x: 53.5, z: 10.5, slots: 4, room: 'backgarden' },
  { id: 'sp_terrace2', x: 56.5, z: 12.8, slots: 2, room: 'backgarden' },
  { id: 'sp_gazebo', x: 16, z: 8, slots: 3, room: 'backgarden' },
  { id: 'sp_fount', x: 40, z: 8.4, slots: 2, room: 'backgarden' },
  { id: 'sp_front1', x: 30.5, z: 50.5, slots: 3, room: 'frontyard' },
  { id: 'sp_front2', x: 42, z: 49.6, slots: 3, room: 'frontyard' },
  { id: 'sp_front3', x: 36.5, z: 46.1, slots: 2, room: 'frontyard' },
];

// ---------------------------------------------------------------------------
// Hiding spots
// ---------------------------------------------------------------------------
export const HIDE_SPOTS: HideSpot[] = [
  { id: 'h_locker', name: '사물함', pos: { x: 18.55, z: 25.5 }, exit: { x: 17.6, z: 25.5 }, kind: 'locker' },
  { id: 'h_wardrobe', name: '옷장', pos: { x: 41.45, z: 20.5 }, exit: { x: 42.4, z: 20.5 }, kind: 'wardrobe' },
  { id: 'h_closet', name: '코트 옷장', pos: { x: 47.5, z: 37.5 }, exit: { x: 46.5, z: 37.5 }, kind: 'closet' },
  { id: 'h_table', name: '식탁 밑', pos: { x: 28, z: 39.5 }, exit: { x: 28, z: 41.2 }, kind: 'table' },
  { id: 'h_stall', name: '화장실 칸', pos: { x: 51, z: 36.1 }, exit: { x: 51, z: 37.6 }, kind: 'stall' },
  { id: 'h_bush_gal1', name: '덤불', pos: { x: 33.5, z: 12.5 }, exit: { x: 33.5, z: 11.4 }, kind: 'bush' },
  { id: 'h_bush_gal2', name: '덤불', pos: { x: 38.5, z: 12.5 }, exit: { x: 38.5, z: 11.4 }, kind: 'bush' },
  { id: 'h_bush_garden', name: '덤불', pos: { x: 23.5, z: 10.5 }, exit: { x: 23.5, z: 9.4 }, kind: 'bush' },
  { id: 'h_bush_terrace', name: '덤불', pos: { x: 50.5, z: 6.5 }, exit: { x: 50.5, z: 7.6 }, kind: 'bush' },
  { id: 'h_bush_yard', name: '덤불', pos: { x: 1.5, z: 52.5 }, exit: { x: 2.6, z: 52.5 }, kind: 'bush' },
  { id: 'h_bush_front1', name: '덤불', pos: { x: 14.5, z: 45.5 }, exit: { x: 14.5, z: 46.6 }, kind: 'bush' },
  { id: 'h_bush_front2', name: '덤불', pos: { x: 42.5, z: 45.5 }, exit: { x: 42.5, z: 46.6 }, kind: 'bush' },
  { id: 'h_bush_front3', name: '덤불', pos: { x: 58.5, z: 45.5 }, exit: { x: 58.5, z: 46.6 }, kind: 'bush' },
  { id: 'h_bush_gap', name: '덤불', pos: { x: 67.5, z: 56.5 }, exit: { x: 67.5, z: 57.6 }, kind: 'bush' },
  { id: 'h_bush_east1', name: '덤불', pos: { x: 61.5, z: 41.5 }, exit: { x: 62.6, z: 41.5 }, kind: 'bush' },
  { id: 'h_bush_east2', name: '덤불', pos: { x: 61.5, z: 36.5 }, exit: { x: 62.6, z: 36.5 }, kind: 'bush' },
];

// ---------------------------------------------------------------------------
// Items lying around at the start
// ---------------------------------------------------------------------------
export const ITEM_SPAWNS: { type: ItemType; x: number; z: number; y: number; variant?: number }[] = [
  { type: 'gift_box', x: 32.6, z: 36.5, y: 0.8, variant: 0 },
  { type: 'gift_box', x: 32.6, z: 37.5, y: 0.8, variant: 1 },
  { type: 'gift_box', x: 32.6, z: 37.0, y: 1.15, variant: 2 },
  { type: 'tray', x: 23.55, z: 36.0, y: 0.9 },
  { type: 'tray', x: 23.55, z: 37.0, y: 0.9 },
  { type: 'bottle', x: 50.0, z: 33.5, y: 1.05 },
  { type: 'bottle', x: 52.0, z: 33.5, y: 1.05 },
  { type: 'bottle', x: 21.5, z: 28.3, y: 0.0 },
  { type: 'vase', x: 33.5, z: 22.45, y: 0.6 },
  { type: 'vase', x: 31.0, z: 28.0, y: 0.76 },
  { type: 'vase', x: 59.3, z: 34.3, y: 0.6 },
  { type: 'rubber_duck', x: 57.4, z: 41.65, y: 0.62 },
  { type: 'gold_paint', x: 2.6, z: 5.0, y: 1.0 },
];

export const BINS: { id: string; name: string; x: number; z: number; capacity: number }[] = [
  { id: 'trash_kitchen', name: '주방 쓰레기통', x: 22.6, z: 42.6, capacity: 3 },
  { id: 'trash_galhall', name: '복도 쓰레기통', x: 41.5, z: 24.6, capacity: 2 },
  { id: 'dumpster', name: '대형 쓰레기통', x: 9.5, z: 41.5, capacity: 8 },
];

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------
const SK = ['#f3cfb3', '#e8b796', '#d39c7a', '#b9805c', '#8d5b3e', '#f7dcc6'];
const guard = (o: Partial<Appearance> = {}): Appearance => ({
  skin: SK[0],
  hair: '#3b2a20',
  hairStyle: 'short',
  top: '#3d4f7a',
  bottom: '#2c3654',
  accent: '#e8c547',
  outfit: 'guard',
  hat: 'guard_cap',
  ...o,
});
const waiter = (o: Partial<Appearance> = {}): Appearance => ({
  skin: SK[1],
  hair: '#2a1d16',
  hairStyle: 'short',
  top: '#2b2b30',
  bottom: '#26262b',
  accent: '#c0392b',
  outfit: 'waiter',
  hat: 'none',
  ...o,
});
const chef = (o: Partial<Appearance> = {}): Appearance => ({
  skin: SK[0],
  hair: '#4a3324',
  hairStyle: 'short',
  top: '#f6f4ee',
  bottom: '#4b4b55',
  accent: '#d94f4f',
  outfit: 'chef',
  hat: 'chef_toque',
  ...o,
});
const elec = (o: Partial<Appearance> = {}): Appearance => ({
  skin: SK[2],
  hair: '#2d2018',
  hairStyle: 'short',
  top: '#e9e2cf',
  bottom: '#3d6fb5',
  accent: '#f4c542',
  outfit: 'electrician',
  hat: 'hard_hat',
  ...o,
});

export const PLAYER_LOOKS: Record<OutfitId, Appearance> = {
  guest: { skin: '#f2c9a8', hair: '#2b1d14', hairStyle: 'spiky', top: '#2f5d62', bottom: '#22343a', accent: '#5fd38d', outfit: 'tux', hat: 'none' },
  waiter: waiter({ skin: '#f2c9a8', hair: '#2b1d14', hairStyle: 'spiky', accent: '#5fd38d' }),
  chef: chef({ skin: '#f2c9a8', hair: '#2b1d14', hairStyle: 'spiky' }),
  guard: guard({ skin: '#f2c9a8', hair: '#2b1d14', hairStyle: 'spiky' }),
  electrician: elec({ skin: '#f2c9a8', hair: '#2b1d14', hairStyle: 'spiky' }),
};
export const UNDERWEAR_LOOK = (base: Appearance): Appearance => ({
  ...base,
  top: '#f4f1ea',
  bottom: '#e9a6a6',
  accent: '#f4f1ea',
  outfit: 'casual',
  hat: 'none',
});

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------
const PUBLIC: Zone[] = ['street', 'public'];
const STAFFZ: Zone[] = ['street', 'public', 'staff'];
const ALLZ: Zone[] = ['street', 'public', 'staff', 'sec_elec', 'sec_security', 'sec_gallery', 'sec_study', 'sec_shed'];

const guestTask: Task[] = [{ k: 'guest' }];

export const NPCS: NpcDef[] = [
  // ---- Guards
  {
    id: 'doorman',
    name: '정문 경비 박문수',
    role: 'guard',
    job: 'doorman',
    look: guard({ facial: 'mustache', skin: SK[1] }),
    pitch: 0.82,
    start: { x: 36, z: 57.6 },
    face: S,
    zones: ALLZ,
    radio: true,
    flashlight: true,
    enforces: ['guest'],
    uniform: 'guard',
    routine: [
      { k: 'do', at: 'st_doorman', dur: [70, 110] },
      { k: 'patrol', route: ['pd1', 'pd2', 'st_doorman'], pause: [2, 4] },
    ],
  },
  {
    id: 'svc_guard',
    name: '쪽문 경비 최강',
    role: 'guard',
    job: 'svc_guard',
    look: guard({ skin: SK[3], hair: '#1b1b1b' }),
    pitch: 0.92,
    start: { x: 6.4, z: 57.2 },
    face: W,
    zones: ALLZ,
    radio: true,
    flashlight: true,
    uniform: 'guard',
    routine: [
      { k: 'do', at: 'st_svcguard', dur: [80, 100] },
      { k: 'do', at: 'st_smoke_b', dur: [40, 50], act: 'smoke', use: 'smoke', say: ['아이고, 다리야.', '한 대만 피우고 가야지.'] },
    ],
  },
  {
    id: 'gallery_guard',
    name: '전시실 경비 김철통',
    role: 'guard',
    job: 'gallery_guard',
    look: guard({ girth: 1.25, skin: SK[0], hairStyle: 'bald' }),
    pitch: 0.74,
    start: { x: 36, z: 23.7 },
    face: S,
    zones: ALLZ,
    radio: true,
    uniform: 'guard',
    routine: [
      { k: 'do', at: 'st_galguard', dur: [85, 105] },
      { k: 'do', at: 'st_cooler', dur: [5, 7], act: 'drink', use: 'cooler', say: ['목이 타네.', '물 한 잔만...'] },
      { k: 'do', at: 'st_galguard', dur: [85, 105] },
      { k: 'do', at: 'st_cooler', dur: [5, 7], act: 'drink', use: 'cooler' },
      { k: 'toilet' },
    ],
  },
  {
    id: 'operator',
    name: '보안실 근무자 이순찰',
    role: 'guard',
    job: 'operator',
    look: guard({ glasses: true, skin: SK[5], hairStyle: 'bob', hair: '#5a3b2a', hat: 'none' }),
    pitch: 1.08,
    start: { x: 20.5, z: 15.75 },
    face: N,
    zones: ALLZ,
    radio: true,
    uniform: 'guard',
    routine: [
      { k: 'do', at: 'st_operator', dur: [100, 130], pose: 'sit', act: 'type' },
      { k: 'do', at: 'st_coffee', dur: [7, 9], act: 'drink', use: 'coffee', say: ['커피 없인 못 살아.', '오늘 다섯 잔째인가...'] },
    ],
  },
  {
    id: 'chief',
    name: '보안실장 강철수',
    role: 'guard',
    job: 'chief',
    look: guard({ top: '#2a3354', bottom: '#20283f', facial: 'mustache', height: 1.08, girth: 1.1, skin: SK[2], hair: '#2a2a2a' }),
    pitch: 0.68,
    start: { x: 21.6, z: 17.3 },
    face: N,
    zones: ALLZ,
    keys: ['key_gallery', 'key_elec'],
    radio: true,
    flashlight: true,
    enforces: ['guard'],
    uniform: 'guard',
    routine: [
      { k: 'do', at: 'c_sec', dur: [10, 14], act: 'think' },
      { k: 'do', at: 'c_hall', dur: [2, 3] },
      { k: 'do', at: 'c_svc', dur: [2, 3] },
      { k: 'do', at: 'c_gal', dur: [14, 16] },
      { k: 'do', at: 'c_ball', dur: [5, 8] },
      { k: 'do', at: 'c_foyer', dur: [3, 5] },
      { k: 'do', at: 'c_front', dur: [6, 9] },
      { k: 'do', at: 'c_foyer', dur: [2, 3] },
      { k: 'do', at: 'c_lounge', dur: [5, 7] },
      { k: 'do', at: 'c_cons', dur: [3, 5] },
      { k: 'do', at: 'c_galhall_e', dur: [2, 4] },
    ],
  },
  {
    id: 'patrol_back',
    name: '정원 경비 오정원',
    role: 'guard',
    job: 'patrol',
    look: guard({ skin: SK[4], hair: '#151515' }),
    pitch: 0.96,
    start: { x: 38.5, z: 10.5 },
    face: N,
    zones: ALLZ,
    radio: true,
    flashlight: true,
    uniform: 'guard',
    routine: [{ k: 'patrol', route: ['pb4', 'pb5', 'pb8', 'pb6', 'pb7', 'pb5', 'pb9', 'pb3', 'pb2', 'pb1', 'pb10', 'pb4'], pause: [2, 4] }],
  },
  {
    id: 'patrol_front',
    name: '앞마당 경비 윤순찰',
    role: 'guard',
    job: 'patrol',
    look: guard({ skin: SK[1], hairStyle: 'ponytail', hair: '#2d1c12' }),
    pitch: 1.12,
    start: { x: 36.5, z: 46.4 },
    face: S,
    zones: ALLZ,
    radio: true,
    flashlight: true,
    uniform: 'guard',
    routine: [{ k: 'patrol', route: ['pf1', 'pf2', 'pf3', 'pf4', 'pf5', 'pf6', 'pf7', 'pf8', 'pf9', 'pf10', 'pf11'], pause: [2, 4] }],
  },
  {
    id: 'patrol_in',
    name: '순찰 경비 한도경',
    role: 'guard',
    job: 'patrol',
    look: guard({ skin: SK[0], hairStyle: 'bun', hair: '#3a2416' }),
    pitch: 1.18,
    start: { x: 18.5, z: 20.5 },
    face: E,
    zones: ALLZ,
    radio: true,
    flashlight: true,
    uniform: 'guard',
    routine: [
      { k: 'patrol', route: ['pi1', 'pi2', 'pi3', 'pi4', 'pi5', 'pi6', 'pi7', 'pi8', 'pi9', 'pi10', 'pi11'], pause: [2, 4] },
      { k: 'do', at: 'st_staff_sofa2', dur: [25, 35], pose: 'sit', act: 'stretch' },
    ],
  },

  // ---- Staff
  {
    id: 'butler',
    name: '집사 세바스찬',
    role: 'staff',
    job: 'butler',
    look: { skin: SK[0], hair: '#cfcfcf', hairStyle: 'slick', top: '#26262c', bottom: '#26262c', accent: '#f2f2f2', outfit: 'butler', facial: 'mustache', height: 1.06 },
    pitch: 0.86,
    start: { x: 37, z: 40.6 },
    face: S,
    zones: ALLZ,
    keys: ['key_study', 'key_elec'],
    radio: true,
    enforces: ['waiter', 'guest'],
    routine: [
      { k: 'do', at: 'st_butler', dur: [50, 70], say: ['어서 오십시오.', '즐거운 시간 되십시오.'] },
      { k: 'do', at: 'st_butler_dining', dur: [10, 15] },
      { k: 'do', at: 'st_butler_ball', dur: [10, 15], say: ['음악이 훌륭하군요.'] },
      { k: 'do', at: 'st_pantry', dur: [8, 12], act: 'search' },
    ],
  },
  {
    id: 'chef',
    name: '주방장 고든',
    role: 'staff',
    job: 'chef',
    look: chef({ facial: 'beard', hair: '#6b4a2e', girth: 1.15, skin: SK[0] }),
    pitch: 0.78,
    start: { x: 15.5, z: 33.65 },
    face: N,
    zones: STAFFZ,
    items: ['lighter'],
    enforces: ['chef', 'waiter'],
    uniform: 'chef',
    routine: [
      { k: 'do', at: 'st_stove', dur: [45, 60], act: 'cook', say: ['소금이 부족해!', '이 소스는 예술이야.'] },
      { k: 'do', at: 'st_plating', dur: [15, 22], act: 'cook' },
      { k: 'do', at: 'st_stove', dur: [30, 40], act: 'cook' },
      { k: 'do', at: 'st_smoke_a', dur: [40, 50], act: 'smoke', use: 'smoke' },
    ],
  },
  {
    id: 'cook',
    name: '요리사 민지',
    role: 'staff',
    job: 'cook',
    look: chef({ hairStyle: 'bun', hair: '#2b1b12', skin: SK[5], hat: 'none' }),
    pitch: 1.32,
    start: { x: 18.5, z: 30.35 },
    face: N,
    zones: STAFFZ,
    uniform: 'chef',
    routine: [
      { k: 'do', at: 'st_prep', dur: [30, 40], act: 'cook' },
      { k: 'do', at: 'st_pantry', dur: [8, 12], act: 'search' },
      { k: 'do', at: 'st_sink', dur: [30, 40], act: 'clean' },
      { k: 'do', at: 'st_plating', dur: [8, 12], act: 'cook' },
    ],
  },
  {
    id: 'waiter1',
    name: '웨이터 철수',
    role: 'staff',
    job: 'waiter',
    look: waiter({ skin: SK[0], hair: '#3b2a20' }),
    pitch: 1.0,
    start: { x: 20, z: 37.3 },
    zones: STAFFZ,
    uniform: 'waiter',
    routine: [
      { k: 'serve', rooms: ['ballroom', 'dining', 'foyer'], count: 3 },
      { k: 'do', at: 'st_pass', dur: [6, 10] },
      { k: 'serve', rooms: ['ballroom', 'lounge'], count: 3 },
      { k: 'do', at: 'st_staff_sofa', dur: [20, 30], pose: 'sit' },
    ],
  },
  {
    id: 'waiter2',
    name: '웨이터 영희',
    role: 'staff',
    job: 'waiter',
    look: waiter({ skin: SK[1], hair: '#1e140e', hairStyle: 'ponytail' }),
    pitch: 1.25,
    start: { x: 34, z: 32 },
    zones: STAFFZ,
    uniform: 'waiter',
    routine: [
      { k: 'serve', rooms: ['ballroom', 'lounge', 'conserv'], count: 3 },
      { k: 'do', at: 'st_pass', dur: [6, 10] },
      { k: 'serve', rooms: ['ballroom', 'foyer', 'dining'], count: 2 },
    ],
  },
  {
    id: 'waiter3',
    name: '웨이터 동구',
    role: 'staff',
    job: 'waiter',
    look: waiter({ skin: SK[3], hair: '#141414', girth: 1.1 }),
    pitch: 0.95,
    start: { x: 52, z: 12 },
    zones: STAFFZ,
    uniform: 'waiter',
    routine: [
      { k: 'serve', rooms: ['backgarden', 'conserv'], count: 3 },
      { k: 'do', at: 'st_pass', dur: [6, 10] },
      { k: 'serve', rooms: ['frontyard', 'foyer'], count: 2 },
    ],
  },
  {
    id: 'bartender',
    name: '바텐더 잭',
    role: 'staff',
    job: 'bartender',
    look: { skin: SK[2], hair: '#2a1a10', hairStyle: 'slick', top: '#7a4a35', bottom: '#2b2b30', accent: '#e0b04a', outfit: 'bartender' },
    pitch: 0.9,
    start: { x: 51, z: 34.45 },
    face: N,
    zones: STAFFZ,
    routine: [
      { k: 'do', at: 'st_bar', dur: [60, 90], act: 'clean', say: ['칵테일 한 잔 어떠세요?', '오늘은 마티니가 좋습니다.'] },
      { k: 'wait', dur: [10, 20], act: 'drink' },
    ],
  },
  {
    id: 'maid',
    name: '메이드 안나',
    role: 'staff',
    job: 'maid',
    look: { skin: SK[0], hair: '#7a4b2a', hairStyle: 'bun', top: '#2f2f45', bottom: '#2f2f45', accent: '#ffffff', outfit: 'maid', hat: 'maid_band' },
    pitch: 1.3,
    start: { x: 50, z: 40 },
    zones: ALLZ,
    keys: ['key_study'],
    routine: [
      { k: 'do', at: 'st_maid_wc', dur: [10, 14], act: 'clean' },
      { k: 'do', at: 'st_maid_bath', dur: [10, 14], act: 'clean' },
      { k: 'do', at: 'st_maid_foyer', dur: [10, 14], act: 'clean' },
      { k: 'do', at: 'st_maid_lib', dur: [10, 14], act: 'clean' },
      { k: 'do', at: 'st_maid_study', dur: [16, 22], act: 'clean' },
      { k: 'do', at: 'st_maid_gal', dur: [8, 12], act: 'clean' },
      { k: 'do', at: 'st_maid_cons', dur: [10, 14], act: 'clean' },
      { k: 'trash' },
      { k: 'do', at: 'st_staff_sofa3', dur: [20, 30], pose: 'sit' },
    ],
  },
  {
    id: 'electrician',
    name: '전기기사 볼트',
    role: 'staff',
    job: 'electrician',
    look: elec({ facial: 'beard', hair: '#8a5a2b', skin: SK[1] }),
    pitch: 0.88,
    start: { x: 6.6, z: 49.2 },
    face: W,
    zones: ['street', 'staff', 'sec_elec', 'public'],
    keys: ['key_elec'],
    radio: true,
    flashlight: true,
    enforces: ['electrician'],
    uniform: 'electrician',
    routine: [
      { k: 'do', at: 'st_evan', dur: [60, 80], act: 'eat' },
      { k: 'check_elec' },
      { k: 'do', at: 'st_eyard', dur: [20, 30], act: 'stretch' },
    ],
  },
  {
    id: 'gardener',
    name: '정원사 정씨 할아버지',
    role: 'staff',
    job: 'gardener',
    look: { skin: SK[2], hair: '#e8e8e8', hairStyle: 'short', top: '#7da36b', bottom: '#5b4a3a', accent: '#c9a36b', outfit: 'gardener', hat: 'straw', facial: 'beard', height: 0.94 },
    pitch: 0.8,
    start: { x: 21.4, z: 4.5 },
    face: E,
    zones: ['street', 'public', 'staff', 'sec_shed'],
    keys: ['key_shed'],
    routine: [
      { k: 'do', at: 'st_hedge1', dur: [40, 55], act: 'work' },
      { k: 'do', at: 'st_shed_in', dur: [12, 16], act: 'search' },
      { k: 'do', at: 'st_hedge2', dur: [40, 55], act: 'work' },
      { k: 'do', at: 'st_hedge3', dur: [30, 45], act: 'work' },
    ],
  },
  {
    id: 'pianist',
    name: '피아니스트 쇼팽',
    role: 'staff',
    job: 'pianist',
    look: { skin: SK[5], hair: '#3b2416', hairStyle: 'long', top: '#1f1f2e', bottom: '#1f1f2e', accent: '#ffffff', outfit: 'musician', glasses: true },
    pitch: 1.1,
    start: { x: 30.05, z: 32.5 },
    face: W,
    zones: STAFFZ,
    routine: [
      { k: 'do', at: 'st_piano', dur: [160, 210], pose: 'sit', act: 'piano' },
      { k: 'do', at: 'st_bar_front1', dur: [20, 28], act: 'drink', use: 'bar' },
    ],
  },
  // ---- Host
  {
    id: 'host',
    name: '오덕수 회장',
    role: 'host',
    job: 'host',
    look: { skin: SK[0], hair: '#dcdcdc', hairStyle: 'short', top: '#7a2e3a', bottom: '#2a2a32', accent: '#e8b923', outfit: 'host', hat: 'top_hat', facial: 'mustache', monocle: true, girth: 1.3, height: 1.02 },
    pitch: 0.72,
    start: { x: 36, z: 30.5 },
    face: S,
    zones: ALLZ,
    keys: ['key_gallery', 'key_study'],
    routine: [
      { k: 'chat', spots: ['sp_ball1', 'sp_ball2', 'sp_ball4'], dur: [35, 50] },
      { k: 'chat', spots: ['sp_lounge1', 'sp_cons1'], dur: [30, 45] },
      { k: 'do', at: 'st_bar_front2', dur: [10, 15], act: 'drink', use: 'bar' },
      { k: 'chat', spots: ['sp_terrace1', 'sp_foyer', 'sp_ball5'], dur: [30, 45] },
    ],
  },

  // ---- Guests
  {
    id: 'late_guest',
    name: '지각한 손님 나늦음',
    role: 'guest',
    job: 'late_guest',
    look: { skin: SK[1], hair: '#4a2f1e', hairStyle: 'curly', top: '#5a7d9a', bottom: '#3a4f63', accent: '#f2c94c', outfit: 'suit' },
    pitch: 1.05,
    start: { x: 54.6, z: 61.3 },
    face: W,
    zones: ['street'],
    items: ['invitation'],
    routine: [
      { k: 'do', at: 'st_late', dur: [70, 80], act: 'smoke', say: ['아직 시간 괜찮겠지...', '휴, 긴장되네.'] },
      { k: 'gate' },
    ],
  },
  g('g_rose', '마담 로즈', { skin: SK[0], hair: '#c0703a', hairStyle: 'bun', top: '#e88aa0', bottom: '#e88aa0', outfit: 'dress', accent: '#ffffff' }, 1.35, { x: 34.8, z: 30.2 }, ['sp_ball1']),
  g('g_countess', '백작부인 마르그리트', { skin: SK[5], hair: '#2a2a2a', hairStyle: 'bob', top: '#9b7fc9', bottom: '#9b7fc9', outfit: 'dress', hat: 'fascinator', accent: '#f2c94c' }, 1.28, { x: 33.2, z: 30.2 }, ['sp_ball1']),
  g('g_kim', '김사장', { skin: SK[1], hair: '#222', hairStyle: 'bald', top: '#4a6b4a', bottom: '#2e3b2e', outfit: 'suit', accent: '#c0392b', girth: 1.25, facial: 'mustache' }, 0.8, { x: 52, z: 30.4 }, ['sp_lounge1']),
  g('g_lee', '이교수', { skin: SK[0], hair: '#9a9a9a', hairStyle: 'short', top: '#8b6f47', bottom: '#4a3b26', outfit: 'suit', glasses: true, facial: 'beard', accent: '#2f5d62' }, 0.9, { x: 51.2, z: 29.5 }),
  g('g_park', '배우 박하늘', { skin: SK[5], hair: '#f2d16b', hairStyle: 'long', top: '#f2c94c', bottom: '#f2c94c', outfit: 'dress', accent: '#ffffff' }, 1.4, { x: 53.5, z: 11.3 }, ['sp_terrace1']),
  g('g_choi', '기자 최특종', { skin: SK[2], hair: '#3a2a1a', hairStyle: 'short', top: '#c0504d', bottom: '#3d3d3d', outfit: 'suit', glasses: true, accent: '#f2f2f2' }, 1.0, { x: 54.3, z: 10.5 }, ['sp_terrace1']),
  g('g_granny', '수다쟁이 할머니', { skin: SK[0], hair: '#e8e8f0', hairStyle: 'curly', top: '#7fb3a8', bottom: '#7fb3a8', outfit: 'dress', accent: '#f4a6c0', glasses: true, height: 0.9 }, 1.45, { x: 57.8, z: 33.6 }, ['sp_lounge1']),
  g('g_moon', '미스터 문', { skin: SK[3], hair: '#111', hairStyle: 'slick', top: '#30475e', bottom: '#222b36', outfit: 'tux', accent: '#e8b923' }, 0.85, { x: 30.5, z: 51 }),
  g('g_twin', '쌍둥이 언니 해나', { skin: SK[1], hair: '#5b3a24', hairStyle: 'ponytail', top: '#f4a261', bottom: '#f4a261', outfit: 'dress', accent: '#ffffff' }, 1.38, { x: 41.2, z: 49.6 }),
  g('g_young', '청년 사업가 왕대박', { skin: SK[4], hair: '#1b1b1b', hairStyle: 'spiky', top: '#e9c46a', bottom: '#3b3b3b', outfit: 'suit', accent: '#264653' }, 1.12, { x: 16, z: 8.8 }),
];

function g(id: string, name: string, look: Appearance, pitch: number, start: V2, haunt?: string[]): NpcDef {
  // Guests with a favourite spot keep coming back to it (so their gossip can be overheard).
  const routine: Task[] = haunt
    ? [{ k: 'chat', spots: haunt, dur: [40, 60] }, { k: 'guest' }, { k: 'chat', spots: haunt, dur: [35, 55] }, { k: 'guest' }, { k: 'guest' }]
    : guestTask;
  return { id, name, role: 'guest', job: 'guest', look, pitch, start, zones: PUBLIC, routine };
}

// ---------------------------------------------------------------------------
// Intel & opportunities
// ---------------------------------------------------------------------------
export interface IntelDef {
  id: string;
  title: string;
  hint: string;
  convo?: { who: string[]; near: number; lines: [number, string][] };
}

export const INTEL: IntelDef[] = [
  {
    id: 'intel_coffee',
    title: '커피 중독 보안 근무자',
    hint: '보안실 근무자는 직원 휴게실 커피머신의 커피를 자주 마신다. 수면제를 타면 근무 중에 곯아떨어질 것이다 — 카메라를 지켜볼 사람이 없어진다.',
    convo: {
      who: ['svc_guard', 'chef'],
      near: 2.6,
      lines: [
        [0, '보안실 이순찰 그 친구, 오늘만 커피 다섯 잔째래.'],
        [1, '휴게실 커피머신 말이지? 그거 없으면 근무 못 선다더라.'],
        [0, '그러다 모니터 앞에서 졸면 실장님한테 혼쭐나지.'],
        [1, '하하, 커피 마시고 조는 사람은 처음 보겠네!'],
      ],
    },
  },
  {
    id: 'intel_pills',
    title: '욕실 약장의 수면제',
    hint: '욕실 약장에 아주 독한 수면제가 있다. 음료에 타면 마신 사람이 잠든다.',
    convo: {
      who: ['g_granny', 'g_kim'],
      near: 2.6,
      lines: [
        [0, '사모님이 요즘 통 못 주무신대요. 욕실 약장에 수면제가 한가득이래요.'],
        [1, '그 약 엄청 독하다던데. 한 알이면 코끼리도 잔다고.'],
        [0, '어머, 누가 장난으로 음료에 타기라도 하면 큰일이겠네!'],
      ],
    },
  },
  {
    id: 'intel_alarm',
    title: '진열장 경보와 차단기',
    hint: '진열장 경보와 감시카메라는 "보안 시스템" 차단기에 물려 있다. 전기실에서 끊으면 꺼진다. 하지만 보안 전원이 나가면 보안실장이 전시실 정문 앞을 직접 지킨다 — 다른 입구가 필요하다.',
    convo: {
      who: ['chief', 'gallery_guard'],
      near: 3.2,
      lines: [
        [0, '진열장 경보는 이상 없지?'],
        [1, '네, 실장님. 근데 그거 보안 회로라서 차단기 내려가면 꺼지잖습니까.'],
        [0, '그래서 보안 전원이 나가면 내가 직접 전시실 문 앞을 지킨다. 명심해.'],
        [1, '넵! 저는 문 앞을 사수하겠습니다.'],
      ],
    },
  },
  {
    id: 'intel_study',
    title: '서재의 비밀문',
    hint: '회장 서재에서 전시실로 바로 통하는 비밀문이 있다. 서재 열쇠(집사·메이드·회장 소지)로 열리고, 시간이 걸리지만 자물쇠를 딸 수도 있다. 정문 경비의 눈을 피해 전시실에 들어가는 길이다.',
    convo: {
      who: ['maid', 'butler'],
      near: 3.6,
      lines: [
        [0, '집사님, 이따 회장님 서재 청소하러 갈게요.'],
        [1, '서재 안쪽 비밀문 말일세, 그 문으로 전시실에 바로 들어갈 수 있으니 문단속 잘하게.'],
        [0, '네네, 그 문도 서재 열쇠로 열리죠. 꼭 잠글게요.'],
      ],
    },
  },
  {
    id: 'intel_tour',
    title: '회장님의 오리 자랑 투어',
    hint: '회장이 연설 후 손님들을 데리고 전시실 투어를 한다. 투어 중엔 전시실 문이 열리고 경비가 비켜선다. 가짜 오리로 바꿔 놨다면 회장이 가까이서 보고 알아챌 것이다.',
  },
  {
    id: 'intel_fireworks',
    title: '불꽃놀이 발사대',
    hint: '뒤뜰의 불꽃놀이 발사대에 라이터로 불을 붙이면 손님과 직원들이 구경하러 몰려나온다. 주방장이 라이터를 갖고 다니고, 서재 벽난로에도 하나 있다.',
    convo: {
      who: ['gardener'],
      near: 0,
      lines: [
        [0, '에구구... 회장님이 이따 불꽃놀이를 하신다는데.'],
        [0, '발사대엔 불만 붙이면 된다지. 라이터는 주방장이 갖고 있고...'],
        [0, '불꽃이 터지면 다들 정원으로 우르르 몰려나오겠지, 허허.'],
      ],
    },
  },
  {
    id: 'intel_rubberduck',
    title: '고무 오리와 금색 페인트',
    hint: '욕실 욕조의 고무 오리에 정원 창고의 금색 페인트를 칠하면 가짜 황금 오리가 된다. 진열장의 무게 센서를 속이고, 도난 사실이 들통나는 것도 늦출 수 있다.',
    convo: {
      who: ['g_park', 'g_choi'],
      near: 2.6,
      lines: [
        [0, '욕실에 고무 오리 봤어요? 황금 오리랑 크기가 똑같던데요!'],
        [1, '하하, 금색 페인트만 칠하면 아무도 모르겠네요.'],
        [0, '정원사 할아버지가 오리 동상 칠하던 페인트가 창고에 있다던데?'],
      ],
    },
  },
  {
    id: 'intel_weight',
    title: '무게 센서의 허점',
    hint: '진열장 센서는 무게만 감지한다. 비슷한 무게의 가짜와 바꿔치기하면 경보가 울리지 않는다.',
  },
  {
    id: 'intel_van',
    title: '배달 밴 열쇠',
    hint: '주방 쪽문 옆 고리에 배달 밴 열쇠가 걸려 있다. 밴을 몰고 쪽문을 들이받아 탈출할 수 있다.',
    convo: {
      who: ['cook', 'chef'],
      near: 4.6,
      lines: [
        [0, '셰프님, 배달 밴 열쇠는 주방 쪽문 옆 고리에 걸어 뒀어요.'],
        [1, '그래, 이따 남은 재료 싣고 가야 하니까.'],
        [0, '밴은 서비스 마당에 세워 뒀고요!'],
      ],
    },
  },
  {
    id: 'intel_bathwindow',
    title: '고장 난 욕실 창문',
    hint: '동쪽 정원 쪽 욕실 창문은 고장 나서 늘 열려 있다. 넘어서 저택 안으로 들어갈 수 있다.',
    convo: {
      who: ['patrol_front'],
      near: 0,
      lines: [
        [0, '욕실 창문이 또 열려 있네... 고장 나서 안 닫힌다니까.'],
        [0, '누가 저리로 넘어 들어오면 어쩌려고. 수리 요청서나 써야지.'],
      ],
    },
  },
  {
    id: 'intel_fusebox',
    title: '두꺼비집',
    hint: '전기실 두꺼비집에서 본관(파티장)·서비스동·보안 시스템 전기를 따로 끊을 수 있다. 전기기사가 전기실 열쇠를 갖고 있고, 문은 자물쇠를 딸 수도 있다. 전기기사 작업복을 입으면 차단기를 만져도 수상하지 않다.',
    convo: {
      who: ['electrician'],
      near: 0,
      lines: [
        [0, '여보세요? 응, 나 아직 일하는 중이야.'],
        [0, '두꺼비집? 전기실에 있지. 본관, 서비스동, 보안 시스템이 다 따로라니까.'],
        [0, '전기실 열쇠는 내 주머니에 있고. 응, 끝나면 갈게.'],
      ],
    },
  },
  {
    id: 'intel_laxative',
    title: '전시실 경비의 물 사랑',
    hint: '전시실 경비는 복도 정수기 물을 자주 마신다. 정수기에 설사약을 타면 화장실로 달려가 자리를 비울 것이다. 설사약은 직원 휴게실 구급상자에 있다.',
    convo: {
      who: ['waiter1', 'maid'],
      near: 2.4,
      lines: [
        [0, '전시실 경비 아저씨는 정수기 물을 달고 살더라.'],
        [1, '맞아요, 그리고 꼭 화장실 가느라 자리를 비우죠.'],
        [0, '휴게실 구급상자에 설사약 있던데, 누가 장난치면 큰일 나겠다.'],
      ],
    },
  },
  {
    id: 'intel_keys',
    title: '열쇠 꾸러미',
    hint: '보안실장과 회장이 전시실 열쇠를 갖고 다닌다. 등 뒤로 다가가 소매치기할 수 있다. 집사와 메이드는 서재 열쇠를 갖고 있다.',
    convo: {
      who: ['g_rose', 'g_countess'],
      near: 2.6,
      lines: [
        [0, '보안실장 허리춤에 달린 열쇠 꾸러미 보셨어요? 전시실 열쇠도 저기 있겠죠.'],
        [1, '회장님도 하나 갖고 계시대요. 오리를 얼마나 아끼시는지.'],
        [0, '집사님은 서재 열쇠를 갖고 다니시고요. 다들 열쇠 부자네요, 호호.'],
      ],
    },
  },
  {
    id: 'intel_hedge',
    title: '울타리 개구멍',
    hint: '앞마당 남동쪽 울타리에 개구멍이 있다. 웅크린 채(C) 지나가면 들키지 않고 드나들 수 있다.',
  },
  {
    id: 'intel_invite',
    title: '지각생의 초대장',
    hint: '거리에서 담배를 피우는 지각한 손님이 초대장을 갖고 있다. 등 뒤에서 소매치기하면 정문으로 당당히 들어갈 수 있다. 길가의 잠기지 않은 차에도 뭔가 있을지도?',
  },
];

// ---------------------------------------------------------------------------
// To-do list (Untitled-Goose-Game style)
// ---------------------------------------------------------------------------
export interface TodoDef {
  id: string;
  text: string;
  main?: boolean;
}
export const TODOS: TodoDef[] = [
  { id: 'enter', text: '저택 안으로 숨어들기', main: true },
  { id: 'find', text: '황금 오리 찾아내기', main: true },
  { id: 'steal', text: '황금 오리 손에 넣기', main: true },
  { id: 'escape', text: '황금 오리를 들고 빠져나가기', main: true },
  { id: 'legit', text: '정식 초대 손님 행세하기' },
  { id: 'disguise3', text: '세 가지 변장 해보기' },
  { id: 'pickpocket', text: '소매치기 성공하기' },
  { id: 'blackout', text: '저택에 정전 일으키기' },
  { id: 'sleepy', text: '누군가를 꿈나라로 보내기' },
  { id: 'sick', text: '누군가를 화장실로 달려가게 하기' },
  { id: 'jukebox', text: '주크박스로 파티 흥 돋우기' },
  { id: 'fireworks', text: '불꽃놀이 몰래 터뜨리기' },
  { id: 'fire_alarm', text: '화재 경보로 모두 대피시키기' },
  { id: 'fakeduck', text: '가짜 황금 오리 만들기' },
  { id: 'swap', text: '황금 오리 바꿔치기' },
  { id: 'disable_alarm', text: '진열장 경보 끄기' },
  { id: 'erase_tapes', text: '녹화 기록 지우기' },
  { id: 'ghost', text: '아무에게도 들키지 않고 탈출하기' },
];

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------
export const LINES = {
  guestChat: [
    '이 샴페인 정말 훌륭하네요.',
    '회장님의 오리 사랑은 유명하죠.',
    '저 피아니스트 누구예요? 너무 멋져요.',
    '제 드레스 어때요? 파리에서 맞췄어요.',
    '주식 얘기는 이제 그만해요.',
    '케이크는 언제 나오나요?',
    '황금 오리가 진짜 순금이래요!',
    '어머, 그 넥타이 너무 귀엽다.',
    '여기 정원 정말 근사하네요.',
    '요즘 오리 가격이 많이 올랐다던데요.',
    '회장님 연설은 언제 하신대요?',
    '아까 웨이터가 제 구두를 밟았어요.',
    '오늘 날씨가 파티하기 딱이네요.',
    '저 사람 누구죠? 처음 보는 얼굴인데.',
    '꽥! ...아, 죄송해요. 오리 흉내였어요.',
    '이 카나페 맛 좀 보세요!',
    '다음 달 요트 파티에 오실 거죠?',
    '하하하! 정말 재밌는 분이시네요.',
    '보안이 엄청 삼엄하던데요?',
    '회장님 모자가 오늘따라 높아 보이네요.',
  ],
  hostChat: [
    '하하! 다들 즐기고 계십니까?',
    '제 황금 오리 이야기를 해 드렸던가요?',
    '오리는 꽥꽥 울지만 황금 오리는 반짝반짝 빛나죠!',
    '오늘 와 주셔서 정말 영광입니다.',
    '이 파티의 하이라이트는 아직이랍니다!',
  ],
  staffChat: ['3번 테이블 와인 추가요!', '접시 조심해!', '오늘 손님 엄청 많네.', '발이 퉁퉁 부었어요.', '셰프님 또 화나셨대.', '이따 남은 케이크 먹자.'],
  guardChat: ['이상 없음.', '오늘따라 다리가 아프네.', '교대 언제지?', '집중, 집중.', '수상한 사람은 없나...'],
  serve: ['샴페인 한 잔 하시겠어요?', '카나페 드셔 보세요.', '음료 더 필요하신가요?'],
  thanks: ['고마워요!', '어머, 감사해요.', '딱 마시고 싶었는데!'],
  nothing: ['아무것도 없잖아.', '기분 탓인가...', '고양이였나?', '내가 잘못 들었나 보군.', '흠, 이상하네.'],
  giveUp: ['놓쳤군... 하지만 아직 이 안에 있을 거야.', '분명 이 근처였는데. 계속 경계하자.', '제길, 어디로 숨었지?'],
  chaseStart: ['거기 서!', '도둑이야! 잡아라!', '꼼짝 마!', '너 이리 와!'],
  chase: ['거기 서라니까!', '도망쳐 봤자야!', '잡히기만 해 봐!', '저기다! 저쪽으로 간다!'],
  lockdownGuest: ['무슨 일이래요?', '도둑이 들었대요!', '언제 집에 갈 수 있는 거죠?', '세상에, 황금 오리가...!', '무서워요...'],
  lateArgue: [
    [0, '저 초대받은 사람이에요! 초대장을 잃어버렸을 뿐이라고요!'],
    [1, '죄송하지만 초대장 없이는 들여보내 드릴 수 없습니다.'],
    [0, '제 이름 명단에 있을 거예요! 나늦음! 나, 늦, 음!'],
    [1, '음... 명단을 확인해 보겠습니다. 잠시만요.'],
    [0, '아까 그 사람이 제 옆을 스쳐 가던데... 설마?'],
    [1, '...네, 있으시군요. 들어가세요. 다음엔 초대장을 꼭 챙기세요.'],
  ] as [number, string][],
  speech: [
    '여러분! 오늘 이렇게 와 주셔서 감사합니다!',
    '아시다시피 저는 오리를 무척 사랑합니다. 꽥!',
    '그리고 제 컬렉션의 자랑, 순금 황금 오리!',
    '보안도 철저합니다. 경보, 카메라, 그리고 우리 강철수 실장까지!',
    '잠시 후 제가 직접 전시실에서 오리를 보여드리겠습니다!',
    '자, 건배! 오리를 위하여!',
  ],
  tour: ['이것이 바로 제 보물, 황금 오리입니다!', '순금으로 만든 세상에 단 하나뿐인 오리죠.', '보세요, 이 우아한 부리 곡선을!'],
};

// ---------------------------------------------------------------------------
// Behaviour text helpers
// ---------------------------------------------------------------------------
export class Content {
  lines = LINES;

  pickGuestTask(w: World, n: Npc): Task {
    const r = w.rng.next() * 100;
    const t = (a: number) => r < a;
    if (t(24)) return { k: 'chat', spots: ['sp_ball1', 'sp_ball2', 'sp_ball3', 'sp_ball4', 'sp_ball5'], dur: [25, 45] };
    if (t(31)) {
      const at = w.rng.pick(['st_dance1', 'st_dance2', 'st_dance3', 'st_dance4']);
      return { k: 'do', at, dur: [15, 28], act: 'dance' };
    }
    if (t(41)) return { k: 'chat', spots: ['sp_lounge1', 'sp_lounge2'], dur: [25, 40] };
    if (t(46)) return { k: 'do', at: w.rng.pick(['st_bar_front1', 'st_bar_front2']), dur: [10, 16], act: 'drink', use: 'bar' };
    if (t(52)) return { k: 'do', at: 'st_punch', dur: [6, 9], act: 'drink', use: 'punch' };
    if (t(58)) return { k: 'do', at: w.rng.pick(['st_buffet1', 'st_buffet2']), dur: [10, 16], act: 'eat' };
    if (t(62)) return { k: 'chat', spots: ['sp_foyer'], dur: [20, 30] };
    if (t(68)) return { k: 'chat', spots: ['sp_cons1', 'sp_cons2'], dur: [25, 40] };
    if (t(80)) return { k: 'chat', spots: ['sp_terrace1', 'sp_terrace2', 'sp_gazebo', 'sp_fount'], dur: [25, 45] };
    if (t(87)) return { k: 'chat', spots: ['sp_front1', 'sp_front2', 'sp_front3'], dur: [25, 40] };
    if (t(93)) return { k: 'do', at: w.rng.pick(['st_art1', 'st_art2', 'st_art3', 'st_read1', 'st_read2']), dur: [10, 18], act: w.rng.chance(0.5) ? 'think' : 'read' };
    if (t(97)) return { k: 'toilet' };
    return { k: 'wander', room: w.rng.pick(['ballroom', 'lounge', 'backgarden', 'frontyard']), dur: [12, 20] };
  }

  noticeLines(n: Npc, reason: SusReason): string[] {
    if (reason === 'uninvited') return ['저 손님... 명단에 있었나?', '처음 뵙는 분인데?'];
    if (reason === 'disguise') return ['저 사람... 처음 보는데?', '새로 온 사람인가?'];
    if (reason === 'trespass') return n.isGuard ? ['저기 누구야?', '거긴 출입 금지인데...'] : ['어라, 저기 들어가도 되나?', '응?'];
    if (reason === 'crime' || reason === 'duck') return ['응? 지금 뭐 하는 거지?', '저, 저건...?'];
    if (reason === 'recognized') return ['저 사람... 아까 그?', '어디서 봤는데?'];
    return ['응?', '저 사람 뭐지?', '어라...?', '흠...?'];
  }

  mildLine(n: Npc, reason: SusReason): string {
    if (reason === 'behavior') return n.role === 'guest' ? '저 사람 왜 저래?' : '파티장에서 뛰면 안 되는데...';
    if (reason === 'item') return '저런 걸 왜 들고 다니지?';
    if (reason === 'trespass') return '저기 들어가도 되는 건가?';
    return '이상한 사람이네.';
  }

  investigateLine(n: Npc, why: string): string | null {
    switch (why) {
      case 'whistle':
        return n.role === 'guest' ? '누가 휘파람을 불었지?' : '누구야? 거기 누구 있어?';
      case 'noise':
        return '방금 무슨 소리지?';
      case 'sight':
        return '방금 뭔가 봤는데...';
      case 'light':
        return '어라, 왜 이렇게 어둡지?';
      case 'music':
        return '누가 음악을 이렇게 크게 틀었어?';
      case 'mess':
        return '어머, 뭐가 깨졌네.';
      case 'door':
        return '문이 왜 열려 있지?';
      case 'window':
        return '창문이 열려 있네.';
      case 'sleeper':
        return '저기 누가 쓰러져 있어!';
      case 'napper':
        return '저 녀석, 또 조는 거야?';
      case 'scream':
        return '비명 소리다! 무슨 일이야?';
      case 'shout':
        return '추격 중인가? 지원 간다!';
      case 'report':
        return null;
      case 'camera':
        return '카메라에 잡혔다고? 확인하러 간다.';
      case 'fireworks':
        return '누가 불꽃놀이에 불을 붙였지?!';
      case 'engine':
        return '무슨 엔진 소리지?';
    }
    return null;
  }

  confrontLine(reason: SusReason, outfit: OutfitId): string {
    switch (reason) {
      case 'trespass':
        if (outfit === 'guest') return '손님, 여긴 들어오시면 안 됩니다. 나가 주세요.';
        if (outfit === 'chef') return '요리사가 왜 여기 있지? 주방으로 돌아가.';
        if (outfit === 'electrician') return '수리 기사님, 여긴 볼일 없으실 텐데요. 나가 주시죠.';
        if (outfit === 'waiter') return '웨이터는 여기 들어오면 안 돼. 당장 나가.';
        return '거기! 여긴 출입 금지 구역이다. 당장 나가.';
      case 'uninvited':
        return '잠시만요, 초대장을 확인하겠습니다.';
      case 'behavior':
        return '이봐요, 거기서 뭘 하는 겁니까?';
      case 'item':
        return '그건 왜 들고 다니시죠? 내려놓으세요.';
      case 'lockdown':
        return '지금 봉쇄 중입니다! 연회장으로 가 계세요.';
      case 'disguise':
        return outfit === 'chef' || outfit === 'waiter' ? '넌 누구야? 우리 주방 사람이 아니잖아!' : '자네, 처음 보는 얼굴인데? 어느 소속이지?';
      default:
        return '잠깐 거기 서 보세요.';
    }
  }

  reportText(reason: SusReason, outfit: OutfitId | null, crime?: string): string {
    const who = outfit ? `${OUTFITS[outfit].name} 차림의 사람이` : '누군가';
    switch (reason) {
      case 'duck':
        return `경비원님! ${who} 황금 오리를 들고 있었어요!`;
      case 'crime':
        return `경비원님! ${who} ${crime ?? '수상한 짓을 했어요'}!`;
      case 'recognized':
        return `아까 그 수상한 사람이 또 나타났어요! ${who} 돌아다녀요!`;
      case 'trespass':
        return `${who} 출입 금지 구역을 돌아다녀요.`;
      case 'uninvited':
        return `${who} 초대 명단에 없는 사람이에요!`;
      case 'disguise':
        return `${who} 우리 직원이 아니에요! 가짜예요!`;
      default:
        return `${who} 좀 이상해요.`;
    }
  }

  screamLine(info: Report): string {
    switch (info.kind) {
      case 'theft':
        return '꺄악! 도둑이야! 황금 오리를!';
      case 'intruder':
        return '꺄악! 경비원! 경비원!';
      case 'sleeper':
      case 'uniform':
        return '꺄악! 사람이 쓰러졌어요!';
      default:
        return '저기요! 경비원님!';
    }
  }

  drinkHint(key: 'coffee' | 'cooler' | 'punch'): string {
    if (key === 'coffee') return '진하게 우린 커피. 보안실 근무자가 자주 마시러 온다.';
    if (key === 'cooler') return '시원한 정수기. 전시실 경비가 자주 물을 마신다.';
    return '달콤한 파티 펀치. 손님들이 오며 가며 한 잔씩 마신다.';
  }

  caseHint(w: World): string {
    const armed = w.security.alarmArmed && w.power.on('C');
    return armed
      ? '유리 진열장 안의 황금 오리. 무게 센서 경보가 켜져 있다 — 그냥 들면 경보가 울린다.'
      : '경보 표시등이 꺼져 있다. 지금이라면 조용히 들어 올릴 수 있다!';
  }
}

export const NIGHT_START_TEXT = '20:00';
