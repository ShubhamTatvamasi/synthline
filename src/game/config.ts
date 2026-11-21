/**
 * SYNTHLINE — central tuning constants and palette.
 *
 * World units: the road spans -roadWidth..+roadWidth on x, z grows forward,
 * y is elevation. The classic pseudo-3D projection math (segments, curves,
 * hills) follows the approach popularized by Jake Gordon's javascript-racer.
 */

export const CFG = {
  /** Segment length in world units (z-resolution of the road). */
  segLen: 200,
  /** Segments per rumble stripe. */
  rumbleLen: 3,
  /** Number of lanes. */
  lanes: 3,
  /** Half of the road's width (spans -roadWidth..+roadWidth). */
  roadWidth: 2000,

  /** Horizontal field of view in degrees. */
  fov: 100,
  /** Camera height above the road surface. */
  camHeight: 1050,

  /** Segment draw distance (adapted at runtime between min and max). */
  drawDist: 190,
  drawDistMin: 90,
  drawDistMax: 220,

  /** Exponential fog density. */
  fogDensity: 4.5,

  /** Race format. */
  totalLaps: 3,

  /** Speeds are world-units per second. */
  maxSpeed: 12000,
  boostMaxSpeed: 15100,
  accel: 2400,
  brakeDecel: -12000,
  naturalDecel: -2400,
  offroadDecel: -6500,
  offroadLimit: 3000,
  centrifugal: 0.29,

  /** Boost mechanic. */
  boostDrainPerSec: 34,
  boostTricklePerSec: 1.6,
  nearMissReward: 28,
  boostStart: 20,

  /** Traffic. */
  trafficCount: 30,
  trafficMinSpeed: 0.26,
  trafficMaxSpeed: 0.5,

  /** Display speed at maxSpeed (without boost). */
  displayTopKmh: 316,

  /** Player half-width in playerX units (road half-width = 1.0). */
  playerW: 0.32,
  /** Lateral distance (in playerX units) still counted as a collision. */
  carCollisionGap: 0.4,
  /** Lateral distance between collision and this counts as a near miss. */
  nearMissGap: 0.66,
} as const;

export const CAM_DEPTH = 1 / Math.tan(((CFG.fov / 2) * Math.PI) / 180);
/** Distance of the player car in front of the camera. */
export const PLAYER_Z = CFG.camHeight * CAM_DEPTH;

/**
 * Synthwave palette. Everything neon.
 */
export const PAL = {
  skyTop: '#05010f',
  skyMid: '#1c0638',
  skyLow: '#471067',
  fog: '#1d0b38',

  sunYellow: '#ffd319',
  sunPink: '#ff2975',

  mountainsFar: '#170a2f',
  mountainsFarEdge: '#5a2470',
  mountainsNear: '#0e0620',
  mountainsNearEdge: '#ff2975',

  horizonGlow: '#08f7fe',

  roadLight: '#2f2c50',
  roadDark: '#292649',
  plainLight: '#191136',
  plainDark: '#140f2c',
  rumbleLight: '#ff2975',
  rumbleDark: '#efeaf6',
  lane: '#08f7fe',
  startLight: '#d9d9ea',
  startDark: '#23203f',

  playerBody1: '#ff4d6d',
  playerBody2: '#b9134a',
  playerGlass: '#141026',
  playerStripe: '#08f7fe',
  taillight: '#ff1744',
  headlightGlow: '#ffd166',

  uiText: '#efeaf6',
  uiDim: '#9c8fc4',
  neonCyan: '#08f7fe',
  neonMagenta: '#ff2975',
} as const;

/** Traffic car colorways (body, roof). */
export const TRAFFIC_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['#3a86ff', '#275dbb'],
  ['#ffbe0b', '#c78f00'],
  ['#8338ec', '#5b1fa8'],
  ['#06d6a0', '#00997a'],
  ['#f8f7ff', '#b9b4d6'],
] as const;
