// Shared level/sim type definitions.

export type Zone =
  | 'street'
  | 'public'
  | 'staff'
  | 'sec_elec'
  | 'sec_security'
  | 'sec_gallery'
  | 'sec_study'
  | 'sec_shed';

export type Circuit = 'A' | 'B' | 'C';

export type Floor =
  | 'grass'
  | 'gravel'
  | 'asphalt'
  | 'sidewalk'
  | 'concrete'
  | 'stone'
  | 'wood'
  | 'parquet'
  | 'marble'
  | 'checker'
  | 'carpet_red'
  | 'carpet_green'
  | 'carpet_purple'
  | 'tile_blue'
  | 'tile_white'
  | 'tile_mint'
  | 'lino'
  | 'terracotta'
  | 'water'
  | 'deck';

export type OutfitId = 'guest' | 'waiter' | 'chef' | 'guard' | 'electrician';

export type KeyId = 'key_gallery' | 'key_study' | 'key_elec' | 'key_shed' | 'key_van';

export interface RoomDef {
  id: string;
  name: string;
  rect: [number, number, number, number]; // x0, z0, x1, z1 (exclusive)
  indoor: boolean;
  zone: Zone;
  /** Lighting circuit for indoor rooms (outdoor areas use lamp posts). */
  circuit?: Circuit;
  floor: Floor;
  /** Light switch position (indoor rooms). */
  switchAt?: [number, number];
  /** Rooms that start with lights off. */
  dark?: boolean;
}

export type EdgeKind = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const E_NONE = 0 as const;
export const E_WALL = 1 as const;
export const E_WINDOW = 2 as const;
export const E_DOOR = 3 as const;
export const E_HEDGE = 4 as const;
export const E_FENCE = 5 as const;
export const E_CRAWL = 6 as const;

export interface DoorDef {
  id: string;
  name: string;
  axis: 'h' | 'v'; // h: edge line z=at spanning x in [from,to); v: x=at spanning z
  at: number;
  from: number;
  to: number;
  lock?: KeyId;
  /** Can be lockpicked by the player. */
  pickable?: boolean;
  /** Starts open. */
  open?: boolean;
  /** NPCs close this behind them (and lock it if they hold its key). */
  keepClosed?: boolean;
  style?: 'wood' | 'double' | 'glass' | 'gate' | 'staff' | 'metal';
  /** Door belongs to a checkpoint (gate) and is closed only during lockdown. */
  gate?: boolean;
}

export interface WindowDef {
  id: string;
  axis: 'h' | 'v';
  at: number;
  from: number;
  to: number;
  /** Starts open (ajar). */
  open?: boolean;
  /** Can be opened from outside (not just from inside). */
  outsideOpen?: boolean;
  /** Glass conservatory pane: never opens. */
  fixed?: boolean;
}

export interface BarrierDef {
  axis: 'h' | 'v';
  at: number;
  from: number;
  to: number;
  kind: 'hedge' | 'fence' | 'crawl';
}

export type FurnKind =
  | 'table_round'
  | 'table_long'
  | 'table_small'
  | 'buffet'
  | 'desk'
  | 'desk_monitors'
  | 'chair'
  | 'armchair'
  | 'sofa'
  | 'bed'
  | 'bookshelf'
  | 'shelf'
  | 'locker'
  | 'counter'
  | 'stove'
  | 'fridge'
  | 'sink'
  | 'bar'
  | 'piano'
  | 'podium'
  | 'stage'
  | 'pedestal_case'
  | 'statue'
  | 'plant'
  | 'plant_big'
  | 'hedge'
  | 'bush'
  | 'tree'
  | 'pine'
  | 'flowerbed'
  | 'fountain'
  | 'duck_fountain'
  | 'car'
  | 'van'
  | 'lamp'
  | 'bench'
  | 'crate'
  | 'dumpster'
  | 'gazebo'
  | 'fireworks'
  | 'boat'
  | 'dock_post'
  | 'toilet'
  | 'stall'
  | 'bathtub'
  | 'cabinet'
  | 'coffee_machine'
  | 'water_cooler'
  | 'punch_table'
  | 'jukebox'
  | 'fusebox'
  | 'console'
  | 'wardrobe'
  | 'fireplace'
  | 'stairs'
  | 'rug'
  | 'gift_table'
  | 'coat_rack'
  | 'booth'
  | 'trash'
  | 'workbench'
  | 'barrel'
  | 'string_lights'
  | 'painting'
  | 'notice_board'
  | 'globe'
  | 'tv'
  | 'rope'
  | 'umbrella_table'
  | 'hydrant'
  | 'mailbox'
  | 'phone_booth'
  | 'tool_rack'
  | 'ladder';

export interface FurnDef {
  id: string;
  kind: FurnKind;
  /** Center position. */
  x: number;
  z: number;
  /** Footprint along x and z (already rotated). */
  w: number;
  d: number;
  /** Visual height (optional; view picks defaults). */
  h?: number;
  /** Facing angle (for chairs, desks, ...). Radians, see math.ts convention. */
  rot?: number;
  /** Blocks navigation cells + collision. Default true. */
  block?: boolean;
  /** Blocks line of sight. */
  tall?: boolean;
  /** Item placement surface height. */
  surfaceY?: number;
  color?: string;
  /** Wall-mounted decor: no collision at all. */
  wall?: boolean;
}

export interface StationDef {
  id: string;
  x: number;
  z: number;
  /** Facing angle when performing the activity. */
  face?: number;
  /** Look-at point instead of facing angle. */
  lookAt?: [number, number];
}
