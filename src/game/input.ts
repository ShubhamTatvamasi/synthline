/**
 * Unified input: keyboard, on-screen touch buttons (wired from the UI) and
 * gamepad. Exposes a per-frame polled state plus edge-triggered actions.
 */

export type VirtualKey = 'left' | 'right' | 'accel' | 'brake' | 'boost';

interface KeyMap {
  [code: string]: VirtualKey;
}

const KEY_MAP: KeyMap = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'accel',
  KeyW: 'accel',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyX: 'boost',
};

const PREVENT = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
]);

export interface InputHooks {
  onPause?: () => void;
  onRestart?: () => void;
  onConfirm?: () => void;
  onToggleMute?: () => void;
}

export interface PolledInput {
  steer: number; // -1..1
  accel: boolean;
  brake: boolean;
  boost: boolean;
}

export class Input {
  private keys = new Set<string>();
  private virtual: Record<VirtualKey, boolean> = {
    left: false,
    right: false,
    accel: false,
    brake: false,
    boost: false,
  };
  /** Auto-throttle when the primary control scheme is touch. */
  public touchMode = false;

  private hooks: InputHooks = {};
  private padPauseWas = false;

  attach(hooks: InputHooks): void {
    this.hooks = hooks;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  setVirtual(key: VirtualKey, down: boolean): void {
    this.virtual[key] = down;
  }

  clearVirtuals(): void {
    for (const k of Object.keys(this.virtual) as VirtualKey[]) this.virtual[k] = false;
  }

  private onBlur = (): void => {
    this.keys.clear();
    this.clearVirtuals();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (PREVENT.has(e.code)) e.preventDefault();
    const mapped = KEY_MAP[e.code];
    if (mapped) this.keys.add(mapped);
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') this.hooks.onPause?.();
    if (e.code === 'KeyR') this.hooks.onRestart?.();
    if (e.code === 'Enter' || e.code === 'Space') this.hooks.onConfirm?.();
    if (e.code === 'KeyM') this.hooks.onToggleMute?.();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const mapped = KEY_MAP[e.code];
    if (mapped) this.keys.delete(mapped);
  };

  /** Merge keyboard + touch + gamepad into one state. Call once per frame. */
  poll(): PolledInput {
    let steer = 0;
    let accel = false;
    let brake = false;
    let boost = false;

    if (this.keys.has('left') || this.virtual.left) steer -= 1;
    if (this.keys.has('right') || this.virtual.right) steer += 1;
    accel = this.keys.has('accel') || this.virtual.accel;
    brake = this.keys.has('brake') || this.virtual.brake;
    boost = this.keys.has('boost') || this.virtual.boost;

    // Gamepad
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        if (!pad) continue;
        const ax = pad.axes[0] ?? 0;
        if (Math.abs(ax) > 0.16) steer += ax;
        if (pad.buttons[14]?.pressed) steer -= 1; // d-pad left
        if (pad.buttons[15]?.pressed) steer += 1; // d-pad right
        if (pad.buttons[7]?.pressed || pad.buttons[0]?.pressed) accel = true; // RT / A
        if (pad.buttons[6]?.pressed) brake = true; // LT
        if (pad.buttons[1]?.pressed || pad.buttons[2]?.pressed) boost = true; // B / X
        const pause = pad.buttons[9]?.pressed ?? false; // Start
        if (pause && !this.padPauseWas) this.hooks.onPause?.();
        this.padPauseWas = pause;
      }
    }

    // Touch devices auto-accelerate — arcade style
    if (this.touchMode) accel = true;

    return {
      steer: Math.max(-1, Math.min(1, steer)),
      accel,
      brake,
      boost,
    };
  }
}
