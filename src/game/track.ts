/**
 * Track construction: road geometry (curves + hills), scenery placement and
 * traffic spawning. Built from a fixed seed so every player sees the same
 * track — required for ghost replays to line up.
 */

import { CFG } from './config';
import type { CarEntity, Segment, SegmentColor, SpriteKind, Track } from './types';
import { easeIn, easeInOut, easeOut, mulberry32, pick } from './util';

const LEN = { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 } as const;
const HILL = { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 } as const;
const CURVE = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 } as const;

let segments: Segment[] = [];

function lastY(): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
}

function addSegment(curve: number, y: number): void {
  const n = segments.length;
  segments.push({
    index: n,
    p1: {
      world: { x: 0, y: lastY(), z: n * CFG.segLen },
      camera: { x: 0, y: 0, z: 0 },
      screen: { x: 0, y: 0, w: 0, scale: 0 },
    },
    p2: {
      world: { x: 0, y, z: (n + 1) * CFG.segLen },
      camera: { x: 0, y: 0, z: 0 },
      screen: { x: 0, y: 0, w: 0, scale: 0 },
    },
    curve,
    color: (Math.floor(n / CFG.rumbleLen) % 2) as SegmentColor,
    sprites: [],
    cars: [],
    clip: 0,
    looped: false,
    fog: 0,
  });
}

function addRoad(enter: number, hold: number, leave: number, curve: number, y: number): void {
  const startY = lastY();
  const endY = startY + y * CFG.segLen;
  const total = enter + hold + leave;
  for (let n = 0; n < enter; n++) {
    addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  }
  for (let n = 0; n < hold; n++) {
    addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  }
  for (let n = 0; n < leave; n++) {
    addSegment(easeOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }
}

function addStraight(num: number = LEN.MEDIUM): void {
  addRoad(num, num, num, 0, 0);
}

function addHill(num: number = LEN.MEDIUM, height: number = HILL.MEDIUM): void {
  addRoad(num, num, num, 0, height);
}

function addCurve(num: number = LEN.MEDIUM, curve: number = CURVE.MEDIUM, height: number = HILL.NONE): void {
  addRoad(num, num, num, curve, height);
}

function addLowRollingHills(num: number = LEN.SHORT, height: number = HILL.LOW): void {
  addRoad(num, num, num, 0, height / 2);
  addRoad(num, num, num, 0, -height);
  addRoad(num, num, num, CURVE.EASY, height);
  addRoad(num, num, num, 0, 0);
  addRoad(num, num, num, -CURVE.EASY, height / 2);
  addRoad(num, num, num, 0, 0);
}

function addSCurves(): void {
  addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, -CURVE.EASY, HILL.NONE);
  addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, CURVE.MEDIUM, HILL.MEDIUM);
  addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, CURVE.EASY, -HILL.LOW);
  addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, -CURVE.EASY, HILL.NONE);
}

function addDownhillToEnd(num = 200): void {
  addRoad(num, num, num, -CURVE.EASY, -lastY() / CFG.segLen);
}

function addSprite(n: number, kind: SpriteKind, offset: number): void {
  if (n >= 0 && n < segments.length) {
    segments[n].sprites.push({ kind, offset });
  }
}

/** Sprites are anchored to a side; negative offsets use the mirrored anchor. */
function side(kind: SpriteKind, n: number, offset: number): void {
  addSprite(n, kind, offset);
}

// ---------------------------------------------------------------------------

export function buildTrack(): Track {
  segments = [];
  const rng = mulberry32(20771);

  // — The circuit ————————————————————————————————————————————————
  addStraight(LEN.SHORT); // start / finish straight
  addSCurves(); // flowing warm-up esses
  addCurve(LEN.MEDIUM, CURVE.HARD, HILL.LOW); // hard right, rising
  addHill(LEN.MEDIUM, HILL.HIGH); // the big climb
  addCurve(LEN.MEDIUM, -CURVE.HARD, -HILL.MEDIUM); // plunging hard left
  addStraight(LEN.SHORT); // breather
  addLowRollingHills(LEN.SHORT, HILL.LOW); // rolling neon plains
  addCurve(LEN.LONG, CURVE.HARD, HILL.NONE); // signature long sweeper
  addHill(LEN.MEDIUM, -HILL.HIGH); // downhill plunge
  addStraight(LEN.MEDIUM); // flat-out section
  addCurve(LEN.MEDIUM, CURVE.MEDIUM, HILL.LOW);
  addDownhillToEnd(150); // level out and return to the line
  // ————————————————————————————————————————————————————————————————

  const N = segments.length;

  // Start / finish paint
  for (let n = 2; n < 6; n++) segments[n].color = 2;

  // Scenery ————————————————————————————————————————————————
  // Start gantry right on the line
  addSprite(6, 'gantry', 0);

  // Billboards, alternating sides
  const billboards: SpriteKind[] = ['billboard1', 'billboard2', 'billboard3'];
  let bb = 0;
  for (let n = 140; n < N - 60; n += 190 + Math.floor(rng() * 70)) {
    const s = rng() < 0.5 ? -1 : 1;
    side(billboards[bb++ % billboards.length], n, s * 1.55);
  }

  // Palms — clusters along the whole track
  for (let n = 12; n < N - 10; n += 9 + Math.floor(rng() * 14)) {
    const cluster = 1 + Math.floor(rng() * 3);
    for (let c = 0; c < cluster; c++) {
      const s = rng() < 0.5 ? -1 : 1;
      side('palm', n + c, s * (1.25 + rng() * 1.9));
    }
  }

  // Neon buildings — the distant skyline
  const buildings: SpriteKind[] = ['building1', 'building2', 'building3'];
  for (let n = 20; n < N - 20; n += 26 + Math.floor(rng() * 22)) {
    const s = rng() < 0.5 ? -1 : 1;
    side(pick(rng, buildings), n, s * (2.6 + rng() * 2.4));
  }

  // Pylons marking the outside of every hard curve
  for (let n = 0; n < N; n++) {
    const curve = segments[n].curve;
    if (Math.abs(curve) >= 3.2 && n % 7 === 0) {
      side('pylon', n, curve > 0 ? -1.18 : 1.18);
    }
  }

  // Scattered rocks
  for (let n = 30; n < N - 30; n += 37 + Math.floor(rng() * 40)) {
    const s = rng() < 0.5 ? -1 : 1;
    side('rock', n, s * (1.6 + rng() * 2.6));
  }

  const track: Track = {
    segments,
    length: N * CFG.segLen,
    cars: [],
  };
  resetTraffic(track);
  return track;
}

export function findSegment(track: Track, z: number): Segment {
  const idx = Math.floor(z / CFG.segLen) % track.segments.length;
  return track.segments[idx];
}

/** Spawn traffic spread over the track, keeping the start straight clear. */
export function resetTraffic(track: Track): void {
  const rng = mulberry32(Date.now() % 2147483647);
  // Detach any cars currently registered on segments
  for (const seg of track.segments) seg.cars.length = 0;
  track.cars.length = 0;

  const lanes = [-0.68, 0, 0.68];
  const startSafe = 40 * CFG.segLen;
  for (let i = 0; i < CFG.trafficCount; i++) {
    const z =
      startSafe + Math.floor(rng() * (track.length - startSafe * 2)) + (rng() * CFG.segLen);
    const car: CarEntity = {
      id: i,
      offset: pick(rng, lanes) + (rng() - 0.5) * 0.16,
      z,
      speed: CFG.maxSpeed * (CFG.trafficMinSpeed + rng() * (CFG.trafficMaxSpeed - CFG.trafficMinSpeed)),
      colorway: Math.floor(rng() * 5),
      percent: 0,
      relPrev: 1,
    };
    track.cars.push(car);
    findSegment(track, car.z).cars.push(car);
  }
}

/** Remove all traffic (used for the menu attract mode). */
export function clearTraffic(track: Track): void {
  for (const seg of track.segments) seg.cars.length = 0;
  track.cars.length = 0;
}
