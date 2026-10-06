// Keyboard (and mouse wheel) input.
export type Btn =
  | 'interact'
  | 'cycle'
  | 'throw'
  | 'drop'
  | 'whistle'
  | 'crouch'
  | 'journal'
  | 'pause'
  | 'mute'
  | 'o1'
  | 'o2'
  | 'o3'
  | 'o4'
  | 'o5'
  | 'map';

const BIND: Record<string, Btn> = {
  KeyE: 'interact',
  KeyF: 'interact',
  KeyR: 'cycle',
  KeyQ: 'throw',
  KeyG: 'drop',
  Space: 'whistle',
  KeyC: 'crouch',
  Tab: 'journal',
  KeyJ: 'journal',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  Digit1: 'o1',
  Digit2: 'o2',
  Digit3: 'o3',
  Digit4: 'o4',
  Digit5: 'o5',
};

export class Input {
  private down = new Set<string>();
  private pressed: Btn[] = [];
  zoom = 0.85;
  enabled = true;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) {
        const b = BIND[e.code];
        if (b) this.pressed.push(b);
      }
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener(
      'wheel',
      (e) => {
        this.zoom = Math.min(1.7, Math.max(0.6, this.zoom * (e.deltaY > 0 ? 1.08 : 0.93)));
      },
      { passive: true },
    );
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  /** Movement vector in world space: up = north (-z). */
  move(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) z -= 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) z += 1;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    return { x, z };
  }
  get run() {
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight');
  }
  get crouchHeld() {
    return this.down.has('ControlLeft') || this.down.has('ControlRight');
  }
  get instinct() {
    return this.down.has('KeyV');
  }

  consume(): Btn[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }
}
