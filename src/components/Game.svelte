<script lang="ts">
  import { Game } from '../game/engine';
  import type { FinishStats, HudSnapshot } from '../game/types';
  import { formatTime } from '../game/util';

  const emptyHud: HudSnapshot = {
    mode: 'menu',
    paused: false,
    speedKmh: 0,
    lap: 1,
    totalLaps: 3,
    lapTimeMs: 0,
    lastLapMs: null,
    bestLapMs: null,
    bestRaceMs: null,
    boostPct: 0,
    boosting: false,
    boostReady: false,
    offroad: false,
    countdown: null,
    goFlash: false,
    toast: null,
    musicOn: true,
    sfxOn: true,
    fps: 60,
  };

  let canvasEl: HTMLCanvasElement;
  let game: Game | null = null;

  let hud = $state<HudSnapshot>(emptyHud);
  let finishStats = $state<FinishStats | null>(null);
  let isTouch = $state(false);
  let booted = $state(false);
  let loadError = $state<string | null>(null);

  const screen = $derived(hud.paused ? 'paused' : hud.mode);
  const racing = $derived(screen === 'racing' || screen === 'countdown');

  $effect(() => {
    if (!canvasEl) return;
    const g = new Game(canvasEl, {
      onHud: (h) => {
        hud = h;
      },
      onFinish: (stats) => {
        finishStats = stats;
      },
    });
    game = g;
    // Handy debug handle (also used by the automated smoke checks)
    (window as unknown as Record<string, unknown>).__synthline = g;

    isTouch =
      window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    g.setTouchMode(isTouch);

    g.init()
      .then(() => {
        booted = true;
      })
      .catch((err: unknown) => {
        loadError = err instanceof Error ? err.message : String(err);
      });

    return () => {
      g.dispose();
      const w = window as unknown as Record<string, unknown>;
      if (w.__synthline === g) delete w.__synthline;
      game = null;
    };
  });

  function startRace(): void {
    finishStats = null;
    game?.unlockAudio();
    game?.playUiClick();
    game?.beginRace();
  }

  function resume(): void {
    game?.playUiClick();
    game?.resume();
  }

  function toMenu(): void {
    game?.playUiClick();
    finishStats = null;
    game?.toMenu();
  }

  function toggleMusic(): void {
    game?.playUiClick();
    game?.setMusic(!hud.musicOn);
  }

  function toggleSfx(): void {
    // Play the confirmation before muting so turning SFX off still clicks.
    game?.playUiClick();
    game?.setSfx(!hud.sfxOn);
  }

  function press(key: 'left' | 'right' | 'brake' | 'boost', down: boolean) {
    return (e: PointerEvent) => {
      e.preventDefault();
      // Keep the button pressed even if the finger slides slightly off it.
      if (down) {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture unsupported */
        }
      }
      game?.setVirtual(key, down);
    };
  }

  function preventCtx(e: Event): void {
    e.preventDefault();
  }

  const bestLabel = $derived(
    hud.bestRaceMs != null ? formatTime(hud.bestRaceMs) : 'NO RECORD YET'
  );

  const deltaMs = $derived(
    finishStats?.previousBestMs != null
      ? finishStats.totalMs - finishStats.previousBestMs
      : null
  );

  function formatDelta(ms: number): string {
    return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(2)}s`;
  }
</script>

<div class="game" class:touch={isTouch}>
  <canvas bind:this={canvasEl} aria-label="SYNTHLINE game canvas"></canvas>

  <!-- CRT overlay: scanlines + vignette -->
  <div class="crt" aria-hidden="true"></div>

  <!-- ————— Racing HUD ————— -->
  {#if racing || screen === 'paused' || screen === 'finished'}
    <div class="hud">
      <div class="hud-topleft">
        <button type="button"
          class="icon-btn"
          onclick={() => game?.pause()}
          aria-label="Pause"
          onpointerdown={preventCtx}
        >
          ❚❚
        </button>
        <div class="info">
          <span class="lap">LAP <b>{hud.lap}</b>/{hud.totalLaps}</span>
          <span class="mono">{formatTime(hud.lapTimeMs)}</span>
          <span class="dim mono">LAST {formatTime(hud.lastLapMs)}</span>
          <span class="dim mono">BEST {formatTime(hud.bestLapMs)}</span>
        </div>
      </div>

      <div class="hud-topright">
        <div class="speed">
          <span class="value">{hud.speedKmh}</span>
          <span class="unit">KM/H</span>
        </div>
        <div class="boost">
          <div
            class="boost-bar"
            class:active={hud.boosting}
            class:ready={hud.boostReady}
          >
            <div class="fill" style={`width:${Math.min(100, hud.boostPct)}%`}></div>
          </div>
          <span class="boost-label" class:ready={hud.boostReady}>BOOST</span>
        </div>
      </div>

      {#if hud.toast}
        <div class="toast" role="status" aria-live="polite">{hud.toast}</div>
      {/if}

      {#if hud.countdown !== null && hud.countdown > 0}
        {#key hud.countdown}
          <div class="countdown">{hud.countdown}</div>
        {/key}
      {:else if hud.goFlash}
        <div class="countdown go">GO!</div>
      {/if}
    </div>

    {#if isTouch && racing && !hud.paused}
      <div class="touch-controls">
        <div class="tc-left">
          <button type="button"
            class="tbtn"
            aria-label="Steer left"
            onpointerdown={press('left', true)}
            onpointerup={press('left', false)}
            onpointerleave={press('left', false)}
            onpointercancel={press('left', false)}
            oncontextmenu={preventCtx}
          >
            ◀
          </button>
          <button type="button"
            class="tbtn"
            aria-label="Steer right"
            onpointerdown={press('right', true)}
            onpointerup={press('right', false)}
            onpointerleave={press('right', false)}
            onpointercancel={press('right', false)}
            oncontextmenu={preventCtx}
          >
            ▶
          </button>
        </div>
        <div class="tc-right">
          <button type="button"
            class="tbtn small"
            aria-label="Brake"
            onpointerdown={press('brake', true)}
            onpointerup={press('brake', false)}
            onpointerleave={press('brake', false)}
            onpointercancel={press('brake', false)}
            oncontextmenu={preventCtx}
          >
            BRAKE
          </button>
          <button type="button"
            class="tbtn small boost-btn"
            class:active={hud.boosting}
            aria-label="Boost"
            onpointerdown={press('boost', true)}
            onpointerup={press('boost', false)}
            onpointerleave={press('boost', false)}
            onpointercancel={press('boost', false)}
            oncontextmenu={preventCtx}
          >
            BOOST
          </button>
        </div>
      </div>
    {/if}
  {/if}

  <!-- ————— Menu ————— -->
  {#if screen === 'menu'}
    <div class="overlay menu">
      {#if !booted}
        <div class="loading">{loadError ? `FAILED TO LOAD — ${loadError}` : 'LOADING…'}</div>
      {:else}
        <div class="logo">
          <h1>SYNTH<span>LINE</span></h1>
          <p class="tagline">OUTRUN THE HORIZON</p>
        </div>

        <button type="button" class="btn primary" onclick={startRace}>▶ START RACE</button>

        <div class="best mono">BEST · {bestLabel}</div>

        <div class="help">
          {#if isTouch}
            <p><b>STEER</b> with the on-screen pads · throttle is automatic</p>
            <p>Skim past traffic for <b class="cyan">NEAR MISSES</b> to charge <b class="magenta">BOOST</b></p>
          {:else}
            <p><b>← →</b> steer · <b>↑</b> accelerate · <b>↓</b> brake · <b>SHIFT</b> boost</p>
            <p><b>R</b> restart · <b>ESC</b> pause · gamepad supported</p>
            <p>Skim past traffic for <b class="cyan">NEAR MISSES</b> to charge <b class="magenta">BOOST</b></p>
          {/if}
        </div>

        <div class="toggles">
          <button type="button" class="btn small" class:off={!hud.musicOn} onclick={toggleMusic}>
            MUSIC {hud.musicOn ? 'ON' : 'OFF'}
          </button>
          <button type="button" class="btn small" class:off={!hud.sfxOn} onclick={toggleSfx}>
            SFX {hud.sfxOn ? 'ON' : 'OFF'}
          </button>
        </div>

        <footer>
          {hud.totalLaps} laps · your best run returns as a <b class="cyan">ghost</b> ·
          built with astro + svelte
        </footer>
      {/if}
    </div>
  {/if}

  <!-- ————— Paused ————— -->
  {#if screen === 'paused'}
    <div class="overlay dim">
      <h2 class="overlay-title">PAUSED</h2>
      <div class="stack">
        <button type="button" class="btn primary" onclick={resume}>RESUME</button>
        <button type="button" class="btn" onclick={startRace}>RESTART</button>
        <button type="button" class="btn" onclick={toMenu}>MENU</button>
      </div>
      <div class="toggles">
        <button type="button" class="btn small" class:off={!hud.musicOn} onclick={toggleMusic}>
          MUSIC {hud.musicOn ? 'ON' : 'OFF'}
        </button>
        <button type="button" class="btn small" class:off={!hud.sfxOn} onclick={toggleSfx}>
          SFX {hud.sfxOn ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  {/if}

  <!-- ————— Finished ————— -->
  {#if screen === 'finished' && finishStats}
    <div class="overlay dim">
      <h2 class="overlay-title">RACE COMPLETE</h2>
      {#if finishStats.isRecord}
        <div class="record">★ NEW RECORD ★</div>
      {/if}
      <table class="results mono">
        <tbody>
          {#each finishStats.lapTimesMs as t, i}
            <tr>
              <td class="dim">LAP {i + 1}</td>
              <td>{formatTime(t)}</td>
            </tr>
          {/each}
          <tr>
            <td class="dim">BEST LAP</td>
            <td>{formatTime(finishStats.bestLapMs)}</td>
          </tr>
          <tr class="total">
            <td class="dim">TOTAL</td>
            <td>{formatTime(finishStats.totalMs)}</td>
          </tr>
          {#if finishStats.previousBestMs != null}
            <tr>
              <td class="dim">PREVIOUS BEST</td>
              <td>{formatTime(finishStats.previousBestMs)}</td>
            </tr>
            {#if deltaMs != null && deltaMs !== 0}
              <tr class={deltaMs < 0 ? 'gain' : 'loss'}>
                <td class="dim">{deltaMs < 0 ? 'GAIN' : 'GAP'}</td>
                <td>{formatDelta(deltaMs)}</td>
              </tr>
            {/if}
          {/if}
        </tbody>
      </table>
      <div class="stack row">
        <button type="button" class="btn primary" onclick={startRace}>RACE AGAIN</button>
        <button type="button" class="btn" onclick={toMenu}>MENU</button>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #05010f;
    overflow: hidden;
    overscroll-behavior: none;
  }

  .game {
    position: fixed;
    inset: 0;
    height: 100vh;
    height: 100dvh;
    background: #05010f;
    font-family: 'Orbitron', 'Segoe UI', system-ui, sans-serif;
    color: #efeaf6;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .crt {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.13) 0px,
        rgba(0, 0, 0, 0.13) 1px,
        transparent 1px,
        transparent 3px
      ),
      radial-gradient(ellipse at center, transparent 58%, rgba(3, 0, 12, 0.5) 100%);
    mix-blend-mode: multiply;
    z-index: 5;
  }

  /* ————— HUD ————— */

  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    font-family: 'Share Tech Mono', ui-monospace, monospace;
  }

  .hud-topleft {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    left: max(12px, env(safe-area-inset-left));
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .icon-btn:focus-visible,
  .tbtn:focus-visible {
    outline: 2px solid #08f7fe;
    outline-offset: 3px;
  }

  .icon-btn {
    pointer-events: auto;
    background: rgba(13, 2, 33, 0.66);
    border: 1px solid rgba(8, 247, 254, 0.4);
    color: #08f7fe;
    font-family: inherit;
    font-size: 11px;
    padding: 9px 10px;
    border-radius: 8px;
    cursor: pointer;
    letter-spacing: 1px;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 14px;
    text-shadow: 0 0 8px rgba(8, 247, 254, 0.35);
  }

  .info .lap {
    font-family: 'Orbitron', sans-serif;
    font-size: 13px;
    letter-spacing: 2px;
  }

  .mono {
    font-family: 'Share Tech Mono', ui-monospace, monospace;
  }

  .dim {
    color: #9c8fc4;
  }

  .hud-topright {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    right: max(12px, env(safe-area-inset-right));
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .speed {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .speed .value {
    font-family: 'Orbitron', sans-serif;
    font-weight: 900;
    font-size: clamp(26px, 4.5vw, 40px);
    line-height: 1;
    color: #f3effc;
    text-shadow:
      0 0 12px rgba(8, 247, 254, 0.7),
      0 0 30px rgba(8, 247, 254, 0.35);
    font-variant-numeric: tabular-nums;
  }

  .speed .unit {
    font-size: 11px;
    letter-spacing: 2px;
    color: #9c8fc4;
  }

  .boost {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }

  .boost-bar {
    width: clamp(110px, 16vw, 170px);
    height: 10px;
    border: 1px solid rgba(255, 41, 117, 0.65);
    border-radius: 5px;
    background: rgba(13, 2, 33, 0.6);
    overflow: hidden;
  }

  .boost-bar .fill {
    height: 100%;
    background: linear-gradient(90deg, #ff2975, #ff8da0);
    box-shadow: 0 0 10px rgba(255, 41, 117, 0.8);
    transition: width 80ms linear;
  }

  .boost-bar.active {
    border-color: #08f7fe;
    box-shadow: 0 0 14px rgba(8, 247, 254, 0.6);
  }

  .boost-bar.active .fill {
    background: linear-gradient(90deg, #08f7fe, #b9fbff);
    box-shadow: 0 0 12px rgba(8, 247, 254, 0.9);
  }

  .boost-label {
    font-size: 10px;
    letter-spacing: 3px;
    color: #9c8fc4;
  }

  .boost-label.ready {
    color: #ff2975;
    text-shadow: 0 0 8px rgba(255, 41, 117, 0.8);
  }

  .toast {
    position: absolute;
    top: 18%;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Orbitron', sans-serif;
    font-weight: 700;
    font-size: clamp(16px, 3vw, 24px);
    letter-spacing: 4px;
    color: #08f7fe;
    text-shadow:
      0 0 14px rgba(8, 247, 254, 0.9),
      0 0 40px rgba(8, 247, 254, 0.5);
    animation: toast-in 0.18s ease-out;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) scale(0.85);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }
  }

  .countdown {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Orbitron', sans-serif;
    font-weight: 900;
    font-size: clamp(90px, 22vw, 190px);
    color: #f3effc;
    text-shadow:
      0 0 30px rgba(255, 41, 117, 0.9),
      0 0 90px rgba(255, 41, 117, 0.5);
    animation: count-pop 0.5s cubic-bezier(0.2, 1.6, 0.4, 1);
  }

  .countdown.go {
    color: #08f7fe;
    text-shadow:
      0 0 30px rgba(8, 247, 254, 0.9),
      0 0 90px rgba(8, 247, 254, 0.5);
  }

  @keyframes count-pop {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(2.1);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  /* ————— Touch controls ————— */

  .touch-controls {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    justify-content: space-between;
    padding: 0 max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    z-index: 20;
    pointer-events: none;
  }

  .tc-left,
  .tc-right {
    display: flex;
    gap: 12px;
    pointer-events: auto;
  }

  .tbtn {
    width: 76px;
    height: 76px;
    border-radius: 16px;
    border: 1px solid rgba(8, 247, 254, 0.5);
    background: rgba(13, 2, 33, 0.55);
    color: #08f7fe;
    font-family: 'Orbitron', sans-serif;
    font-size: 24px;
    display: grid;
    place-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .tbtn:active {
    background: rgba(8, 247, 254, 0.25);
    box-shadow: 0 0 18px rgba(8, 247, 254, 0.5);
  }

  .tbtn.small {
    width: 88px;
    font-size: 13px;
    letter-spacing: 2px;
  }

  .tbtn.boost-btn {
    border-color: rgba(255, 41, 117, 0.6);
    color: #ff2975;
  }

  .tbtn.boost-btn.active {
    background: rgba(255, 41, 117, 0.3);
    box-shadow: 0 0 22px rgba(255, 41, 117, 0.65);
  }

  /* ————— Overlays ————— */

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* "safe center" keeps the top reachable if content is taller than a
       short landscape phone viewport. */
    justify-content: center;
    justify-content: safe center;
    gap: 22px;
    padding: 24px;
    text-align: center;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    background: radial-gradient(ellipse at center, rgba(9, 2, 24, 0.55), rgba(5, 1, 15, 0.88));
  }

  .overlay > * {
    flex: 0 0 auto;
  }

  .overlay.dim {
    background: rgba(5, 1, 15, 0.82);
    backdrop-filter: none;
  }

  .logo h1 {
    margin: 0;
    font-size: clamp(44px, 11vw, 96px);
    font-weight: 900;
    letter-spacing: 0.06em;
    line-height: 1;
    background: linear-gradient(180deg, #f3effc 15%, #08f7fe 55%, #ff2975 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 0 18px rgba(8, 247, 254, 0.45)) drop-shadow(0 0 46px rgba(255, 41, 117, 0.3));
  }

  .logo h1 span {
    background: linear-gradient(180deg, #ffd319 10%, #ff2975 90%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .tagline {
    margin: 14px 0 0;
    font-size: clamp(11px, 2vw, 14px);
    letter-spacing: 0.65em;
    text-indent: 0.65em;
    color: #9c8fc4;
  }

  .btn {
    font-family: 'Orbitron', sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 3px;
    color: #08f7fe;
    background: rgba(13, 2, 33, 0.7);
    border: 1px solid rgba(8, 247, 254, 0.65);
    border-radius: 10px;
    padding: 14px 34px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-shadow: 0 0 8px rgba(8, 247, 254, 0.6);
  }

  .btn:hover,
  .btn:focus-visible {
    box-shadow: 0 0 22px rgba(8, 247, 254, 0.45), inset 0 0 12px rgba(8, 247, 254, 0.12);
    transform: translateY(-1px);
  }

  .btn:focus-visible {
    outline: 2px solid #08f7fe;
    outline-offset: 3px;
  }

  .btn:active {
    transform: translateY(0);
  }

  .btn.primary {
    font-size: 17px;
    padding: 16px 44px;
    animation: pulse 2.4s ease-in-out infinite;
  }

  .btn.small {
    font-size: 11px;
    padding: 9px 16px;
    letter-spacing: 2px;
  }

  .btn.off {
    color: #9c8fc4;
    border-color: rgba(156, 143, 196, 0.4);
    text-shadow: none;
  }

  @keyframes pulse {
    0%, 100% {
      box-shadow: 0 0 12px rgba(8, 247, 254, 0.25);
    }
    50% {
      box-shadow: 0 0 30px rgba(8, 247, 254, 0.55), inset 0 0 14px rgba(8, 247, 254, 0.15);
    }
  }

  .best {
    color: #ffd166;
    font-size: 14px;
    letter-spacing: 2px;
    text-shadow: 0 0 10px rgba(255, 209, 102, 0.4);
  }

  .help {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: #9c8fc4;
    font-family: 'Share Tech Mono', ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.5;
    max-width: 520px;
  }

  .help b {
    color: #efeaf6;
  }

  .help .cyan,
  .cyan {
    color: #08f7fe;
  }

  .magenta {
    color: #ff2975;
  }

  .toggles {
    display: flex;
    gap: 10px;
  }

  .overlay footer {
    position: absolute;
    bottom: max(14px, env(safe-area-inset-bottom));
    color: #66568f;
    font-family: 'Share Tech Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 1px;
  }

  .loading {
    font-family: 'Share Tech Mono', ui-monospace, monospace;
    letter-spacing: 4px;
    color: #08f7fe;
    animation: blink 1.2s steps(2) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }

  .overlay-title {
    margin: 0;
    font-size: clamp(26px, 6vw, 44px);
    font-weight: 900;
    letter-spacing: 0.2em;
    color: #f3effc;
    text-shadow: 0 0 24px rgba(8, 247, 254, 0.6);
  }

  .record {
    font-family: 'Orbitron', sans-serif;
    font-weight: 700;
    letter-spacing: 4px;
    color: #ffd166;
    text-shadow: 0 0 16px rgba(255, 209, 102, 0.7);
    animation: pulse-gold 1.6s ease-in-out infinite;
  }

  @keyframes pulse-gold {
    50% {
      opacity: 0.6;
    }
  }

  .results {
    border-collapse: collapse;
    font-size: 15px;
    letter-spacing: 1px;
  }

  .results td {
    padding: 4px 14px;
    text-align: left;
  }

  .results td:last-child {
    text-align: right;
  }

  .results .total td {
    border-top: 1px solid rgba(156, 143, 196, 0.4);
    padding-top: 8px;
    color: #08f7fe;
    font-weight: bold;
  }

  .results .gain td {
    color: #08f7fe;
  }

  .results .loss td {
    color: #ff8da0;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .stack.row {
    flex-direction: row;
  }

  @media (max-width: 640px) {
    .info {
      font-size: 12px;
    }
    .help {
      font-size: 12px;
    }
    .tbtn {
      width: 64px;
      height: 64px;
    }
    .tbtn.small {
      width: 74px;
    }
  }

  @media (max-width: 380px) {
    .hud-topleft,
    .hud-topright {
      top: max(8px, env(safe-area-inset-top));
    }
    .hud-topleft {
      left: max(8px, env(safe-area-inset-left));
    }
    .hud-topright {
      right: max(8px, env(safe-area-inset-right));
    }
    .info {
      font-size: 11px;
    }
    .info .lap {
      font-size: 12px;
    }
    .touch-controls {
      padding-left: max(10px, env(safe-area-inset-left));
      padding-right: max(10px, env(safe-area-inset-right));
    }
    .tbtn {
      width: 58px;
      height: 58px;
      border-radius: 14px;
    }
    .tbtn.small {
      width: 68px;
      font-size: 11px;
      letter-spacing: 1px;
    }
  }

  /* Short landscape phones: keep the menu usable without clipping. */
  @media (max-height: 560px) {
    .overlay {
      gap: 14px;
      padding: 16px 20px;
      background: rgba(5, 1, 15, 0.8);
    }
    .logo h1 {
      font-size: clamp(34px, 11vh, 64px);
    }
    .tagline {
      margin-top: 8px;
    }
    .btn.primary {
      padding: 12px 30px;
    }
    .overlay footer {
      display: none;
    }
    .help {
      font-size: 12px;
    }
  }
</style>
