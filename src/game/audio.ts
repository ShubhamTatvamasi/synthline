/**
 * All audio is synthesized with the Web Audio API — engine hum, wind, music
 * and SFX. No audio files ship with the game.
 *
 * The soundtrack is a looping synthwave progression (Am–F–C–G) scheduled with
 * a look-ahead scheduler, so it stays rock steady regardless of frame rate.
 */

const BPM = 116;
const SIXTEENTH = 60 / BPM / 4;
const BAR = SIXTEENTH * 16;

interface ChordSpec {
  root: number; // MIDI root for the bass
  tones: number[]; // MIDI notes for the arp
}

const PROGRESSION: ChordSpec[] = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 48, tones: [60, 64, 67] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];

function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export class AudioSys {
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private delay: DelayNode | null = null;

  // Engine
  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  // Music scheduler
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private engineRunning = false;

  musicOn = true;
  sfxOn = true;

  /** Create the AudioContext — must be called from a user gesture. */
  ensure(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      const master = this.ctx.createGain();
      master.gain.value = 0.85;
      master.connect(this.ctx.destination);

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.connect(master);

      const musicBus = this.ctx.createGain();
      musicBus.gain.value = this.musicOn ? 0.5 : 0;
      musicBus.connect(comp);

      const sfxBus = this.ctx.createGain();
      sfxBus.gain.value = this.sfxOn ? 0.9 : 0;
      sfxBus.connect(comp);

      // Shared echo for the music
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = SIXTEENTH * 3; // dotted 8th
      const feedback = this.ctx.createGain();
      feedback.gain.value = 0.34;
      const dampen = this.ctx.createBiquadFilter();
      dampen.type = 'lowpass';
      dampen.frequency.value = 2600;
      delay.connect(dampen);
      dampen.connect(feedback);
      feedback.connect(delay);
      delay.connect(musicBus);

      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
      this.delay = delay;
      return true;
    } catch {
      return false;
    }
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    }
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  // -----------------------------------------------------------------------
  // Engine + wind (continuous)
  // -----------------------------------------------------------------------

  startEngine(): void {
    if (!this.ctx || !this.sfxBus || this.engineRunning) return;
    const ctx = this.ctx;
    this.engineRunning = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 27;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc1.start();
    osc2.start();

    // Wind / road noise
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.0001;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.sfxBus);
    wind.start();

    this.engOsc1 = osc1;
    this.engOsc2 = osc2;
    this.engFilter = filter;
    this.engGain = gain;
    this.windSrc = wind;
    this.windGain = windGain;
    this.windFilter = windFilter;
    gain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.3);
  }

  stopEngine(): void {
    if (!this.ctx || !this.engineRunning) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.engGain?.gain.setTargetAtTime(0.0001, t, 0.15);
    this.windGain?.gain.setTargetAtTime(0.0001, t, 0.15);
    const osc1 = this.engOsc1;
    const osc2 = this.engOsc2;
    const wind = this.windSrc;
    window.setTimeout(() => {
      try {
        osc1?.stop();
        osc2?.stop();
        wind?.stop();
      } catch {
        /* already stopped */
      }
    }, 600);
    this.engOsc1 = null;
    this.engOsc2 = null;
    this.engGain = null;
    this.windSrc = null;
    this.engineRunning = false;
  }

  /** Per-frame engine update. speedPct 0..1 (+boost beyond 1). */
  engineUpdate(speedPct: number, boosting: boolean, dt: number, idle: boolean): void {
    if (!this.ctx || !this.engOsc1 || !this.engOsc2 || !this.engFilter) return;
    const t = this.ctx.currentTime;
    const wob = Math.sin(t * 31) * 0.02;
    const base = 46 + speedPct * 150 + (boosting ? 34 : 0);
    this.engOsc1.frequency.setTargetAtTime(base * (1 + wob), t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(560 + speedPct * 2100, t, 0.08);
    if (this.engGain) {
      const target = idle ? 0.08 : 0.1 + speedPct * 0.1;
      this.engGain.gain.setTargetAtTime(target, t, 0.1);
    }
    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(Math.pow(Math.max(0, speedPct), 2.4) * 0.16, t, 0.1);
      this.windFilter.frequency.setTargetAtTime(380 + speedPct * 2600, t, 0.1);
    }
    void dt;
  }

  // -----------------------------------------------------------------------
  // Music
  // -----------------------------------------------------------------------

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    if (!this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += SIXTEENTH;
      this.step++;
    }
  }

  private playStep(step: number, time: number): void {
    if (!this.ctx || !this.musicBus) return;
    const s = step % 16; // step within bar
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const chord = PROGRESSION[bar];

    // Kick
    if (s % 4 === 0) this.kick(time);
    // Snare
    if (s === 4 || s === 12) this.snare(time);
    // Hats
    if (s % 2 === 1) this.hat(time, s % 4 === 3 ? 0.09 : 0.055);
    // Bass on 8ths
    if (s % 2 === 0) {
      const octave = s === 6 || s === 14 ? 12 : 0;
      this.bass(time, midi(chord.root + octave));
    }
    // Arp on 16ths
    const tone = chord.tones[step % 3] + (s % 8 >= 4 ? 12 : 0);
    this.arp(time, midi(tone));
    // Sparse pad swell at bar start
    if (s === 0 && bar % 2 === 0) this.pad(time, chord.tones.map((n) => midi(n - 12)));
  }

  private kick(time: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private snare(time: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const len = 0.16;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.26, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + len);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.musicBus);
    src.start(time);
  }

  private hat(time: number, level: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const len = 0.04;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + len);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.musicBus);
    src.start(time);
  }

  private bass(time: number, freq: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.exponentialRampToValueAtTime(240, time + 0.2);
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.3, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + SIXTEENTH * 1.9);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + SIXTEENTH * 2);
  }

  private arp(time: number, freq: number): void {
    if (!this.ctx || !this.musicBus || !this.delay) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.05, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + SIXTEENTH * 1.2);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    gain.connect(this.delay);
    osc.start(time);
    osc.stop(time + SIXTEENTH * 1.5);
  }

  private pad(time: number, freqs: number[]): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 12;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.035, time + BAR * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + BAR * 0.95);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicBus);
      osc.start(time);
      osc.stop(time + BAR);
    }
  }

  // -----------------------------------------------------------------------
  // SFX
  // -----------------------------------------------------------------------

  private blip(freq: number, dur: number, level = 0.25, type: OscillatorType = 'square'): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  countdown(final: boolean): void {
    this.blip(final ? 990 : 660, final ? 0.42 : 0.14, 0.28, 'square');
  }

  uiClick(): void {
    this.blip(720, 0.05, 0.14, 'square');
  }

  nearMiss(): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = 0.28;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + len);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t);
  }

  crash(): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = 0.34;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.6);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t);
    // Low thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g2);
    g2.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  boostEngage(): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  lap(): void {
    this.blip(660, 0.1, 0.22, 'triangle');
    window.setTimeout(() => this.blip(990, 0.16, 0.22, 'triangle'), 110);
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      window.setTimeout(() => this.blip(f, 0.22, 0.24, 'triangle'), i * 120);
    });
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    this.stopMusic();
    this.stopEngine();
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
