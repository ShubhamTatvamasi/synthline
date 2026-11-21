/**
 * The pseudo-3D world renderer.
 *
 * Classic "outrun style" segment projection: the road is a list of segments
 * with curve + elevation; each frame we project them from the camera, draw
 * near-to-far with hill clipping, then draw sprites, traffic, the ghost and
 * the player far-to-near. Approach popularized by Jake Gordon's
 * javascript-racer, reworked for SYNTHLINE's synthwave look.
 */

import { CFG, PAL, PLAYER_Z } from './config';
import {
  buildSprites,
  drawPlayerCar,
  makeMountainLayers,
  makeStars,
  makeSun,
  type MountainLayer,
  type SpriteBundle,
  type Star,
} from './sprites';
import type { Segment, Track } from './types';
import { clamp, exponentialFog, interpolate, percentRemaining } from './util';

/** World-space width of traffic / ghost / player cars. */
const CAR_WORLD_W = 640;

export interface RenderState {
  track: Track;
  position: number;
  playerX: number;
  playerY: number;
  speedPct: number;
  steer: number;
  braking: boolean;
  boosting: boolean;
  /** Eased 0..1 boost visual intensity. */
  boostGlow: number;
  skyOffset: number;
  ghost: { z: number; x: number } | null;
  /** Seconds, for animations. */
  time: number;
  drawDist: number;
  shake: number;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private reduceMotion = false;

  private sprites: SpriteBundle | null = null;
  private mountains: MountainLayer[] = [];
  private stars: Star[] = [];
  private sun: HTMLCanvasElement | null = null;
  private sunR = 0;
  private skyGrad: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.reduceMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /** Build all procedural assets. Call once, after fonts are ready. */
  async init(): Promise<void> {
    // Billboard text uses Orbitron — wait briefly for the webfont.
    try {
      if (document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((res) => window.setTimeout(res, 1500)),
        ]);
      }
    } catch {
      /* fall back to system font */
    }
    this.sprites = buildSprites();
    this.mountains = makeMountainLayers();
    this.stars = makeStars(110);
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(320, Math.floor(rect.width));
    this.H = Math.max(240, Math.floor(rect.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const skyGrad = this.ctx.createLinearGradient(0, 0, 0, this.H * 0.62);
    skyGrad.addColorStop(0, PAL.skyTop);
    skyGrad.addColorStop(0.55, PAL.skyMid);
    skyGrad.addColorStop(1, PAL.skyLow);
    this.skyGrad = skyGrad;

    this.sunR = clamp(Math.min(this.W, this.H) * 0.2, 56, 240);
    this.sun = makeSun(this.sunR);
  }

  // -------------------------------------------------------------------------

  frame(s: RenderState): void {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    if (!this.sprites || !this.sun) return;

    ctx.save();
    const shake = this.reduceMotion ? s.shake * 0.2 : s.shake;
    if (shake > 0.01) {
      ctx.translate(
        (Math.random() - 0.5) * shake * 16,
        (Math.random() - 0.5) * shake * 12,
      );
    }

    // Background vertical shift follows elevation (climb → sky slides down)
    const resolution = H / 480;
    const bgShift = clamp(s.playerY * 0.0016 * resolution, -H * 0.2, H * 0.2);
    const horizon = H * 0.5 + bgShift;

    // Sky
    if (this.skyGrad) {
      ctx.fillStyle = this.skyGrad;
      ctx.fillRect(-40, -40, W + 80, horizon + 42);
    }

    // Stars
    ctx.fillStyle = '#cfd8ff';
    for (const star of this.stars) {
      const a = this.reduceMotion
        ? 0.55
        : 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(s.time * 1.7 + star.phase));
      ctx.globalAlpha = a * (1 - star.y);
      const sy = star.y * horizon * 0.92 + bgShift * 0.4;
      ctx.fillRect(star.x * W, sy, star.r, star.r);
    }
    ctx.globalAlpha = 1;

    // Sun — slow parallax sway tied to curves
    const sunX = W / 2 - Math.sin(s.skyOffset * Math.PI * 2 * 0.45) * W * 0.38;
    const sunY = horizon - this.sunR * 0.42;
    ctx.drawImage(
      this.sun,
      sunX - this.sun.width / 2,
      sunY - this.sun.height / 2,
      this.sun.width,
      this.sun.height,
    );

    // Mountains — two parallax layers, tiled horizontally
    for (const layer of this.mountains) {
      const drawH = H * layer.heightFactor;
      const off = (((s.skyOffset * layer.speed) % 1) + 1) % 1 * W;
      const y = horizon - drawH + 2;
      ctx.drawImage(layer.img, -off, y, W, drawH);
      ctx.drawImage(layer.img, -off + W, y, W, drawH);
    }

    // Horizon glow line
    const glowGrad = ctx.createLinearGradient(0, horizon - 14, 0, horizon + 6);
    glowGrad.addColorStop(0, 'rgba(8,247,254,0)');
    glowGrad.addColorStop(0.7, 'rgba(8,247,254,0.22)');
    glowGrad.addColorStop(1, 'rgba(8,247,254,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(-40, horizon - 14, W + 80, 20);

    // ——— Road ————————————————————————————————————————————————
    const track = s.track;
    const segments = track.segments;
    const N = segments.length;
    const baseSegment = segments[Math.floor(s.position / CFG.segLen) % N];
    const basePercent = percentRemaining(s.position, CFG.segLen);
    const playerSegIdx = Math.floor((s.position + PLAYER_Z) / CFG.segLen) % N;
    const playerSegment = segments[playerSegIdx];
    const playerPercent = percentRemaining(s.position + PLAYER_Z, CFG.segLen);

    // Dynamic FOV: widens slightly while boosting
    const fov = CFG.fov + 9 * s.boostGlow;
    const camDepth = 1 / Math.tan(((fov / 2) * Math.PI) / 180);
    const playerZRender = CFG.camHeight * camDepth;

    let maxy = H;
    let x = 0;
    let dx = -(baseSegment.curve * basePercent);
    const camY = s.playerY + CFG.camHeight;

    for (let n = 0; n < s.drawDist; n++) {
      const segment = segments[(baseSegment.index + n) % N];
      segment.looped = segment.index < baseSegment.index;
      segment.fog = exponentialFog(n / s.drawDist, CFG.fogDensity);
      segment.clip = maxy;

      const camZBase = s.position - (segment.looped ? track.length : 0);
      this.project(segment.p1, s.playerX * CFG.roadWidth - x, camY, camZBase, camDepth);
      this.project(segment.p2, s.playerX * CFG.roadWidth - x - dx, camY, camZBase, camDepth);

      x += dx;
      dx += segment.curve;

      if (
        segment.p1.camera.z <= camDepth ||
        segment.p2.screen.y >= segment.p1.screen.y ||
        segment.p2.screen.y >= maxy
      ) {
        continue;
      }

      this.renderSegment(segment);
      maxy = segment.p2.screen.y;
    }

    // ——— Sprites, traffic, ghost, player (back to front) ————————————————
    const ghostIdx = s.ghost ? Math.floor(s.ghost.z / CFG.segLen) % N : -1;
    const ghostPercent = s.ghost ? percentRemaining(s.ghost.z, CFG.segLen) : 0;

    for (let n = s.drawDist - 1; n > 0; n--) {
      const segment = segments[(baseSegment.index + n) % N];

      for (const car of segment.cars) {
        const scale = interpolate(segment.p1.screen.scale, segment.p2.screen.scale, car.percent);
        const sx =
          interpolate(segment.p1.screen.x, segment.p2.screen.x, car.percent) +
          scale * car.offset * CFG.roadWidth * (W / 2);
        const sy = interpolate(segment.p1.screen.y, segment.p2.screen.y, car.percent);
        this.drawSprite(this.sprites.traffic[car.colorway], CAR_WORLD_W, scale, sx, sy, -0.5, segment.clip, segment.fog);
      }

      if (segment.index === ghostIdx && s.ghost) {
        const scale = interpolate(segment.p1.screen.scale, segment.p2.screen.scale, ghostPercent);
        const sx =
          interpolate(segment.p1.screen.x, segment.p2.screen.x, ghostPercent) +
          scale * s.ghost.x * CFG.roadWidth * (W / 2);
        const sy = interpolate(segment.p1.screen.y, segment.p2.screen.y, ghostPercent);
        this.drawSprite(this.sprites.ghost, CAR_WORLD_W, scale, sx, sy, -0.5, segment.clip, segment.fog);
      }

      for (const ref of segment.sprites) {
        const def = this.sprites.world[ref.kind];
        const scale = segment.p1.screen.scale;
        const sx = segment.p1.screen.x + scale * ref.offset * CFG.roadWidth * (W / 2);
        const sy = segment.p1.screen.y;
        const anchor = ref.offset < 0 ? -1 : def.anchor;
        this.drawSprite(def.img, def.worldW, scale, sx, sy, anchor, segment.clip, segment.fog);
      }

      if (segment === playerSegment) {
        // Player car, bottom of the screen, sitting on the road surface.
        // Slightly smaller than the raw projection and lifted a few pixels so
        // the tyres and contact shadow stay on-screen.
        const playerScale = camDepth / playerZRender;
        const camYi = interpolate(playerSegment.p1.camera.y, playerSegment.p2.camera.y, playerPercent);
        const lift = Math.max(4, H * 0.006);
        const destY = H / 2 - (playerScale * camYi * H) / 2 - lift;
        const carW = playerScale * CAR_WORLD_W * (W / 2) * 0.88;
        const bounce = this.reduceMotion
          ? 0
          : Math.sin(s.time * 34) * s.speedPct * resolution * 1.1;
        drawPlayerCar(
          ctx,
          W / 2 + s.steer * W * 0.015,
          destY + bounce,
          carW,
          s.steer,
          s.braking,
          s.boosting,
          s.time,
        );
      }
    }

    // ——— Boost / top-speed speed lines ————————————————————————————
    const fxLevel = Math.max(s.boostGlow, clamp((s.speedPct - 0.96) * 8, 0, 1));
    if (fxLevel > 0.02 && !this.reduceMotion) {
      const cx = W / 2;
      const cy = H * 0.55;
      const count = s.boosting ? 20 : 8;
      ctx.lineWidth = 2;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const rMax = Math.hypot(W, H) / 2;
        const r1 = rMax * (0.45 + Math.random() * 0.3);
        const r2 = r1 + rMax * (0.08 + Math.random() * 0.16) * fxLevel;
        ctx.strokeStyle = `rgba(190,250,255,${(0.05 + 0.16 * fxLevel).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // -------------------------------------------------------------------------

  private project(p: Segment['p1'], camX: number, camY: number, camZ: number, camDepth: number): void {
    const { W, H } = this;
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    p.screen.scale = camDepth / p.camera.z;
    p.screen.x = Math.round(W / 2 + (p.screen.scale * p.camera.x * W) / 2);
    p.screen.y = Math.round(H / 2 - (p.screen.scale * p.camera.y * H) / 2);
    p.screen.w = Math.round((p.screen.scale * CFG.roadWidth * W) / 2);
  }

  private renderSegment(segment: Segment): void {
    const ctx = this.ctx;
    const W = this.W;
    const p1 = segment.p1.screen;
    const p2 = segment.p2.screen;
    const light = segment.color === 0 || segment.color === 2;

    const rumble1 = p1.w / Math.max(6, 2 * CFG.lanes);
    const rumble2 = p2.w / Math.max(6, 2 * CFG.lanes);
    const lane1 = p1.w / Math.max(32, 8 * CFG.lanes);
    const lane2 = p2.w / Math.max(32, 8 * CFG.lanes);

    const plain = light ? PAL.plainLight : PAL.plainDark;
    const road = segment.color === 2 ? PAL.startDark : light ? PAL.roadLight : PAL.roadDark;
    const rumble = light ? PAL.rumbleLight : PAL.rumbleDark;

    // Ground plane
    ctx.fillStyle = plain;
    ctx.fillRect(-40, p2.y, W + 80, p1.y - p2.y);

    // Rumble strips
    this.polygon(p1.x - p1.w - rumble1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - rumble2, p2.y, rumble);
    this.polygon(p1.x + p1.w + rumble1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + rumble2, p2.y, rumble);

    // Road
    this.polygon(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, road);

    // Lane markers
    if (light && segment.color !== 2 && p1.y - p2.y > 1.5) {
      const laneW1 = (p1.w * 2) / CFG.lanes;
      const laneW2 = (p2.w * 2) / CFG.lanes;
      let laneX1 = p1.x - p1.w + laneW1;
      let laneX2 = p2.x - p2.w + laneW2;
      ctx.fillStyle = PAL.lane;
      for (let lane = 1; lane < CFG.lanes; lane++) {
        this.polygon(laneX1 - lane1 / 2, p1.y, laneX1 + lane1 / 2, p1.y, laneX2 + lane2 / 2, p2.y, laneX2 - lane2 / 2, p2.y, PAL.lane);
        laneX1 += laneW1;
        laneX2 += laneW2;
      }
    }

    // Start-line checkerboard
    if (segment.color === 2) {
      const cells = 8;
      for (let i = 0; i < cells; i++) {
        const c = (segment.index + i) % 2 === 0;
        const a1 = p1.x - p1.w + ((2 * p1.w) / cells) * i;
        const a2 = a1 + (2 * p1.w) / cells;
        const b1 = p2.x - p2.w + ((2 * p2.w) / cells) * i;
        const b2 = b1 + (2 * p2.w) / cells;
        this.polygon(a1, p1.y, a2, p1.y, b2, p2.y, b1, p2.y, c ? PAL.startLight : PAL.startDark);
      }
    }

    // Fog
    if (segment.fog < 1) {
      ctx.globalAlpha = 1 - segment.fog;
      ctx.fillStyle = PAL.fog;
      ctx.fillRect(-40, p2.y, W + 80, p1.y - p2.y);
      ctx.globalAlpha = 1;
    }
  }

  private polygon(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number,
    color: string,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  private drawSprite(
    img: HTMLCanvasElement,
    worldW: number,
    scale: number,
    destX: number,
    destY: number,
    anchor: number,
    clipY: number,
    fog: number,
  ): void {
    const ctx = this.ctx;
    const destW = worldW * scale * (this.W / 2);
    if (destW < 1.5) return;
    const destH = destW * (img.height / img.width);
    const x = destX + destW * anchor;
    const y = destY - destH;
    if (x > this.W || x + destW < 0) return;

    const clipH = clipY ? Math.max(0, y + destH - clipY) : 0;
    if (clipH >= destH) return;

    const visibleH = destH - clipH;
    if (visibleH <= 0.5) return;
    const sourceH = img.height * (visibleH / destH);

    ctx.globalAlpha = Math.min(1, fog * 1.12);
    ctx.drawImage(img, 0, 0, img.width, sourceH, x, y, destW, visibleH);
    ctx.globalAlpha = 1;
  }
}
