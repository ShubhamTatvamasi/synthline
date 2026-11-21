/**
 * The game engine: state machine, physics, laps, traffic AI, the near-miss
 * boost mechanic, ghost recording/playback, and the adaptive-quality loop.
 */

import { CFG, PLAYER_Z } from './config';
import { AudioSys } from './audio';
import { Input, type PolledInput, type VirtualKey } from './input';
import { Renderer, type RenderState } from './render';
import { buildTrack, clearTraffic, findSegment, resetTraffic } from './track';
import type {
  BestRecord,
  CarEntity,
  FinishStats,
  GameMode,
  GhostSample,
  HudSnapshot,
  Segment,
  Track,
} from './types';
import { accelerate, clamp, increase, lerp, overlap, wrapDelta } from './util';

export interface GameHooks {
  onHud: (hud: HudSnapshot) => void;
  onFinish: (stats: FinishStats) => void;
}

const BEST_KEY = 'synthline:best:v1';
const OPTS_KEY = 'synthline:opts:v1';

function loadBest(): BestRecord | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BestRecord> | null;
    if (typeof parsed?.totalMs !== 'number' || !Array.isArray(parsed.ghost)) return null;
    return {
      totalMs: parsed.totalMs,
      lapMs: Array.isArray(parsed.lapMs) ? parsed.lapMs : [],
      ghost: parsed.ghost,
    };
  } catch {
    return null;
  }
}

function saveBest(best: BestRecord): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* storage unavailable (private mode) — records just won't persist */
  }
}

function loadOpts(): { music: boolean; sfx: boolean } {
  try {
    const raw = localStorage.getItem(OPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { music?: boolean; sfx?: boolean };
      return { music: parsed.music !== false, sfx: parsed.sfx !== false };
    }
  } catch {
    /* ignore */
  }
  return { music: true, sfx: true };
}

function saveOpts(opts: { music: boolean; sfx: boolean }): void {
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify(opts));
  } catch {
    /* ignore */
  }
}

export class Game {
  private hooks: GameHooks;
  private renderer: Renderer;
  private input = new Input();
  private audio = new AudioSys();
  private track: Track;

  private raf: number | null = null;
  private lastTime = 0;
  private disposed = false;
  private ready = false;

  // — state —
  mode: GameMode = 'menu';
  paused = false;
  private position = 0;
  private playerX = 0;
  private playerY = 0;
  private speed = 0;
  private steer = 0;
  private skyOffset = 0;
  private shake = 0;
  private boostGlow = 0;

  // race
  private lap = 1;
  private lapTime = 0;
  private raceTime = 0;
  private lapTimes: number[] = [];
  private lastLap: number | null = null;
  private bestLap: number | null = null;
  private countdownT = 0;
  private lastCountdownShown = 0;
  private goFlash = 0;
  private invulnT = 0;
  /** Set when a collision teleports the player across the start line. */
  private suppressLap = false;

  // boost
  private boostMeter: number = CFG.boostStart;
  private boosting = false;

  // ghost
  private best: BestRecord | null = loadBest();
  private ghostRec: GhostSample[] = [];
  private ghostTimer = 0;
  private ghostPtr = 0;
  private ghost: { z: number; x: number } | null = null;

  // cached input for render (avoid double-poll side effects)
  private lastInput: PolledInput = { steer: 0, accel: false, brake: false, boost: false };

  // toasts
  private toast: { text: string; until: number } | null = null;

  // adaptive quality
  private drawDist: number = CFG.drawDist;
  private frameSum = 0;
  private frameCount = 0;
  private fps = 60;

  private onVisibility = (): void => {
    if (document.hidden && (this.mode === 'racing' || this.mode === 'countdown') && !this.paused) {
      this.pause();
    }
  };

  /** Pause when the window loses focus (alt-tab, address bar, another app). */
  private onBlur = (): void => {
    if ((this.mode === 'racing' || this.mode === 'countdown') && !this.paused) {
      this.pause();
    }
  };

  constructor(canvas: HTMLCanvasElement, hooks: GameHooks) {
    this.hooks = hooks;
    this.renderer = new Renderer(canvas);
    this.track = buildTrack();
    clearTraffic(this.track);
    this.position = 480 * CFG.segLen; // start the attract mode mid-track

    const opts = loadOpts();
    this.audio.musicOn = opts.music;
    this.audio.sfxOn = opts.sfx;

    this.input.attach({
      onPause: () => {
        if (this.mode === 'racing' || this.mode === 'countdown') {
          if (this.paused) this.resume();
          else this.pause();
        }
      },
      onRestart: () => {
        if (this.mode !== 'menu' && this.ready) this.beginRace();
      },
      onConfirm: () => {
        if (!this.ready) return;
        if (this.mode === 'menu' || this.mode === 'finished') this.beginRace();
        else if (this.paused) this.resume();
      },
      onToggleMute: () => this.toggleMute(),
    });

    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.ready = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.emitHud();
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  // ————————————————————————————————————————————————————————————————
  // Public controls (UI buttons)
  // ————————————————————————————————————————————————————————————————

  beginRace(): void {
    this.audio.ensure();
    this.audio.startMusic();
    this.audio.startEngine();
    resetTraffic(this.track);
    for (const car of this.track.cars) {
      car.relPrev = wrapDelta(car.z, PLAYER_Z, this.track.length);
    }
    this.position = 0;
    this.playerX = 0;
    this.speed = 0;
    this.steer = 0;
    this.lap = 1;
    this.lapTime = 0;
    this.raceTime = 0;
    this.lapTimes = [];
    this.lastLap = null;
    this.bestLap = null;
    this.boostMeter = CFG.boostStart;
    this.boosting = false;
    this.boostGlow = 0;
    this.ghostRec = [];
    this.ghostTimer = 0;
    this.ghostPtr = 0;
    this.ghost = null;
    this.countdownT = 3.999;
    this.lastCountdownShown = 0;
    this.goFlash = 0;
    this.invulnT = 0;
    this.suppressLap = false;
    this.toast = null;
    this.paused = false;
    this.mode = 'countdown';
    this.emitHud();
  }

  toMenu(): void {
    this.audio.stopEngine();
    this.mode = 'menu';
    this.paused = false;
    clearTraffic(this.track);
    this.speed = 0;
    this.ghost = null;
    this.emitHud();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.input.clearVirtuals();
    this.audio.suspend();
    this.emitHud();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.audio.resume();
    this.lastTime = performance.now();
    this.emitHud();
  }

  setTouchMode(on: boolean): void {
    this.input.touchMode = on;
  }

  setVirtual(key: VirtualKey, down: boolean): void {
    this.input.setVirtual(key, down);
  }

  setMusic(on: boolean): void {
    this.audio.setMusic(on);
    saveOpts({ music: on, sfx: this.audio.sfxOn });
  }

  setSfx(on: boolean): void {
    this.audio.setSfx(on);
    saveOpts({ music: this.audio.musicOn, sfx: on });
  }

  toggleMute(): void {
    const on = !(this.audio.musicOn || this.audio.sfxOn);
    this.audio.setMusic(on);
    this.audio.setSfx(on);
    saveOpts({ music: on, sfx: on });
  }

  playUiClick(): void {
    this.audio.uiClick();
  }

  get bestRaceMs(): number | null {
    return this.best?.totalMs ?? null;
  }

  // ————————————————————————————————————————————————————————————————
  // Loop
  // ————————————————————————————————————————————————————————————————

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    const frameMs = now - this.lastTime;
    this.lastTime = now;

    if (dt > 0) this.fps = this.fps * 0.92 + (1 / dt) * 0.08;

    if (!this.paused) this.update(dt);
    this.render();

    // Adaptive draw distance — keep it smooth on weak devices
    this.frameSum += frameMs;
    this.frameCount++;
    if (this.frameCount >= 40) {
      const avg = this.frameSum / this.frameCount;
      if (avg > 23 && this.drawDist > CFG.drawDistMin) this.drawDist = Math.max(CFG.drawDistMin, this.drawDist - 25);
      else if (avg < 16.5 && this.drawDist < CFG.drawDistMax) this.drawDist = Math.min(CFG.drawDistMax, this.drawDist + 10);
      this.frameSum = 0;
      this.frameCount = 0;
    }

    this.emitHud();
  };

  // ————————————————————————————————————————————————————————————————
  // Update
  // ————————————————————————————————————————————————————————————————

  private update(dt: number): void {
    if (this.mode === 'menu') this.updateAttract(dt);
    else if (this.mode === 'countdown') this.updateCountdown(dt);
    else if (this.mode === 'racing') this.updateRacing(dt);
    // 'finished' — world holds still
  }

  private updateAttract(dt: number): void {
    const targetSpeed = CFG.maxSpeed * 0.55;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 0.6);
    const speedPct = this.speed / CFG.maxSpeed;

    // Autopilot: aim for the middle of the upcoming curves
    const seg = findSegment(this.track, this.position);
    let curveSum = 0;
    for (let i = 6; i < 46; i++) curveSum += this.track.segments[(seg.index + i) % this.track.segments.length].curve;
    const targetX = clamp(-(curveSum / 40) * 0.22, -0.7, 0.7);
    const targetSteer = clamp((targetX - this.playerX) * 3, -1, 1);
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * 4);
    this.playerX += (targetX - this.playerX) * Math.min(1, dt * 1.1);

    this.position = increase(this.position, this.speed * dt, this.track.length);
    this.playerY = this.interpolateRoadY();
    this.skyOffset += 0.055 * seg.curve * speedPct * dt;
    this.shake *= Math.exp(-4 * dt);
    this.audio.engineUpdate(speedPct, false, dt, false);
  }

  private updateCountdown(dt: number): void {
    this.countdownT -= dt;
    const shown = Math.ceil(this.countdownT - 1);
    if (this.countdownT > 1) {
      if (shown !== this.lastCountdownShown && shown >= 1 && shown <= 3) {
        this.lastCountdownShown = shown;
        this.audio.countdown(false);
      }
    } else {
      // GO!
      this.mode = 'racing';
      this.goFlash = 0.85;
      this.audio.countdown(true);
    }
    this.playerY = this.interpolateRoadY();
    this.audio.engineUpdate(0.05 + (3 - this.countdownT) * 0.02, false, dt, true);
  }

  private updateRacing(dt: number): void {
    const polled: PolledInput = this.input.poll();
    this.lastInput = polled;

    // Smooth steering for visuals & physics feel
    this.steer += (polled.steer - this.steer) * Math.min(1, dt * 14);

    const playerSegment = findSegment(this.track, this.position + PLAYER_Z);
    const speedPct = this.speed / CFG.maxSpeed;
    const dx = dt * 2 * speedPct;

    this.playerX += this.steer * dx;
    this.playerX -= dx * speedPct * playerSegment.curve * CFG.centrifugal;

    // — Boost —
    const wantBoost = polled.boost && this.boostMeter > 0.5 && this.speed > CFG.maxSpeed * 0.3;
    if (wantBoost && !this.boosting) this.audio.boostEngage();
    this.boosting = wantBoost;
    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - CFG.boostDrainPerSec * dt);
    else this.boostMeter = Math.min(100, this.boostMeter + CFG.boostTricklePerSec * dt);
    this.boostGlow += ((this.boosting ? 1 : 0) - this.boostGlow) * Math.min(1, dt * 5);

    // — Throttle —
    const targetMax = this.boosting ? CFG.boostMaxSpeed : CFG.maxSpeed;
    if (polled.brake) {
      this.speed = accelerate(this.speed, CFG.brakeDecel, dt);
    } else if (polled.accel || this.input.touchMode) {
      this.speed = accelerate(this.speed, (this.boosting ? 2.2 : 1) * CFG.accel, dt, 0, targetMax);
    } else {
      this.speed = accelerate(this.speed, CFG.naturalDecel, dt);
    }
    if (!this.boosting && this.speed > CFG.maxSpeed) {
      this.speed = Math.max(CFG.maxSpeed, this.speed - 9000 * dt);
    }

    // — Off-road —
    const offroad = Math.abs(this.playerX) > 1;
    if (offroad && this.speed > CFG.offroadLimit) {
      this.speed = accelerate(this.speed, CFG.offroadDecel, dt);
      this.shake = Math.max(this.shake, 0.14);
    }

    this.playerX = clamp(this.playerX, -2.1, 2.1);
    this.speed = clamp(this.speed, 0, CFG.boostMaxSpeed);

    // — Advance + lap detection —
    const oldPos = this.position;
    this.position = increase(this.position, this.speed * dt, this.track.length);
    if (this.position < oldPos) {
      // A collision can shove the car backwards across the line; that must not
      // count as a completed lap.
      if (this.suppressLap) this.suppressLap = false;
      else this.onLapCrossed();
    }

    this.playerY = this.interpolateRoadY();
    this.skyOffset += 0.055 * playerSegment.curve * speedPct * dt;
    this.shake *= Math.exp(-4 * dt);
    if (this.invulnT > 0) this.invulnT -= dt;

    // — Traffic —
    this.updateTraffic(dt, playerSegment);

    // — Timers —
    this.raceTime += dt * 1000;
    this.lapTime += dt * 1000;
    if (this.goFlash > 0) this.goFlash -= dt;

    // — Ghost record + playback —
    this.ghostTimer += dt;
    if (this.ghostTimer >= 0.1) {
      this.ghostTimer -= 0.1;
      // Store the car's track position (not the camera's) so the replay lines
      // up with the racing line instead of trailing PLAYER_Z behind it.
      this.ghostRec.push({
        t: this.raceTime,
        lap: this.lap,
        pos: increase(this.position + PLAYER_Z, 0, this.track.length),
        x: this.playerX,
      });
    }
    this.updateGhostPlayback();

    this.audio.engineUpdate(this.speed / CFG.maxSpeed, this.boosting, dt, false);
  }

  private updateTraffic(dt: number, playerSegment: Segment): void {
    const track = this.track;
    const frameScale = dt * 60;

    for (const car of track.cars) {
      const oldSeg = findSegment(track, car.z);
      car.offset += this.carSteer(car, oldSeg, playerSegment) * frameScale;
      car.offset = clamp(car.offset, -0.92, 0.92);
      car.z = increase(car.z, car.speed * dt, track.length);
      car.percent = (car.z % CFG.segLen) / CFG.segLen;
      const newSeg = findSegment(track, car.z);
      if (oldSeg !== newSeg) {
        const i = oldSeg.cars.indexOf(car);
        if (i >= 0) oldSeg.cars.splice(i, 1);
        newSeg.cars.push(car);
      }

      // Relative distance to the player (signed, shortest way around)
      const rel = wrapDelta(car.z, this.position + PLAYER_Z, track.length);
      let collided = false;

      // Collision
      if (
        this.invulnT <= 0 &&
        Math.abs(rel) < 320 &&
        this.speed > car.speed &&
        overlap(this.playerX, CFG.playerW * 2, car.offset, 0.32, 0.85)
      ) {
        this.speed = Math.min(this.speed, car.speed * 0.82);
        const before = this.position;
        this.position = increase(car.z, -PLAYER_Z - 340, track.length);
        if (this.position < before) this.suppressLap = true;
        this.shake = 1;
        this.invulnT = 0.9;
        this.boosting = false;
        collided = true;
        this.audio.crash();
        this.setToast('CRASH', 1.1);
      }

      // Near miss: the player just passed this car with room to spare
      if (!collided && car.relPrev > 0 && rel <= 0 && this.speed > car.speed) {
        const lateral = Math.abs(this.playerX - car.offset);
        if (lateral < CFG.nearMissGap) {
          const before = this.boostMeter;
          this.boostMeter = Math.min(100, this.boostMeter + CFG.nearMissReward);
          if (before < 100) {
            this.audio.nearMiss();
            this.setToast('NEAR MISS · +BOOST', 1.4);
            this.shake = Math.max(this.shake, 0.22);
          }
        }
      }

      car.relPrev = rel;
    }
  }

  /** Traffic AI — dodge the player and each other (Jake Gordon style). */
  private carSteer(car: CarEntity, carSegment: Segment, playerSegment: Segment): number {
    const track = this.track;
    const N = track.segments.length;
    const lookahead = 20;
    const carW = 0.32;
    const distAhead = (carSegment.index - playerSegment.index + N) % N;
    if (distAhead > this.drawDist) return 0;

    for (let i = 1; i < lookahead; i++) {
      const segment = track.segments[(carSegment.index + i) % N];
      if (
        segment === playerSegment &&
        car.speed > this.speed &&
        overlap(this.playerX, CFG.playerW * 2, car.offset, carW, 1.2)
      ) {
        let dir: number;
        if (this.playerX > 0.5) dir = -1;
        else if (this.playerX < -0.5) dir = 1;
        else dir = car.offset > this.playerX ? 1 : -1;
        return (dir * (1 / i) * (car.speed - this.speed)) / CFG.maxSpeed;
      }
      for (const other of segment.cars) {
        if (other === car) continue;
        if (car.speed > other.speed && overlap(car.offset, carW, other.offset, 0.32, 1.2)) {
          let dir: number;
          if (other.offset > 0.5) dir = -1;
          else if (other.offset < -0.5) dir = 1;
          else dir = car.offset > other.offset ? 1 : -1;
          return (dir * (1 / i) * (car.speed - other.speed)) / CFG.maxSpeed;
        }
      }
    }

    if (car.offset < -0.9) return 0.006;
    if (car.offset > 0.9) return -0.006;
    return 0;
  }

  private onLapCrossed(): void {
    if (this.mode !== 'racing') return;
    if (this.lapTime < 3000) return; // ignore immediate re-triggers

    const lapMs = this.lapTime;
    const bestEver =
      this.best && this.best.lapMs.length > 0 ? Math.min(...this.best.lapMs) : null;
    const isRecordLap = bestEver !== null && lapMs < bestEver;
    const isSessionBest = this.bestLap === null || lapMs < this.bestLap;

    this.lapTimes.push(lapMs);
    this.lastLap = lapMs;
    if (isSessionBest) this.bestLap = lapMs;
    this.lapTime = 0;

    if (this.lap >= CFG.totalLaps) {
      this.finishRace();
    } else {
      this.lap++;
      if (this.lap === CFG.totalLaps) this.setToast('FINAL LAP', 1.8);
      else this.setToast(`LAP ${this.lap} / ${CFG.totalLaps}`, 1.4);
      this.audio.lap();
    }

    // Show the lap achievement last so it isn't immediately overwritten by the
    // lap-counter toast.
    if (this.mode === 'racing') {
      if (isRecordLap) this.setToast('RECORD LAP!', 1.9);
      else if (isSessionBest && this.lapTimes.length > 1) this.setToast('BEST LAP!', 1.6);
    }
  }

  private finishRace(): void {
    this.mode = 'finished';
    this.ghost = null;
    this.speed = 0;
    this.steer = 0;
    this.boosting = false;
    this.boostGlow = 0;
    this.lastInput = { steer: 0, accel: false, brake: false, boost: false };
    this.audio.finish();
    this.audio.stopEngine();

    const totalMs = this.raceTime;
    const isRecord = this.best === null || totalMs < this.best.totalMs;
    const previousBestMs = this.best?.totalMs ?? null;

    if (isRecord) {
      this.best = { totalMs, lapMs: [...this.lapTimes], ghost: this.ghostRec };
      saveBest(this.best);
    }

    const stats: FinishStats = {
      lapTimesMs: [...this.lapTimes],
      totalMs,
      bestLapMs: this.lapTimes.length ? Math.min(...this.lapTimes) : this.lapTime,
      isRecord,
      previousBestMs,
    };
    this.hooks.onFinish(stats);
  }

  private updateGhostPlayback(): void {
    const ghostDef = this.best?.ghost;
    if (!ghostDef || ghostDef.length < 2 || this.mode !== 'racing') {
      this.ghost = null;
      return;
    }
    // Once the replay has run past its last sample the ghost has finished its
    // race — park it off-screen rather than freezing it at the line.
    if (this.raceTime > ghostDef[ghostDef.length - 1].t + 400) {
      this.ghost = null;
      return;
    }
    while (this.ghostPtr < ghostDef.length - 2 && ghostDef[this.ghostPtr + 1].t <= this.raceTime) {
      this.ghostPtr++;
    }
    const a = ghostDef[this.ghostPtr];
    const b = ghostDef[Math.min(this.ghostPtr + 1, ghostDef.length - 1)];
    const span = Math.max(b.t - a.t, 1);
    const frac = clamp((this.raceTime - a.t) / span, 0, 1);
    // Don't interpolate across the lap wrap point
    const pos = b.pos < a.pos ? b.pos : lerp(a.pos, b.pos, frac);
    this.ghost = { z: pos, x: lerp(a.x, b.x, frac) };
  }

  private interpolateRoadY(): number {
    const seg = findSegment(this.track, this.position + PLAYER_Z);
    const pct = ((this.position + PLAYER_Z) % CFG.segLen) / CFG.segLen;
    return lerp(seg.p1.world.y, seg.p2.world.y, pct);
  }

  private setToast(text: string, seconds: number): void {
    this.toast = { text, until: performance.now() + seconds * 1000 };
  }

  // ————————————————————————————————————————————————————————————————
  // Render + HUD
  // ————————————————————————————————————————————————————————————————

  private render(): void {
    const state: RenderState = {
      track: this.track,
      position: this.position,
      playerX: this.playerX,
      playerY: this.playerY,
      speedPct: this.speed / CFG.maxSpeed,
      steer: this.steer,
      braking: this.mode === 'racing' && this.lastInput.brake,
      boosting: this.boosting,
      boostGlow: this.boostGlow,
      skyOffset: this.skyOffset,
      ghost: this.ghost,
      time: performance.now() / 1000,
      drawDist: this.drawDist,
      shake: this.shake,
    };
    this.renderer.frame(state);
  }

  private emitHud(): void {
    const now = performance.now();
    const finished = this.mode === 'finished';
    // Show the best lap this player has ever set, not just the current race.
    const bestEverLap =
      this.best && this.best.lapMs.length > 0 ? Math.min(...this.best.lapMs) : null;
    const bestLapMs =
      this.bestLap !== null && bestEverLap !== null
        ? Math.min(this.bestLap, bestEverLap)
        : (this.bestLap ?? bestEverLap);
    const hud: HudSnapshot = {
      mode: this.mode,
      paused: this.paused,
      speedKmh: Math.round((this.speed / CFG.maxSpeed) * CFG.displayTopKmh),
      lap: this.lap,
      totalLaps: CFG.totalLaps,
      lapTimeMs: finished ? (this.lastLap ?? this.lapTime) : this.lapTime,
      lastLapMs: this.lastLap,
      bestLapMs,
      bestRaceMs: this.best?.totalMs ?? null,
      boostPct: this.boostMeter,
      boosting: this.boosting,
      boostReady: this.boostMeter > 30,
      offroad: Math.abs(this.playerX) > 1,
      countdown: this.mode === 'countdown' && this.countdownT > 1 ? Math.ceil(this.countdownT - 1) : null,
      goFlash: this.mode === 'racing' && this.goFlash > 0,
      toast: this.toast && this.toast.until > now ? this.toast.text : null,
      musicOn: this.audio.musicOn,
      sfxOn: this.audio.sfxOn,
      fps: Math.round(this.fps),
    };
    this.hooks.onHud(hud);
  }

  /** Start audio from a user gesture (called by the UI before beginRace). */
  unlockAudio(): void {
    this.audio.ensure();
  }
}
