// Which music the situation calls for, from the player's point of view (what they can know).
import type { MusicState } from '../audio/Audio';
import type { World } from '../sim/World';

export function wantedMusic(w: World): MusicState {
  const p = w.player;
  const noticed = [...p.noticedBy.values()].reduce((a, b) => Math.max(a, b), 0);
  if (w.security.lockdown) return p.chasers.size ? 'chase' : 'lockdown';
  if (p.chasers.size) return 'chase';
  if (w.security.alarmOn || w.searchers.size || noticed > 0.5 || p.confrontedBy.size) return 'tension';
  if (!w.power.on('B') && w.grid.roomAt(p.pos)?.indoor) return 'blackout';
  if (w.playerStatus.trespass || noticed > 0.05 || p.crouching || p.hasGoldenDuck()) return 'sneak';
  return 'calm';
}
