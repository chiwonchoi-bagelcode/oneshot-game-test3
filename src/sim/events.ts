// Typed event bus used by the simulation to talk to view/UI/audio layers.

export type BarkKind = 'normal' | 'alert' | 'radio' | 'intel' | 'thought' | 'speech' | 'whisper';
export type NotifyKind = 'info' | 'warn' | 'danger' | 'good' | 'intel';

export interface GameEvents {
  sfx: { name: string; x?: number; z?: number; volume?: number; pitch?: number };
  voice: { kind: string; x: number; z: number; pitch: number; volume?: number };
  bark: { id: string; text: string; dur: number; kind: BarkKind };
  notify: { text: string; kind: NotifyKind };
  intel: { id: string; title: string };
  todo: { id: string };
  noise: { x: number; z: number; radius: number; kind: string };
  fx: { kind: 'shards' | 'sparkle' | 'smoke' | 'fireworks' | 'splash' | 'poof' | 'paint' | 'pills' | 'confetti' | 'dust'; x: number; z: number; y?: number };
  power: { circuit: string; on: boolean };
  caught: { by: string; reason: string };
  escaped: { route: string };
  lockdown: Record<string, never>;
  alarm: { on: boolean };
  outfit: { outfit: string };
  shake: { amount: number };
}

type Handler<T> = (e: T) => void;

export class Emitter<M extends object> {
  private h = new Map<keyof M, Handler<never>[]>();
  on<K extends keyof M>(k: K, fn: Handler<M[K]>): () => void {
    const arr = (this.h.get(k) ?? []) as Handler<M[K]>[];
    arr.push(fn);
    this.h.set(k, arr as Handler<never>[]);
    return () => {
      const a = this.h.get(k) as Handler<M[K]>[] | undefined;
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  }
  emit<K extends keyof M>(k: K, e: M[K]) {
    const arr = this.h.get(k) as Handler<M[K]>[] | undefined;
    if (!arr) return;
    for (const fn of arr.slice()) fn(e);
  }
  clear() {
    this.h.clear();
  }
}
