import type { V2 } from '../core/math';
import { ITEMS, type ItemDef, type ItemType } from './rules';

export type ItemState =
  | 'ground' // lying on the floor / a surface (y = height)
  | 'held' // in someone's hands (holder)
  | 'pocket' // in someone's pockets (holder)
  | 'inside' // inside a carried container item (container) or a static container (bin)
  | 'display' // on the gallery pedestal
  | 'flying'
  | 'gone';

let nextId = 1;
export function resetItemIds() {
  nextId = 1;
}

export class Item {
  readonly id: number;
  readonly type: ItemType;
  pos: V2;
  y: number;
  state: ItemState = 'ground';
  holder: string | null = null;
  container: Item | null = null;
  bin: string | null = null;
  contents: Item | null = null;
  vel = { x: 0, y: 0, z: 0 };
  thrower: string | null = null;
  spin = 0;
  /** Where the item started (for 'out of place' checks). */
  readonly home: V2;
  readonly homeRoom: string;
  /** Bumped when the item moves to a new resting place (so NPCs re-notice). */
  version = 0;
  /** Gift boxes have different ribbons etc. (view only). */
  variant = 0;

  constructor(type: ItemType, pos: V2, y = 0, homeRoom = '') {
    this.id = nextId++;
    this.type = type;
    this.pos = { x: pos.x, z: pos.z };
    this.y = y;
    this.home = { x: pos.x, z: pos.z };
    this.homeRoom = homeRoom;
  }

  get def(): ItemDef {
    return ITEMS[this.type];
  }
  get name(): string {
    return ITEMS[this.type].name;
  }
  /** Is it lying in the world where it can be seen? */
  get exposed(): boolean {
    return this.state === 'ground' || this.state === 'display';
  }
  /** Item or its container content is of given type. */
  hasInside(type: ItemType): boolean {
    return !!this.contents && (this.contents.type === type || this.contents.hasInside(type));
  }
}

/** Static containers (bins, dumpster) that hold items. */
export interface Bin {
  id: string;
  name: string;
  pos: V2;
  items: Item[];
  /** Emptied by the maid into this bin id. */
  emptiesTo?: string;
  capacity: number;
}
