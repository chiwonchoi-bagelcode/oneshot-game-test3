// Smooths the in-game music state. The game asks for a mood every frame (calm, sneak, tension...)
// and that request can flicker many times a second (a glance, a step in and out of a doorway).
// Every switch crossfades to a freshly started score, so flicker is heard as the music cutting out.
// Rules: getting more intense is quick, calming down needs the calmer mood to hold for a while.

import type { MusicState } from './Audio';

const RANK: Record<MusicState, number> = {
  off: 0,
  title: 0,
  calm: 0,
  sneak: 1,
  blackout: 1,
  tension: 2,
  lockdown: 3,
  chase: 4,
  victory: 5,
  fail: 5,
};

export interface MoodTiming {
  /** Seconds a more intense mood must be asked for before switching (chase/lockdown: instantly). */
  up: number;
  /** Seconds a calmer mood must be asked for, without interruption, before switching down. */
  down: number;
  /** Seconds for a switch between moods of the same intensity (sneak <-> blackout). */
  side: number;
}

export class MusicMood {
  current: MusicState = 'off';
  private upFor = 0;
  private upBest: MusicState | null = null;
  private downFor = 0;
  private sideFor = 0;

  constructor(private timing: MoodTiming = { up: 0.4, down: 4, side: 2.5 }) {}

  /** Jump straight to a state (game start, endings, title). */
  force(state: MusicState): MusicState {
    this.current = state;
    this.reset();
    return state;
  }

  private reset() {
    this.upFor = 0;
    this.upBest = null;
    this.downFor = 0;
    this.sideFor = 0;
  }

  private switchTo(state: MusicState): MusicState {
    this.current = state;
    this.reset();
    return state;
  }

  /** Feed the mood the game asks for this frame; returns the state that should be playing. */
  update(asked: MusicState, dt: number): MusicState {
    const from = RANK[this.current];
    const to = RANK[asked];
    if (to > from) {
      // Something is up: switch soon, to the most intense mood asked for meanwhile.
      this.downFor = 0;
      this.sideFor = 0;
      this.upFor += dt;
      if (!this.upBest || to >= RANK[this.upBest]) this.upBest = asked;
      if (to >= RANK.lockdown || this.upFor >= this.timing.up) return this.switchTo(this.upBest);
    } else if (to < from) {
      // Calming down: only once it has stayed calmer for a while.
      this.upFor = 0;
      this.upBest = null;
      this.sideFor = 0;
      this.downFor += dt;
      if (this.downFor >= this.timing.down) return this.switchTo(asked);
    } else if (asked !== this.current) {
      this.upFor = 0;
      this.upBest = null;
      this.downFor = 0;
      this.sideFor += dt;
      if (this.sideFor >= this.timing.side) return this.switchTo(asked);
    } else this.reset();
    return this.current;
  }
}
