/**
 * Procedural sprite generation — every visual in SYNTHLINE is drawn in code,
 * so the game ships with zero binary assets.
 *
 * Sprites are rendered once into offscreen canvases at a generous resolution
 * and scaled down at draw time (glow is baked in, which keeps the per-frame
 * render loop cheap on mobile).
 */

import { PAL, TRAFFIC_COLORS } from './config';
import { mulberry32, clamp } from './util';
import type { SpriteKind } from './types';

export interface SpriteDef {
  img: HTMLCanvasElement;
  /** Width in world units. */
  worldW: number;
  /** Horizontal anchor: -1 = right edge at offset point, 0 = left edge, -0.5 = centered. */
  anchor: number;
}

export interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
}

export interface MountainLayer {
  img: HTMLCanvasElement;
  /** Parallax multiplier applied to the global sky offset. */
  speed: number;
  /** Vertical size factor relative to canvas height. */
  heightFactor: number;
}

function mk(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(w));
  canvas.height = Math.max(2, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function glow(ctx: CanvasRenderingContext2D, color: string, blur: number, fn: () => void): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Cars (rear view)
// ---------------------------------------------------------------------------

interface CarPaint {
  body: string;
  roof: string;
  taillights: 'off' | 'on' | 'brake';
  spoiler: boolean;
  stripe?: string;
  /** Soft neon pool under the car. */
  underglow?: string;
}

function paintCar(ctx: CanvasRenderingContext2D, w: number, h: number, paint: CarPaint): void {
  const padX = w * 0.03;
  const bodyW = w - padX * 2;
  const bodyTop = h * 0.3;
  const wheelH = h * 0.26;
  const wheelW = bodyW * 0.14;
  const lit = paint.taillights !== 'off';
  const braking = paint.taillights === 'brake';

  // Ground shadow
  ctx.save();
  ctx.fillStyle = '#000008';
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.ellipse(w / 2, h - h * 0.025, w * 0.46, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Neon underglow
  if (paint.underglow) {
    const gl = ctx.createRadialGradient(w / 2, h - h * 0.04, 4, w / 2, h - h * 0.04, w * 0.5);
    gl.addColorStop(0, paint.underglow);
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.ellipse(w / 2, h - h * 0.04, w * 0.48, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Wheels
  ctx.fillStyle = '#05040c';
  rrect(ctx, padX - wheelW * 0.22, h - wheelH * 1.12, wheelW, wheelH, wheelW * 0.34);
  ctx.fill();
  rrect(ctx, w - padX - wheelW * 0.78, h - wheelH * 1.12, wheelW, wheelH, wheelW * 0.34);
  ctx.fill();
  ctx.fillStyle = '#232038';
  ctx.fillRect(padX + wheelW * 0.12, h - wheelH * 0.72, wheelW * 0.42, wheelH * 0.16);
  ctx.fillRect(w - padX - wheelW * 0.54, h - wheelH * 0.72, wheelW * 0.42, wheelH * 0.16);

  // Cabin (body color shell + inset rear window)
  const cabinW = bodyW * 0.64;
  const cabinX = w / 2 - cabinW / 2;
  const cabinTop = h * 0.015;
  const cabinH = bodyTop - cabinTop + h * 0.1;
  const shell = ctx.createLinearGradient(0, cabinTop, 0, bodyTop + h * 0.1);
  shell.addColorStop(0, paint.body);
  shell.addColorStop(1, paint.roof);
  ctx.fillStyle = shell;
  rrect(ctx, cabinX, cabinTop, cabinW, cabinH, w * 0.055);
  ctx.fill();

  const winPad = w * 0.05;
  const glass = ctx.createLinearGradient(0, cabinTop + h * 0.02, 0, cabinTop + cabinH * 0.7);
  glass.addColorStop(0, '#4a4278');
  glass.addColorStop(0.5, '#221c3d');
  glass.addColorStop(1, '#0e0a1e');
  ctx.fillStyle = glass;
  rrect(ctx, cabinX + winPad, cabinTop + h * 0.028, cabinW - winPad * 2, cabinH - h * 0.085, w * 0.035);
  ctx.fill();
  // Window gloss
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#bfe9ff';
  rrect(ctx, cabinX + cabinW * 0.22, cabinTop + h * 0.04, cabinW * 0.56, h * 0.03, 3);
  ctx.fill();
  ctx.restore();

  // Body
  const bodyGrad = ctx.createLinearGradient(0, bodyTop, 0, h);
  bodyGrad.addColorStop(0, paint.roof);
  bodyGrad.addColorStop(0.35, paint.body);
  bodyGrad.addColorStop(1, paint.roof);
  ctx.fillStyle = bodyGrad;
  rrect(ctx, padX, bodyTop, bodyW, h - bodyTop - h * 0.035, w * 0.055);
  ctx.fill();

  // Rim light — the synthwave edge
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = Math.max(1.5, w * 0.006);
  rrect(ctx, padX, bodyTop, bodyW, h - bodyTop - h * 0.035, w * 0.055);
  ctx.stroke();

  // Spoiler
  if (paint.spoiler) {
    ctx.fillStyle = '#0c0919';
    ctx.fillRect(w * 0.36, bodyTop - h * 0.032, w * 0.03, h * 0.038);
    ctx.fillRect(w * 0.61, bodyTop - h * 0.032, w * 0.03, h * 0.038);
    const spoilerGrad = ctx.createLinearGradient(0, bodyTop - h * 0.055, 0, bodyTop - h * 0.005);
    spoilerGrad.addColorStop(0, '#241a44');
    spoilerGrad.addColorStop(1, '#0e0a1c');
    ctx.fillStyle = spoilerGrad;
    rrect(ctx, w * 0.29, bodyTop - h * 0.06, w * 0.42, h * 0.042, 4);
    ctx.fill();
    glow(ctx, PAL.neonCyan, 8, () => {
      ctx.fillStyle = 'rgba(8,247,254,0.45)';
      ctx.fillRect(w * 0.31, bodyTop - h * 0.06, w * 0.38, Math.max(1, h * 0.006));
    });
  }

  // Tail light bar
  const tlY = bodyTop + h * 0.085;
  const tlH = h * 0.075;
  const tlW = bodyW * 0.255;
  glow(ctx, PAL.taillight, braking ? 34 : 14, () => {
    ctx.fillStyle = braking ? '#ff3d5c' : '#b81736';
    rrect(ctx, padX + bodyW * 0.045, tlY, tlW, tlH, tlH * 0.45);
    ctx.fill();
    rrect(ctx, w - padX - bodyW * 0.045 - tlW, tlY, tlW, tlH, tlH * 0.45);
    ctx.fill();
  });
  if (lit) {
    ctx.save();
    ctx.globalAlpha = braking ? 0.95 : 0.6;
    ctx.fillStyle = braking ? '#ffa3b2' : '#ff6079';
    rrect(ctx, padX + bodyW * 0.075, tlY + tlH * 0.22, tlW * 0.72, tlH * 0.4, 2);
    ctx.fill();
    rrect(ctx, w - padX - bodyW * 0.075 - tlW * 0.72, tlY + tlH * 0.22, tlW * 0.72, tlH * 0.4, 2);
    ctx.fill();
    ctx.restore();
    // connecting strip
    ctx.save();
    ctx.globalAlpha = braking ? 0.5 : 0.25;
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(padX + bodyW * 0.3, tlY + tlH * 0.42, bodyW * 0.4, tlH * 0.14);
    ctx.restore();
  }

  // Bumper
  ctx.fillStyle = 'rgba(9,7,18,0.92)';
  rrect(ctx, padX + bodyW * 0.02, h - h * 0.165, bodyW * 0.96, h * 0.12, w * 0.03);
  ctx.fill();
  ctx.fillStyle = 'rgba(90,80,130,0.35)';
  ctx.fillRect(w * 0.44, h - h * 0.115, w * 0.12, h * 0.028);

  // Center stripe
  if (paint.stripe) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = paint.stripe;
    ctx.fillRect(w / 2 - w * 0.014, bodyTop + h * 0.2, w * 0.028, h * 0.34);
    ctx.fillRect(w / 2 - w * 0.014, bodyTop + h * 0.62, w * 0.028, h * 0.1);
    ctx.restore();
  }
}

function makeTrafficSprite(colorway: number): HTMLCanvasElement {
  const [body, roof] = TRAFFIC_COLORS[colorway % TRAFFIC_COLORS.length];
  const { canvas, ctx } = mk(460, 300);
  paintCar(ctx, 460, 300, {
    body,
    roof,
    taillights: 'on',
    spoiler: colorway % 2 === 0,
    underglow: 'rgba(255,41,117,0.16)',
  });
  return canvas;
}

function makeGhostSprite(): HTMLCanvasElement {
  const { canvas, ctx } = mk(460, 300);
  ctx.globalAlpha = 0.42;
  paintCar(ctx, 460, 300, {
    body: '#7fe9ff',
    roof: '#2e7f9e',
    taillights: 'on',
    spoiler: true,
    stripe: '#dffcff',
    underglow: 'rgba(8,247,254,0.4)',
  });
  return canvas;
}

// ---------------------------------------------------------------------------
// Player car — drawn procedurally every frame so lights, flames and lean are live
// ---------------------------------------------------------------------------

export function drawPlayerCar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  w: number,
  steer: number,
  braking: boolean,
  boosting: boolean,
  t: number,
): void {
  const h = w * 0.62;
  ctx.save();
  ctx.translate(cx, groundY);
  ctx.rotate(clamp(steer, -1, 1) * 0.055);

  // Boost flames behind the car first (drawn below the body, flickering)
  if (boosting) {
    const flicker = 0.7 + 0.3 * Math.sin(t * 43) * Math.cos(t * 31);
    for (const side of [-1, 1]) {
      const fx = side * w * 0.17;
      const fy = -h * 0.04;
      const len = h * (0.55 + 0.5 * flicker);
      const grad = ctx.createLinearGradient(fx, fy, fx, fy + len);
      grad.addColorStop(0, 'rgba(8,247,254,0.95)');
      grad.addColorStop(0.55, 'rgba(255,41,117,0.75)');
      grad.addColorStop(1, 'rgba(255,41,117,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(fx - w * 0.045, fy);
      ctx.lineTo(fx + w * 0.045, fy);
      ctx.lineTo(fx, fy + len);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.translate(-w / 2, -h);
  paintCar(ctx, w, h, {
    body: PAL.playerBody1,
    roof: PAL.playerBody2,
    taillights: braking ? 'brake' : 'on',
    spoiler: true,
    stripe: PAL.playerStripe,
    underglow: 'rgba(8,247,254,0.5)',
  });

  // Exhaust pipes
  ctx.fillStyle = '#4a4560';
  ctx.fillRect(w * 0.33, h - h * 0.075, w * 0.06, h * 0.024);
  ctx.fillRect(w * 0.61, h - h * 0.075, w * 0.06, h * 0.024);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

function makePalm(rng: () => number): HTMLCanvasElement {
  const W = 460;
  const H = 700;
  const { canvas, ctx } = mk(W, H);
  const baseX = W * 0.5;
  const lean = (rng() - 0.5) * 90;
  const topX = baseX + lean;
  const topY = 110;

  // Trunk
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#241238';
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(baseX, H);
  ctx.quadraticCurveTo(baseX + lean * 0.25, 400, topX, topY + 46);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,41,117,0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(baseX + 13, H);
  ctx.quadraticCurveTo(baseX + lean * 0.25 + 13, 400, topX + 12, topY + 52);
  ctx.stroke();

  // Fronds — fat tapered leaves
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const angle = (i / fronds) * Math.PI * 1.25 - Math.PI * 0.12 + (rng() - 0.5) * 0.22;
    const len = 190 + rng() * 90;
    const endX = topX + Math.cos(angle) * len;
    const endY = topY + Math.sin(angle) * len * 0.62;
    const midX = (topX + endX) / 2;
    const midY = topY - 60 - rng() * 40;
    const thickness = 30 + rng() * 22;
    ctx.fillStyle = i % 3 === 0 ? '#2d1749' : '#231039';
    ctx.beginPath();
    ctx.moveTo(topX, topY + 8);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.quadraticCurveTo(midX, midY + thickness, topX, topY + 26);
    ctx.closePath();
    ctx.fill();
    if (i < 4) {
      ctx.strokeStyle = 'rgba(8,247,254,0.3)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(topX, topY + 10);
      ctx.quadraticCurveTo(midX, midY + 4, endX, endY);
      ctx.stroke();
    }
  }
  // Coconuts
  ctx.fillStyle = '#170a28';
  for (const [dx, dy] of [
    [-10, 16],
    [8, 20],
    [0, 30],
  ]) {
    ctx.beginPath();
    ctx.arc(topX + dx, topY + dy, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makePylon(): HTMLCanvasElement {
  const { canvas, ctx } = mk(150, 580);
  const grad = ctx.createLinearGradient(45, 0, 105, 0);
  grad.addColorStop(0, '#1d1136');
  grad.addColorStop(0.6, '#241644');
  grad.addColorStop(1, '#140b28');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(48, 580);
  ctx.lineTo(58, 40);
  ctx.lineTo(92, 40);
  ctx.lineTo(102, 580);
  ctx.closePath();
  ctx.fill();

  glow(ctx, PAL.neonCyan, 12, () => {
    ctx.strokeStyle = PAL.neonCyan;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(58, 560);
    ctx.lineTo(64, 60);
    ctx.stroke();
  });
  // Notches
  ctx.fillStyle = 'rgba(8,247,254,0.35)';
  for (let y = 120; y < 520; y += 88) {
    ctx.fillRect(64, y, 24, 5);
  }
  // Beacon
  glow(ctx, PAL.neonMagenta, 22, () => {
    ctx.fillStyle = PAL.neonMagenta;
    ctx.beginPath();
    ctx.arc(75, 38, 10, 0, Math.PI * 2);
    ctx.fill();
  });
  return canvas;
}

function makeBillboard(text: string, accent: string): HTMLCanvasElement {
  const { canvas, ctx } = mk(560, 500);
  // Legs
  ctx.fillStyle = '#180e2e';
  ctx.fillRect(90, 260, 26, 240);
  ctx.fillRect(444, 260, 26, 240);

  // Panel
  glow(ctx, accent, 18, () => {
    ctx.fillStyle = '#1c1035';
    rrect(ctx, 40, 40, 480, 240, 14);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    rrect(ctx, 40, 40, 480, 240, 14);
    ctx.stroke();
  });
  // Inner panel sheen
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  rrect(ctx, 60, 56, 440, 100, 10);
  ctx.fill();

  ctx.font = '700 54px Orbitron, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  glow(ctx, accent, 22, () => {
    ctx.fillStyle = '#f3effc';
    ctx.fillText(text, 280, 160);
  });
  return canvas;
}

function makeBuilding(rng: () => number, windows: number, height: number): HTMLCanvasElement {
  const W = 340;
  const { canvas, ctx } = mk(W, height);
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#14102c');
  grad.addColorStop(1, '#0b0719');
  ctx.fillStyle = grad;
  ctx.fillRect(20, 0, W - 40, height);

  // Edges
  ctx.fillStyle = 'rgba(8,247,254,0.22)';
  ctx.fillRect(20, 0, 3, height);
  ctx.fillStyle = 'rgba(255,41,117,0.28)';
  ctx.fillRect(W - 23, 0, 3, height);
  glow(ctx, PAL.neonCyan, 14, () => {
    ctx.fillStyle = 'rgba(8,247,254,0.8)';
    ctx.fillRect(20, 0, W - 40, 4);
  });

  // Windows
  const cols = 4;
  const rows = windows;
  const padX = 34;
  const padTop = 26;
  const cellW = (W - padX * 2) / cols;
  const cellH = (height - padTop - 20) / rows;
  const colors = ['#08f7fe', '#ff2975', '#ffd166', '#7ef0ff'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < 0.42) {
        ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
        ctx.globalAlpha = 0.28 + rng() * 0.45;
        ctx.fillRect(padX + c * cellW + cellW * 0.22, padTop + r * cellH + cellH * 0.2, cellW * 0.5, cellH * 0.42);
        ctx.globalAlpha = 1;
      }
    }
  }
  // Antenna
  if (rng() < 0.6) {
    const ax = W / 2 + (rng() - 0.5) * 120;
    ctx.strokeStyle = '#3a2f60';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, -26);
    ctx.stroke();
    ctx.fillStyle = '#ff2975';
    ctx.beginPath();
    ctx.arc(ax, -30, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makeRock(rng: () => number): HTMLCanvasElement {
  const { canvas, ctx } = mk(280, 170);
  const pts = 7;
  ctx.fillStyle = '#1d1136';
  ctx.beginPath();
  ctx.moveTo(10, 165);
  for (let i = 0; i < pts; i++) {
    const x = 10 + (i / (pts - 1)) * 260;
    const y = 160 - Math.sin((i / (pts - 1)) * Math.PI) * (70 + rng() * 55);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(270, 165);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,140,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  return canvas;
}

function makeGantry(): HTMLCanvasElement {
  const W = 1440;
  const H = 430;
  const { canvas, ctx } = mk(W, H);

  // Pillars
  for (const x of [26, W - 118]) {
    const grad = ctx.createLinearGradient(x, 0, x + 92, 0);
    grad.addColorStop(0, '#1d1136');
    grad.addColorStop(1, '#120a26');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 60, 92, H - 60);
    glow(ctx, PAL.neonCyan, 10, () => {
      ctx.fillStyle = 'rgba(8,247,254,0.75)';
      ctx.fillRect(x, 60, 4, H - 60);
    });
  }

  // Beam
  glow(ctx, PAL.neonMagenta, 16, () => {
    ctx.fillStyle = '#1c1035';
    rrect(ctx, 0, 36, W, 120, 10);
    ctx.fill();
    ctx.strokeStyle = PAL.neonMagenta;
    ctx.lineWidth = 5;
    rrect(ctx, 0, 36, W, 120, 10);
    ctx.stroke();
  });

  // Checker strip under the beam
  const sq = 20;
  for (let i = 0; i < Math.floor(W / sq); i++) {
    ctx.fillStyle = i % 2 === 0 ? '#e9e5f5' : '#23203f';
    ctx.fillRect(i * sq, 156 - sq, sq, sq);
  }

  // Text
  ctx.font = '900 66px Orbitron, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  glow(ctx, PAL.neonCyan, 26, () => {
    ctx.fillStyle = '#f3effc';
    ctx.fillText('SYNTHLINE', W / 2, 96);
  });
  return canvas;
}

// ---------------------------------------------------------------------------
// Sky: sun, stars, mountains
// ---------------------------------------------------------------------------

export function makeSun(radius: number): HTMLCanvasElement {
  const pad = radius * 0.8;
  const { canvas, ctx } = mk(radius * 2 + pad * 2, radius * 2 + pad * 2);
  const cx = radius + pad;
  const cy = radius + pad;

  // Outer glow
  const glowGrad = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 1.9);
  glowGrad.addColorStop(0, 'rgba(255,120,150,0.35)');
  glowGrad.addColorStop(1, 'rgba(255,41,117,0)');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
  ctx.fill();

  // Body
  const body = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
  body.addColorStop(0, PAL.sunYellow);
  body.addColorStop(0.55, '#ff5e8a');
  body.addColorStop(1, PAL.sunPink);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Horizontal slots, thicker toward the bottom
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'destination-out';
  const slots = [
    { y: 0.2, h: 0.035 },
    { y: 0.34, h: 0.05 },
    { y: 0.5, h: 0.07 },
    { y: 0.64, h: 0.095 },
    { y: 0.78, h: 0.12 },
    { y: 0.9, h: 0.15 },
  ];
  for (const s of slots) {
    ctx.fillRect(cx - radius - 4, cy - radius + s.y * radius * 2, radius * 2 + 8, s.h * radius * 2);
  }
  ctx.restore();
  return canvas;
}

export function makeStars(count: number): Star[] {
  const rng = mulberry32(777);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng(),
      y: rng() * rng() * 0.62,
      r: 0.6 + rng() * 1.5,
      phase: rng() * Math.PI * 2,
    });
  }
  return stars;
}

export function makeMountainLayers(): MountainLayer[] {
  const layers: MountainLayer[] = [];
  const configs = [
    { seed: 42, amp: 0.55, fill: PAL.mountainsFar, edge: PAL.mountainsFarEdge, edgeW: 2, speed: 0.35, heightFactor: 0.11 },
    { seed: 99, amp: 1.0, fill: PAL.mountainsNear, edge: PAL.mountainsNearEdge, edgeW: 2.4, speed: 0.7, heightFactor: 0.16 },
  ];
  for (const cfg of configs) {
    const LW = 2048;
    const LH = 320;
    const { canvas, ctx } = mk(LW, LH);
    const points: number[] = [];
    const n = 56;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // Layered sines → organic ridges that loop seamlessly
      const y =
        0.5 +
        0.32 * Math.sin(t * Math.PI * 2 * (2 + (cfg.seed % 3))) * 0.5 +
        0.26 * Math.sin(t * Math.PI * 2 * 5 + cfg.seed) +
        0.16 * Math.sin(t * Math.PI * 2 * 11 + cfg.seed * 2.7);
      points.push(LH - (0.32 + cfg.amp * 0.36 * (y + 0.55)) * LH);
    }
    points[n] = points[0];
    ctx.fillStyle = cfg.fill;
    ctx.beginPath();
    ctx.moveTo(0, LH);
    for (let i = 0; i <= n; i++) ctx.lineTo((i / n) * LW, points[i]);
    ctx.lineTo(LW, LH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = cfg.edge;
    ctx.lineWidth = cfg.edgeW;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * LW;
      if (i === 0) ctx.moveTo(x, points[i]);
      else ctx.lineTo(x, points[i]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    layers.push({
      img: canvas,
      speed: cfg.speed,
      heightFactor: cfg.heightFactor,
    });
  }
  return layers;
}

// ---------------------------------------------------------------------------
// World sprite bundle
// ---------------------------------------------------------------------------

export interface SpriteBundle {
  world: Record<SpriteKind, SpriteDef>;
  traffic: HTMLCanvasElement[];
  ghost: HTMLCanvasElement;
}

export function buildSprites(): SpriteBundle {
  const rng = mulberry32(20260101);
  const world: Record<SpriteKind, SpriteDef> = {
    gantry: { img: makeGantry(), worldW: 5300, anchor: -0.5 },
    palm: { img: makePalm(rng), worldW: 1650, anchor: 0 },
    pylon: { img: makePylon(), worldW: 420, anchor: -0.5 },
    billboard1: { img: makeBillboard('SYNTHLINE', PAL.neonCyan), worldW: 1650, anchor: 0 },
    billboard2: { img: makeBillboard('NEON CITY', PAL.neonMagenta), worldW: 1650, anchor: 0 },
    billboard3: { img: makeBillboard('NIGHT FM 88.8', PAL.neonCyan), worldW: 1650, anchor: 0 },
    building1: { img: makeBuilding(rng, 8, 640), worldW: 1750, anchor: 0 },
    building2: { img: makeBuilding(rng, 12, 880), worldW: 1750, anchor: 0 },
    building3: { img: makeBuilding(rng, 16, 1120), worldW: 1750, anchor: 0 },
    rock: { img: makeRock(rng), worldW: 900, anchor: 0 },
  };
  const traffic = TRAFFIC_COLORS.map((_, i) => makeTrafficSprite(i));
  return { world, traffic, ghost: makeGhostSprite() };
}
