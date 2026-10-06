// Character appearance description (mirrors view/CharacterModel's Appearance, kept here
// so the simulation does not depend on rendering code).
export type HairStyle = 'short' | 'bald' | 'bun' | 'long' | 'ponytail' | 'curly' | 'bob' | 'slick' | 'spiky';
export type OutfitStyle =
  | 'suit'
  | 'tux'
  | 'dress'
  | 'waiter'
  | 'chef'
  | 'guard'
  | 'maid'
  | 'butler'
  | 'electrician'
  | 'gardener'
  | 'host'
  | 'casual'
  | 'bartender'
  | 'musician';
export type HatStyle = 'none' | 'guard_cap' | 'chef_toque' | 'top_hat' | 'cap' | 'beanie' | 'maid_band' | 'straw' | 'hard_hat' | 'fascinator';

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  bottom: string;
  accent?: string;
  outfit: OutfitStyle;
  hat?: HatStyle;
  facial?: 'none' | 'mustache' | 'beard';
  glasses?: boolean;
  monocle?: boolean;
  height?: number;
  girth?: number;
}
