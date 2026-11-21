/** Shared types for the SYNTHLINE game engine. */

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  w: number;
  scale: number;
}

export interface SegmentPoint {
  world: WorldPoint;
  camera: CameraPoint;
  screen: ScreenPoint;
}

/** 0 light, 1 dark, 2 start checker, 3 finish checker. */
export type SegmentColor = 0 | 1 | 2 | 3;

export type SpriteKind =
  | 'gantry'
  | 'palm'
  | 'pylon'
  | 'billboard1'
  | 'billboard2'
  | 'billboard3'
  | 'building1'
  | 'building2'
  | 'building3'
  | 'rock';

export interface SpriteRef {
  kind: SpriteKind;
  offset: number;
}

export interface CarEntity {
  id: number;
  /** Lateral position in playerX units (-1..1 is on the road). */
  offset: number;
  /** Absolute z position on the track. */
  z: number;
  /** World-units per second. */
  speed: number;
  /** Sprite colorway index. */
  colorway: number;
  /** Fraction within the current segment, for render interpolation. */
  percent: number;
  /** Previous signed distance from the player (for near-miss detection). */
  relPrev: number;
}

export interface Segment {
  index: number;
  p1: SegmentPoint;
  p2: SegmentPoint;
  curve: number;
  color: SegmentColor;
  sprites: SpriteRef[];
  cars: CarEntity[];
  clip: number;
  looped: boolean;
  fog: number;
}

export interface Track {
  segments: Segment[];
  /** Total z length of the track. */
  length: number;
  cars: CarEntity[];
}

export type GameMode = 'menu' | 'countdown' | 'racing' | 'finished';

export interface HudSnapshot {
  mode: GameMode;
  paused: boolean;
  speedKmh: number;
  lap: number;
  totalLaps: number;
  lapTimeMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  bestRaceMs: number | null;
  boostPct: number;
  boosting: boolean;
  boostReady: boolean;
  offroad: boolean;
  /** Countdown number, or 0 while "GO!" is on screen, null otherwise. */
  countdown: number | null;
  goFlash: boolean;
  toast: string | null;
  musicOn: boolean;
  sfxOn: boolean;
  fps: number;
}

export interface GhostSample {
  /** Milliseconds since race start (at GO). */
  t: number;
  lap: number;
  pos: number;
  x: number;
}

export interface BestRecord {
  totalMs: number;
  lapMs: number[];
  ghost: GhostSample[];
}

export interface FinishStats {
  lapTimesMs: number[];
  totalMs: number;
  bestLapMs: number;
  isRecord: boolean;
  previousBestMs: number | null;
}
