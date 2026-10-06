// The Duckworth mansion ("오덕수 회장 저택"). One-metre grid.
// x grows east, z grows south (towards the camera). Cell (x,z) spans [x,x+1)x[z,z+1).

import type { BarrierDef, DoorDef, FurnDef, RoomDef, WindowDef } from './types';

export const MAP_W = 72;
export const MAP_H = 66;

const N = Math.PI;
const S = 0;
const E = Math.PI / 2;
const W = -Math.PI / 2;
export const FACE = { N, S, E, W };

// ---------------------------------------------------------------------------
// Rooms / regions. Later entries override earlier ones.
// ---------------------------------------------------------------------------
export const ROOMS: RoomDef[] = [
  { id: 'backgarden', name: '뒤뜰 정원', rect: [0, 0, 72, 14], indoor: false, zone: 'public', floor: 'grass' },
  { id: 'serviceyard', name: '서비스 마당', rect: [0, 14, 12, 59], indoor: false, zone: 'staff', floor: 'concrete' },
  { id: 'eastgarden', name: '동쪽 정원', rect: [60, 14, 72, 44], indoor: false, zone: 'public', floor: 'grass' },
  { id: 'frontyard', name: '앞마당', rect: [12, 44, 72, 59], indoor: false, zone: 'public', floor: 'grass' },
  { id: 'street', name: '거리', rect: [0, 59, 72, 66], indoor: false, zone: 'street', floor: 'asphalt' },
  { id: 'lake', name: '호수', rect: [44, 0, 72, 4], indoor: false, zone: 'public', floor: 'water' },
  { id: 'dock', name: '선착장', rect: [60, 0, 62, 4], indoor: false, zone: 'public', floor: 'deck' },

  { id: 'shed', name: '정원 창고', rect: [2, 3, 8, 8], indoor: true, zone: 'sec_shed', circuit: 'A', floor: 'wood', switchAt: [5.4, 7.5], dark: true },

  { id: 'elec', name: '전기실', rect: [12, 14, 17, 19], indoor: true, zone: 'sec_elec', circuit: 'A', floor: 'concrete', switchAt: [15.4, 18.5] },
  { id: 'security', name: '보안실', rect: [17, 14, 24, 19], indoor: true, zone: 'sec_security', circuit: 'A', floor: 'lino', switchAt: [21.4, 18.5] },
  { id: 'staffhall', name: '직원 복도', rect: [12, 19, 24, 22], indoor: true, zone: 'staff', circuit: 'A', floor: 'lino', switchAt: [22.5, 19.4] },
  { id: 'svc', name: '배선 통로', rect: [24, 14, 26, 35], indoor: true, zone: 'staff', circuit: 'A', floor: 'lino', switchAt: [25.5, 21.4] },
  { id: 'library', name: '도서실', rect: [26, 14, 31, 22], indoor: true, zone: 'public', circuit: 'B', floor: 'carpet_green', switchAt: [29.4, 21.5] },
  { id: 'gallery', name: '전시실', rect: [31, 14, 41, 22], indoor: true, zone: 'sec_gallery', circuit: 'B', floor: 'marble', switchAt: [34.4, 21.5] },
  { id: 'study', name: '회장 서재', rect: [41, 14, 48, 22], indoor: true, zone: 'sec_study', circuit: 'B', floor: 'carpet_red', switchAt: [45.4, 21.5] },
  { id: 'conserv', name: '온실', rect: [48, 14, 60, 25], indoor: true, zone: 'public', circuit: 'B', floor: 'terracotta', switchAt: [49.5, 23.5] },
  { id: 'galhall', name: '전시실 복도', rect: [26, 22, 48, 25], indoor: true, zone: 'public', circuit: 'B', floor: 'wood', switchAt: [27.5, 22.4] },
  { id: 'staffroom', name: '직원 휴게실', rect: [12, 22, 19, 29], indoor: true, zone: 'staff', circuit: 'A', floor: 'lino', switchAt: [16.4, 22.5] },
  { id: 'pantry', name: '식료품 창고', rect: [19, 22, 24, 29], indoor: true, zone: 'staff', circuit: 'A', floor: 'concrete', switchAt: [22.4, 28.5] },
  { id: 'kitchen', name: '주방', rect: [12, 29, 24, 44], indoor: true, zone: 'staff', circuit: 'A', floor: 'tile_blue', switchAt: [13.6, 29.4] },
  { id: 'ballroom', name: '연회장', rect: [26, 25, 48, 35], indoor: true, zone: 'public', circuit: 'B', floor: 'parquet', switchAt: [26.5, 33.5] },
  { id: 'lounge', name: '라운지 바', rect: [48, 25, 60, 35], indoor: true, zone: 'public', circuit: 'B', floor: 'carpet_purple', switchAt: [52.4, 25.5] },
  { id: 'dining', name: '식당', rect: [24, 35, 32, 44], indoor: true, zone: 'public', circuit: 'B', floor: 'wood', switchAt: [31.5, 38.4] },
  { id: 'foyer', name: '현관 홀', rect: [32, 35, 42, 44], indoor: true, zone: 'public', circuit: 'B', floor: 'checker', switchAt: [38.6, 43.5] },
  { id: 'easthall', name: '동쪽 복도', rect: [42, 35, 48, 44], indoor: true, zone: 'public', circuit: 'B', floor: 'wood', switchAt: [44.4, 35.5] },
  { id: 'wc', name: '화장실', rect: [48, 35, 52, 44], indoor: true, zone: 'public', circuit: 'B', floor: 'tile_white', switchAt: [48.5, 42.6] },
  { id: 'bath', name: '욕실', rect: [52, 35, 60, 44], indoor: true, zone: 'public', circuit: 'B', floor: 'tile_mint', switchAt: [57.4, 35.5] },
];

/** Edges between two indoor rooms that are open archways (no wall). */
export const OPENINGS: { axis: 'h' | 'v'; at: number; from: number; to: number }[] = [
  { axis: 'h', at: 35, from: 35, to: 39 }, // foyer <-> ballroom
  { axis: 'v', at: 42, from: 38, to: 41 }, // foyer <-> east hall
  { axis: 'h', at: 25, from: 29, to: 31 }, // ballroom <-> gallery hall (west)
  { axis: 'h', at: 25, from: 43, to: 45 }, // ballroom <-> gallery hall (east)
  { axis: 'v', at: 48, from: 29, to: 32 }, // ballroom <-> lounge
];

export const DOORS: DoorDef[] = [
  { id: 'd_main', name: '현관 정문', axis: 'h', at: 44, from: 36, to: 38, open: true, style: 'double' },
  { id: 'd_foyer_dining', name: '식당 문', axis: 'v', at: 32, from: 39, to: 41, open: true, style: 'double' },
  { id: 'd_ballroom_easthall', name: '복도 문', axis: 'h', at: 35, from: 45, to: 46, style: 'wood' },
  { id: 'd_easthall_wc', name: '화장실 문', axis: 'v', at: 48, from: 41, to: 42, style: 'wood', keepClosed: true },
  { id: 'd_lounge_bath', name: '욕실 문', axis: 'h', at: 35, from: 56, to: 57, style: 'wood', keepClosed: true },
  { id: 'd_lounge_conserv', name: '온실 문', axis: 'h', at: 25, from: 53, to: 55, open: true, style: 'glass' },
  { id: 'd_conserv_garden', name: '정원 문', axis: 'h', at: 14, from: 53, to: 55, open: true, style: 'glass' },
  { id: 'd_conserv_galhall', name: '온실 옆문', axis: 'v', at: 48, from: 23, to: 24, open: true, style: 'wood' },
  { id: 'd_gallery', name: '전시실 정문', axis: 'h', at: 22, from: 35, to: 37, lock: 'key_gallery', keepClosed: true, style: 'double' },
  { id: 'd_study', name: '서재 문', axis: 'h', at: 22, from: 44, to: 45, lock: 'key_study', pickable: true, keepClosed: true, style: 'wood' },
  { id: 'd_study_gallery', name: '서재-전시실 비밀문', axis: 'v', at: 41, from: 17, to: 18, lock: 'key_study', pickable: true, keepClosed: true, style: 'wood' },
  { id: 'd_galhall_library', name: '도서실 문', axis: 'h', at: 22, from: 28, to: 29, open: true, style: 'wood' },
  { id: 'd_galhall_svc', name: '직원용 문', axis: 'v', at: 26, from: 23, to: 24, keepClosed: true, style: 'staff' },
  { id: 'd_svc_ballroom', name: '직원용 문', axis: 'v', at: 26, from: 30, to: 31, keepClosed: true, style: 'staff' },
  { id: 'd_svc_dining', name: '직원용 문', axis: 'h', at: 35, from: 24, to: 25, keepClosed: true, style: 'staff' },
  { id: 'd_svc_kitchen', name: '주방 안쪽 문', axis: 'v', at: 24, from: 32, to: 33, keepClosed: true, style: 'staff' },
  { id: 'd_svc_staffhall', name: '직원 복도 문', axis: 'v', at: 24, from: 20, to: 21, open: true, style: 'staff' },
  { id: 'd_svc_garden', name: '직원용 뒷문', axis: 'h', at: 14, from: 24, to: 25, keepClosed: true, style: 'staff' },
  { id: 'd_elec', name: '전기실 문', axis: 'h', at: 19, from: 14, to: 15, lock: 'key_elec', pickable: true, keepClosed: true, style: 'metal' },
  { id: 'd_security', name: '보안실 문', axis: 'h', at: 19, from: 20, to: 21, keepClosed: true, style: 'metal' },
  { id: 'd_staffhall_staffroom', name: '휴게실 문', axis: 'h', at: 22, from: 15, to: 16, open: true, style: 'staff' },
  { id: 'd_staffhall_yard', name: '서쪽 뒷문', axis: 'v', at: 12, from: 20, to: 21, keepClosed: true, style: 'staff' },
  { id: 'd_staffroom_kitchen', name: '휴게실 문', axis: 'h', at: 29, from: 13, to: 14, open: true, style: 'staff' },
  { id: 'd_pantry', name: '창고 문', axis: 'h', at: 29, from: 21, to: 22, style: 'staff' },
  { id: 'd_kitchen_yard', name: '주방 쪽문', axis: 'v', at: 12, from: 38, to: 39, open: true, style: 'staff' },
  { id: 'd_kitchen_dining', name: '주방 문', axis: 'v', at: 24, from: 40, to: 41, open: true, style: 'staff' },
  { id: 'd_ballroom_dining', name: '식당 문', axis: 'h', at: 35, from: 28, to: 30, open: true, style: 'double' },
  { id: 'd_shed', name: '창고 문', axis: 'h', at: 8, from: 4, to: 5, lock: 'key_shed', pickable: true, keepClosed: true, style: 'wood' },
  { id: 'd_lounge_garden', name: '테라스 문', axis: 'v', at: 60, from: 30, to: 31, style: 'glass' },
  { id: 'd_front_gate', name: '정문', axis: 'h', at: 59, from: 34, to: 38, open: true, style: 'gate', gate: true },
  { id: 'd_service_gate', name: '쪽문', axis: 'h', at: 59, from: 3, to: 6, open: true, style: 'gate', gate: true },
  { id: 'd_yard_gate', name: '마당 쪽문', axis: 'v', at: 12, from: 51, to: 52, style: 'gate' },
];

export const WINDOWS: WindowDef[] = [
  { id: 'w_gal1', axis: 'h', at: 14, from: 33, to: 34 },
  { id: 'w_gal2', axis: 'h', at: 14, from: 38, to: 39 },
  { id: 'w_lib', axis: 'h', at: 14, from: 28, to: 29 },
  { id: 'w_study', axis: 'h', at: 14, from: 45, to: 46 },
  { id: 'w_cons_n1', axis: 'h', at: 14, from: 49, to: 52, fixed: true },
  { id: 'w_cons_n2', axis: 'h', at: 14, from: 56, to: 59, fixed: true },
  { id: 'w_cons_e1', axis: 'v', at: 60, from: 15, to: 18, fixed: true },
  { id: 'w_cons_e2', axis: 'v', at: 60, from: 20, to: 24, fixed: true },
  { id: 'w_lounge_e1', axis: 'v', at: 60, from: 27, to: 28 },
  { id: 'w_lounge_e2', axis: 'v', at: 60, from: 33, to: 34 },
  { id: 'w_bath', axis: 'v', at: 60, from: 39, to: 40, open: true, outsideOpen: true },
  { id: 'w_foyer1', axis: 'h', at: 44, from: 33, to: 34 },
  { id: 'w_foyer2', axis: 'h', at: 44, from: 40, to: 41 },
  { id: 'w_dining1', axis: 'h', at: 44, from: 26, to: 27 },
  { id: 'w_dining2', axis: 'h', at: 44, from: 29, to: 30 },
  { id: 'w_kitchen1', axis: 'v', at: 12, from: 31, to: 32 },
  { id: 'w_kitchen2', axis: 'v', at: 12, from: 42, to: 43 },
  { id: 'w_staffroom', axis: 'v', at: 12, from: 26, to: 27 },
  { id: 'w_easthall', axis: 'h', at: 44, from: 44, to: 46 },
  { id: 'w_wc', axis: 'h', at: 44, from: 49, to: 50, fixed: true },
  { id: 'w_bath2', axis: 'h', at: 44, from: 54, to: 56, fixed: true },
  { id: 'w_shed', axis: 'v', at: 8, from: 5, to: 6, fixed: true },
];

export const BARRIERS: BarrierDef[] = [
  // South perimeter hedge (street boundary) with front gate, service gate and a crawl gap.
  { axis: 'h', at: 59, from: 0, to: 3, kind: 'hedge' },
  { axis: 'h', at: 59, from: 6, to: 34, kind: 'hedge' },
  { axis: 'h', at: 59, from: 38, to: 68, kind: 'hedge' },
  { axis: 'h', at: 59, from: 68, to: 69, kind: 'crawl' },
  { axis: 'h', at: 59, from: 69, to: 72, kind: 'hedge' },
  // Service yard / front yard fence (with a small gate).
  { axis: 'v', at: 12, from: 44, to: 51, kind: 'fence' },
  { axis: 'v', at: 12, from: 52, to: 59, kind: 'fence' },
  // Service yard / back garden hedge.
  { axis: 'h', at: 14, from: 0, to: 8, kind: 'hedge' },
  // Front yard / east garden hedge with a path.
  { axis: 'h', at: 44, from: 60, to: 64, kind: 'hedge' },
  { axis: 'h', at: 44, from: 66, to: 72, kind: 'hedge' },
];

// ---------------------------------------------------------------------------
// Furniture & props. (x,z) is the footprint centre; w along x, d along z.
// ---------------------------------------------------------------------------
let fid = 0;
const F = (kind: FurnDef['kind'], x: number, z: number, w: number, d: number, o: Partial<FurnDef> = {}): FurnDef => ({
  id: o.id ?? `${kind}_${fid++}`,
  kind,
  x,
  z,
  w,
  d,
  ...o,
});

export const FURNITURE: FurnDef[] = [
  // ---- Electrical room
  F('fusebox', 14.5, 14.12, 1.4, 0.2, { id: 'fusebox', wall: true, block: false }),
  F('shelf', 12.4, 16.5, 0.7, 2.8, { tall: false }),
  F('workbench', 16.45, 16.5, 0.9, 2),
  F('crate', 12.5, 18.4, 0.8, 0.8),

  // ---- Security room
  F('desk_monitors', 20.5, 14.5, 5, 0.9, { id: 'monitors', rot: N, surfaceY: 0.78 }),
  F('chair', 20.5, 15.7, 0.6, 0.6, { block: false, rot: N }),
  F('locker', 17.45, 16.5, 0.7, 1, { id: 'guard_locker', rot: E }),
  F('cabinet', 23.9, 17, 0.12, 0.8, { id: 'key_cabinet', wall: true, block: false, h: 0.7 }),
  F('table_small', 23.2, 18.3, 0.7, 0.6, { surfaceY: 0.72 }),

  // ---- Staff hall
  F('bench', 18.5, 21.65, 1.6, 0.5, { rot: N }),
  F('coat_rack', 12.5, 21.5, 0.5, 0.5),

  // ---- Staff room
  F('counter', 12.45, 24, 0.9, 2, { surfaceY: 0.9, rot: E }),
  F('coffee_machine', 12.45, 23.5, 0.5, 0.5, { id: 'coffee_machine', block: false }),
  F('table_small', 15.5, 25.5, 1.6, 0.9, { surfaceY: 0.74 }),
  F('chair', 14.4, 25.5, 0.5, 0.5, { block: false, rot: E }),
  F('chair', 16.6, 25.5, 0.5, 0.5, { block: false, rot: W }),
  F('sofa', 15.5, 28.45, 2.6, 0.8, { rot: N, color: '#c98f6b' }),
  F('locker', 18.55, 24.5, 0.7, 4, { id: 'staff_lockers', rot: W }),
  F('cabinet', 12.12, 27.5, 0.12, 0.6, { id: 'firstaid', wall: true, block: false, h: 0.5, color: '#f4f4f4' }),
  F('notice_board', 16.9, 22.1, 1.2, 0.1, { id: 'notice_staff', wall: true, block: false }),

  // ---- Pantry
  F('shelf', 19.4, 25.5, 0.7, 5, { tall: true, rot: E }),
  F('shelf', 23.6, 25.5, 0.7, 5, { tall: true, rot: W }),
  F('crate', 20.5, 28.4, 0.9, 0.8),
  F('barrel', 22.5, 28.4, 0.8, 0.8),
  F('coat_rack', 22.5, 22.5, 0.5, 0.5, { id: 'chef_hook', block: false }),

  // ---- Kitchen
  F('counter', 18.5, 29.45, 4, 0.8, { surfaceY: 0.9 }),
  F('stove', 15.5, 32.5, 3, 1, { id: 'stove' }),
  F('counter', 20, 35.5, 3, 1, { id: 'pass', surfaceY: 0.9 }),
  F('fridge', 12.45, 35, 0.9, 1.8, { tall: true, rot: E }),
  F('sink', 17, 43.55, 5, 0.9, { rot: N }),
  F('counter', 23.55, 36.5, 0.9, 2, { id: 'tray_counter', surfaceY: 0.9, rot: W }),
  F('cabinet', 12.12, 40.5, 0.1, 0.5, { id: 'key_hook', wall: true, block: false, h: 0.4, color: '#8a6a4a' }),
  F('trash', 22.6, 42.6, 0.6, 0.6, { id: 'trash_kitchen' }),
  F('cabinet', 23.9, 38.5, 0.1, 0.4, { id: 'firealarm_kitchen', wall: true, block: false, h: 0.4, color: '#e04848' }),

  // ---- Library
  F('bookshelf', 26.4, 18, 0.7, 6, { tall: true, rot: E }),
  F('bookshelf', 30.2, 14.4, 1.4, 0.7, { tall: true }),
  F('table_small', 28.5, 17.5, 1.6, 0.9, { surfaceY: 0.74, color: '#8b5a3c' }),
  F('armchair', 27.6, 19.6, 0.8, 0.8, { rot: N, color: '#6d8f5e' }),
  F('armchair', 29.8, 19.6, 0.8, 0.8, { rot: N, color: '#6d8f5e' }),
  F('globe', 30.5, 20.6, 0.6, 0.6),

  // ---- Gallery
  F('pedestal_case', 36, 18, 1.6, 1.6, { id: 'duck_case' }),
  F('statue', 32.5, 15.5, 0.8, 0.8),
  F('statue', 39.5, 15.5, 0.8, 0.8),
  F('bench', 33.5, 20.5, 1.6, 0.5, { color: '#7a4f35' }),
  F('bench', 38.5, 20.5, 1.6, 0.5, { color: '#7a4f35' }),
  F('painting', 35.5, 14.1, 1.8, 0.1, { wall: true, block: false, color: '#e9b44c' }),
  F('painting', 31.1, 17.5, 0.1, 1.4, { wall: true, block: false, color: '#7fb3d5' }),
  F('painting', 40.9, 19.5, 0.1, 1.2, { wall: true, block: false, color: '#d98c8c' }),
  F('rope', 36, 18, 3.2, 3.2, { block: false }),

  // ---- Study
  F('desk', 44.5, 17.5, 2, 1, { id: 'study_desk', rot: S, surfaceY: 0.76 }),
  F('chair', 44.5, 16.6, 0.6, 0.6, { block: false, rot: S }),
  F('bookshelf', 47.6, 18, 0.7, 6, { tall: true, rot: W }),
  F('fireplace', 42.5, 14.35, 1.6, 0.6, { id: 'fireplace' }),
  F('wardrobe', 41.45, 20.5, 0.8, 1.4, { id: 'wardrobe', tall: true, rot: E }),
  F('armchair', 46.2, 20.3, 0.8, 0.8, { rot: N, color: '#8c3b3b' }),
  F('rug', 44.5, 18.5, 4, 3, { block: false, color: '#a8463d' }),

  // ---- Conservatory
  F('plant_big', 49.5, 15.5, 0.9, 0.9, { tall: true }),
  F('plant_big', 58.5, 15.5, 0.9, 0.9, { tall: true }),
  F('plant_big', 49.5, 21.5, 0.9, 0.9, { tall: true }),
  F('plant_big', 58.5, 22.5, 0.9, 0.9, { tall: true }),
  F('table_small', 51.5, 18.5, 0.9, 0.9, { surfaceY: 0.74, color: '#f2efe6' }),
  F('table_small', 56.5, 18.5, 0.9, 0.9, { surfaceY: 0.74, color: '#f2efe6' }),
  F('bench', 54, 21.6, 1.8, 0.5, { color: '#f2efe6' }),

  // ---- Gallery hall
  F('water_cooler', 31.5, 22.45, 0.6, 0.6, { id: 'water_cooler' }),
  F('plant', 33.5, 22.4, 0.6, 0.6),
  F('plant', 39.5, 22.4, 0.6, 0.6),
  F('plant', 47.4, 24.5, 0.6, 0.6),
  F('trash', 41.5, 24.6, 0.5, 0.5, { id: 'trash_galhall' }),
  F('painting', 30, 22.1, 1.2, 0.1, { wall: true, block: false, color: '#9bc59d' }),
  F('painting', 42.5, 22.1, 1.2, 0.1, { wall: true, block: false, color: '#c79bd6' }),

  // ---- Ballroom
  F('stage', 36, 26, 5, 1.8, { block: false }),
  F('podium', 36.5, 25.55, 0.6, 0.5),
  F('piano', 28.5, 32.5, 2, 1.6, { id: 'piano', rot: E }),
  F('table_round', 32, 28, 1.6, 1.6, { surfaceY: 0.76 }),
  F('table_round', 41, 28, 1.6, 1.6, { surfaceY: 0.76 }),
  F('table_round', 32, 33, 1.6, 1.6, { surfaceY: 0.76 }),
  F('table_round', 41, 33, 1.6, 1.6, { surfaceY: 0.76 }),
  F('punch_table', 46.5, 27.5, 0.8, 2, { id: 'punch_table', surfaceY: 0.8 }),
  F('plant', 47.4, 34.4, 0.6, 0.6),
  F('plant', 26.6, 25.6, 0.6, 0.6),
  F('rug', 36.5, 30.5, 7, 4.6, { block: false, color: '#e6c87a' }),

  // ---- Lounge
  F('bar', 51, 33.5, 4, 0.8, { id: 'bar', surfaceY: 1.05, rot: N }),
  F('sofa', 55.5, 28.5, 2.6, 0.8, { rot: S, color: '#6b5b95' }),
  F('table_small', 55.5, 29.5, 1.4, 0.6, { surfaceY: 0.45, color: '#3d3d4d' }),
  F('sofa', 55.5, 30.5, 2.6, 0.8, { rot: N, color: '#6b5b95' }),
  F('jukebox', 59.4, 25.7, 0.8, 0.6, { id: 'jukebox', rot: W }),
  F('armchair', 50, 27, 0.8, 0.8, { rot: E, color: '#b07aa1' }),
  F('plant', 59.4, 34.4, 0.6, 0.6),
  F('painting', 54, 25.1, 1.4, 0.1, { wall: true, block: false, color: '#5fa3a0' }),

  // ---- Dining
  F('table_long', 28, 39.5, 3.6, 1.8, { id: 'dining_table', surfaceY: 0.76 }),
  F('buffet', 28, 43.5, 5, 0.8, { id: 'buffet', surfaceY: 0.9 }),
  F('chair', 26.5, 37.9, 0.5, 0.5, { block: false, rot: S }),
  F('chair', 28, 37.9, 0.5, 0.5, { block: false, rot: S }),
  F('chair', 29.5, 37.9, 0.5, 0.5, { block: false, rot: S }),
  F('chair', 26.5, 41.1, 0.5, 0.5, { block: false, rot: N }),
  F('chair', 29.5, 41.1, 0.5, 0.5, { block: false, rot: N }),

  // ---- Foyer
  F('gift_table', 32.6, 37, 0.8, 2, { id: 'gift_table', surfaceY: 0.8 }),
  F('stairs', 40.5, 36.2, 3, 2.4, { tall: false }),
  F('coat_rack', 41.4, 42.8, 0.5, 0.5),
  F('plant', 32.6, 43.4, 0.6, 0.6),
  F('cabinet', 34.5, 43.88, 0.4, 0.1, { id: 'firealarm_foyer', wall: true, block: false, h: 0.4, color: '#e04848' }),
  F('rug', 37, 40, 4, 5, { block: false, color: '#b03a3a' }),

  // ---- East hall
  F('wardrobe', 47.5, 37.5, 0.8, 1.6, { id: 'closet', tall: true, rot: W, color: '#9c6b46' }),
  F('bench', 44, 43.55, 1.6, 0.5, { rot: N }),
  F('painting', 45, 35.1, 1.2, 0.1, { wall: true, block: false, color: '#f0c27b' }),

  // ---- WC
  F('stall', 49, 36.2, 2, 2.4, { block: false }),
  F('stall', 51, 36.2, 2, 2.4, { block: false }),
  F('toilet', 49, 35.4, 0.5, 0.6, { block: false }),
  F('toilet', 51, 35.4, 0.5, 0.6, { block: false }),
  F('sink', 51.6, 41.5, 0.6, 2, { rot: W }),

  // ---- Bath
  F('bathtub', 57.75, 42.6, 3.2, 1.6),
  F('toilet', 53, 35.4, 0.5, 0.6, { block: false }),
  F('sink', 52.4, 39.5, 0.7, 1.2, { id: 'bath_sink', rot: E }),
  F('cabinet', 52.12, 39.5, 0.12, 0.7, { id: 'medicine_cabinet', wall: true, block: false, h: 0.6, color: '#e8f4f0' }),
  F('plant', 59.4, 35.6, 0.6, 0.6),

  // ---- Shed
  F('shelf', 2.4, 5.5, 0.7, 3, { id: 'shed_shelf', surfaceY: 1.0, rot: E }),
  F('workbench', 6.5, 3.5, 2, 0.8, { surfaceY: 0.85 }),
  F('ladder', 7.6, 7.2, 0.4, 0.4, { block: false }),
  F('tool_rack', 4.5, 3.12, 1.4, 0.1, { wall: true, block: false }),

  // ================= OUTDOORS =================
  // ---- Back garden
  F('gazebo', 16, 8, 4, 4, { block: false }),
  F('duck_fountain', 36, 7, 3, 3, { id: 'duck_fountain' }),
  F('fireworks', 28, 4, 1.2, 1.2, { id: 'fireworks' }),
  F('bush', 33.5, 12.5, 0.95, 0.95, { id: 'bush_gal1', tall: true }),
  F('bush', 38.5, 12.5, 0.95, 0.95, { id: 'bush_gal2', tall: true }),
  F('bush', 23.5, 10.5, 0.95, 0.95, { id: 'bush_garden', tall: true }),
  F('bush', 50.5, 6.5, 0.95, 0.95, { id: 'bush_terrace', tall: true }),
  F('hedge', 22.5, 3, 1, 6, { tall: true }),
  F('hedge', 10.5, 6, 1, 6, { tall: true }),
  F('hedge', 44.5, 7, 1, 6, { tall: true }),
  F('hedge', 30, 12.5, 4, 1, { tall: true }),
  F('hedge', 42, 12.5, 4, 1, { tall: true }),
  F('flowerbed', 36, 12.5, 3, 1, { block: false }),
  F('tree', 5.5, 11.5, 1, 1, { tall: true }),
  F('tree', 30.5, 1.5, 1, 1, { tall: true }),
  F('tree', 40.5, 1.5, 1, 1, { tall: true }),
  F('tree', 66.5, 6.5, 1, 1, { tall: true }),
  F('pine', 18.5, 1.5, 1, 1, { tall: true }),
  F('pine', 1.5, 1.5, 1, 1, { tall: true }),
  F('bench', 36, 10.6, 1.6, 0.5, { rot: N }),
  F('umbrella_table', 49.5, 10.5, 1, 1, { surfaceY: 0.74 }),
  F('umbrella_table', 57.5, 10.5, 1, 1, { surfaceY: 0.74 }),
  F('string_lights', 54, 11, 14, 5, { block: false }),
  F('boat', 61, 0.9, 1.2, 1.6, { id: 'boat', block: false }),
  F('dock_post', 60.1, 2, 0.2, 0.2, { block: false }),
  F('dock_post', 61.9, 2, 0.2, 0.2, { block: false }),

  // ---- Service yard
  F('van', 3.5, 26.5, 2.4, 5, { id: 'delivery_van', color: '#f2f2f2', tall: true }),
  F('van', 3.5, 45.5, 2.4, 5, { id: 'electric_van', color: '#f4c542', tall: true }),
  F('dumpster', 9.5, 41.5, 1.8, 1, { id: 'dumpster' }),
  F('crate', 10.5, 30.5, 0.9, 0.9),
  F('crate', 10.5, 31.5, 0.9, 0.9),
  F('barrel', 1.5, 36.5, 0.8, 0.8),
  F('barrel', 1.5, 37.5, 0.8, 0.8),
  F('booth', 8.5, 57.4, 1.6, 1.6, { tall: true }),
  F('bush', 1.5, 52.5, 0.95, 0.95, { id: 'bush_yard', tall: true }),

  // ---- Front yard
  F('fountain', 36, 51.5, 3, 3, { id: 'fountain' }),
  F('car', 19, 50, 2, 4, { color: '#e8a0a0', tall: false }),
  F('car', 24, 50, 2, 4, { color: '#a0c4e8', tall: false }),
  F('car', 48, 50, 2, 4, { color: '#f0dc8c', tall: false }),
  F('car', 53, 50, 2, 4, { color: '#b8e0b0', tall: false }),
  F('car', 65, 55, 2, 4, { color: '#d0b0e0', tall: false }),
  F('bush', 14.5, 45.5, 0.95, 0.95, { id: 'bush_front1', tall: true }),
  F('bush', 42.5, 45.5, 0.95, 0.95, { id: 'bush_front2', tall: true }),
  F('bush', 58.5, 45.5, 0.95, 0.95, { id: 'bush_front3', tall: true }),
  F('bush', 67.5, 56.5, 0.95, 0.95, { id: 'bush_gap', tall: true }),
  F('hedge', 31.5, 56, 1, 4, { tall: true }),
  F('hedge', 40.5, 56, 1, 4, { tall: true }),
  F('tree', 15.5, 54.5, 1, 1, { tall: true }),
  F('tree', 27.5, 56.5, 1, 1, { tall: true }),
  F('tree', 45.5, 56.5, 1, 1, { tall: true }),
  F('tree', 56.5, 54.5, 1, 1, { tall: true }),
  F('pine', 70.5, 47.5, 1, 1, { tall: true }),
  F('booth', 32.5, 57, 1, 1.4, { tall: true, color: '#e9dcc9' }),
  F('bench', 28, 48.5, 1.6, 0.5, { rot: S }),
  F('bench', 44, 48.5, 1.6, 0.5, { rot: S }),
  F('flowerbed', 26, 45, 6, 1, { block: false }),
  F('flowerbed', 49, 45, 8, 1, { block: false }),

  // ---- East garden
  F('bush', 61.5, 41.5, 0.95, 0.95, { id: 'bush_east1', tall: true }),
  F('bush', 61.5, 36.5, 0.95, 0.95, { id: 'bush_east2', tall: true }),
  F('hedge', 66.5, 33, 1, 4, { tall: true }),
  F('hedge', 66.5, 22, 1, 4, { tall: true }),
  F('statue', 68.5, 28.5, 0.9, 0.9),
  F('bench', 69, 24, 0.5, 1.6, { rot: W }),
  F('tree', 70.5, 17.5, 1, 1, { tall: true }),
  F('tree', 70.5, 39.5, 1, 1, { tall: true }),

  // ---- Street
  F('car', 12, 63, 4, 2, { color: '#7fa7c9' }),
  F('car', 20, 63, 4, 2, { id: 'street_car', color: '#c97f7f' }),
  F('car', 51, 63, 4, 2, { id: 'late_car', color: '#9b7fc9' }),
  F('car', 58, 63, 4, 2, { color: '#7fc9a3' }),
  F('mailbox', 28.5, 60.4, 0.5, 0.5),
  F('hydrant', 46.5, 60.4, 0.4, 0.4),
  F('phone_booth', 66.5, 60.6, 1, 1, { tall: true }),
];

/** Lamp posts and their power circuit ('S' = municipal street lights, always on). */
export const LAMPS: { x: number; z: number; circuit: 'A' | 'B' | 'S' }[] = [
  { x: 40, z: 10.2, circuit: 'B' },
  { x: 30, z: 10.2, circuit: 'B' },
  { x: 20, z: 5, circuit: 'B' },
  { x: 48, z: 6, circuit: 'B' },
  { x: 58, z: 6.5, circuit: 'B' },
  { x: 62.3, z: 4.3, circuit: 'B' },
  { x: 10, z: 20, circuit: 'A' },
  { x: 10, z: 34, circuit: 'A' },
  { x: 10, z: 48, circuit: 'A' },
  { x: 6.5, z: 55, circuit: 'A' },
  { x: 33, z: 47, circuit: 'B' },
  { x: 39, z: 47, circuit: 'B' },
  { x: 33.2, z: 58.4, circuit: 'B' },
  { x: 38.8, z: 58.4, circuit: 'B' },
  { x: 20, z: 56, circuit: 'B' },
  { x: 52, z: 56, circuit: 'B' },
  { x: 63, z: 22, circuit: 'B' },
  { x: 63, z: 36, circuit: 'B' },
  { x: 8, z: 60.6, circuit: 'S' },
  { x: 24, z: 60.6, circuit: 'S' },
  { x: 40, z: 60.6, circuit: 'S' },
  { x: 56, z: 60.6, circuit: 'S' },
  { x: 70, z: 60.6, circuit: 'S' },
];

/** Purely visual floor patches (paths, terrace...). */
export const PATCHES: { rect: [number, number, number, number]; floor: 'gravel' | 'stone' | 'sidewalk' }[] = [
  { rect: [33, 44, 39, 59], floor: 'gravel' },
  { rect: [31, 48, 41, 55], floor: 'gravel' },
  { rect: [0, 59, 72, 61], floor: 'sidewalk' },
  { rect: [46, 8, 62, 14], floor: 'stone' },
  { rect: [53, 4, 55, 8], floor: 'stone' },
  { rect: [55, 4, 63, 5], floor: 'stone' },
  { rect: [24, 8, 26, 14], floor: 'stone' },
  { rect: [4, 8, 26, 9], floor: 'stone' },
  { rect: [64, 40, 66, 48], floor: 'stone' },
  { rect: [64, 14, 66, 40], floor: 'stone' },
];

export const CAMERAS: { id: string; x: number; z: number; angle: number; sweep: number; period: number; range: number; fov: number }[] = [
  { id: 'cam_gallery', x: 40.55, z: 21.55, angle: Math.atan2(-4.6, -3.6), sweep: 0.55, period: 9, range: 11, fov: 0.95 },
  { id: 'cam_galhall', x: 47.55, z: 22.45, angle: W, sweep: 0.22, period: 7, range: 14, fov: 0.7 },
  { id: 'cam_foyer', x: 32.45, z: 35.45, angle: Math.atan2(4.6, 6.6), sweep: 0.55, period: 10, range: 11, fov: 0.9 },
  { id: 'cam_yard', x: 11.55, z: 36.5, angle: Math.atan2(-5, 13), sweep: 0.6, period: 11, range: 14, fov: 0.9 },
];

export const PLAYER_START = { x: 60.5, z: 62.2, face: N };
