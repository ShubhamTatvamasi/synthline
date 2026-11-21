# SYNTHLINE

**Outrun the horizon.** A synthwave arcade racer for the web — pseudo-3D road, neon
sunset, traffic to thread, and a ghost of your best run to chase.

Built with **Astro + Svelte**, shipped as a static site through **GitHub Actions**,
playable on desktop and mobile with keyboard, gamepad, or touch.

```
▶ https://shubhamtatvamasi.com/synthline/
```

---

## The game

A 3-lap time attack on a closed neon circuit:

- **Pseudo-3D road** — curves, crests, and dips projected with classic outrun-style
  segment math, with fog, hill clipping, and parallax mountains.
- **Traffic** — 30 AI cars that drift between lanes and dodge you. Hit one and you
  lose speed; thread the gap and you're rewarded.
- **Near-miss boost** — skim past traffic to charge the boost meter. Hold boost for
  a 26% top-speed surge with a widened FOV, screen shake, and exhaust flames.
- **Ghost replay** — your best race is recorded and replayed as a translucent ghost
  car, so you can race yourself.
- **Records** — best lap, best race, and the ghost persist in `localStorage`.
- **Everything is procedural** — no image or audio files. Cars, scenery, the sun,
  the synthwave soundtrack, and the engine hum are all generated at runtime with
  Canvas 2D and the Web Audio API.

## Controls

| Action     | Keyboard        | Gamepad            | Touch                    |
| ---------- | --------------- | ------------------ | ------------------------ |
| Steer      | ← → / A D       | Left stick / d-pad | ◀ ▶ pads                 |
| Accelerate | ↑ / W           | RT or A            | automatic                |
| Brake      | ↓ / S           | LT                 | BRAKE button             |
| Boost      | Shift / X       | B or X             | BOOST button             |
| Pause      | Esc / P         | Start              | ❚❚ button (top-left)     |
| Restart    | R               | —                  | menu → RESTART           |
| Mute       | M               | —                  | menu → MUSIC/SFX toggles |

Auto-pauses when the tab loses focus. Touch layout respects safe-area insets.

## Tech stack

| Piece          | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Site framework | [Astro 7](https://astro.build) — static output, one page, zero JS bloat |
| UI / game host | [Svelte 5](https://svelte.dev) island (runes)                          |
| Rendering      | Canvas 2D, segment-based pseudo-3D projection                          |
| Audio          | Web Audio API — look-ahead scheduled synthwave loop + synthesized SFX  |
| Fonts          | Orbitron & Share Tech Mono via Fontsource (self-hosted, SIL OFL)       |
| CI/CD          | GitHub Actions → GitHub Pages (`withastro/action`)                     |

The production bundle is ~220 KB total (fonts included); the game code gzips to
roughly 22 KB. Draw distance adapts at runtime on slower devices, and device pixel
ratio is capped at 2 to keep mobile GPUs happy.

## Run locally

```bash
npm install
npm run dev        # http://localhost:4321/synthline/
npm run check      # type-check (astro check)
npm run build      # production build into dist/
npm run preview    # serve the production build
```

Requires Node 20+ (22 or 24 recommended).

### Project structure

```
src/
├── components/Game.svelte   # UI island: HUD, menus, touch controls, canvas host
├── game/
│   ├── engine.ts            # state machine, physics, laps, traffic AI, ghost
│   ├── render.ts            # pseudo-3D renderer (sky, road, sprites, player)
│   ├── track.ts             # deterministic track + scenery + traffic spawns
│   ├── sprites.ts           # procedural art: cars, palms, pylons, sun, mountains
│   ├── audio.ts             # engine/wind synthesis, music scheduler, SFX
│   ├── input.ts             # keyboard + gamepad + virtual touch input
│   ├── config.ts            # tuning constants and palette
│   ├── types.ts             # shared types
│   └── util.ts              # math/formatting helpers
├── layouts/Layout.astro     # document head, fonts, global styles
└── pages/index.astro        # the single game page
```

For debugging, the game instance is exposed as `window.__synthline`.

## Deploying to GitHub Pages

The workflow at `.github/workflows/deploy.yml` builds and publishes the site on
every push to `main`.

**One-time setup**

1. Push this repository to GitHub.
2. In the repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).

**URL path / repository name**

The page must live under the path configured as `base` in `astro.config.mjs`
(`/synthline` by default), and the GitHub repository name determines that path:

- Repository named **`synthline`** → deployed at `https://shubhamtatvamasi.com/synthline/`
  (or `https://<user>.github.io/synthline/` without a custom domain).
- Using a different repository name (e.g. `race`)? Change one line in
  `astro.config.mjs`:

  ```js
  base: '/race',
  ```

**Custom domain**

The site is configured for `https://shubhamtatvamasi.com`. If the project page
needs its own subdomain instead, add a `public/CNAME` file with that hostname and
set `base: '/'` in `astro.config.mjs`.

## Credits

- The segment-based pseudo-3D projection technique follows the approach
  popularized by [Jake Gordon's javascript-racer](https://github.com/jakesgordon/javascript-racer) (MIT).
- Orbitron by Matt McInerney and Share Tech Mono by Carrois Apostrophe, via
  [Fontsource](https://fontsource.org).

## License

[MIT](./LICENSE) © Shubham Tatvamasi
