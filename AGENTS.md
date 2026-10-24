# AGENTS.md

Guidance for agent sessions working in this repository.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | `tsc --noEmit` + production build into `dist/` |
| `npm run typecheck` | strict TypeScript check only |
| `npm test` | vitest unit tests for the pure logic modules |
| `npm run smoke` | end-to-end test in real Chrome (needs `npm run build` first) |

Always run `npm run typecheck && npm test`. Also run `npm run smoke` for anything touching
gameplay, rendering, input, balance or the HUD — it drives a real browser through boot, combat
pacing, pause, HiDPI, loot rules and boss phases, and fails on any console/page error. Screenshots
land in `screenshots/` (gitignored).

## Release and commit conventions

- **One commit per change, and it carries the version bump itself. Never add a separate
  `chore: release ...` commit.**
- Which bump a change gets:

  | Change | Bump | Subject shape |
  | --- | --- | --- |
  | New content the player can meet or pick: enemy, weapon, passive, scene, mechanic | minor | `feat: add <content> (vX.Y.0)` |
  | Defect fix in shipped behaviour | patch | `fix: <what was wrong> (vX.Y.Z)` |
  | Retuning existing numbers, docs, tooling, tests, cosmetics — no new content | none | `chore: retune <thing>` |

  A fix to something that was never released (a defect inside an unreleased feature committed in the
  same batch) is folded into that feature's commit and the message describes the feature, not the fix.
  When a batch mixes a feature with tuning, the feature decides the bump and the body mentions the
  tuning briefly.
- Release flow:

  ```bash
  npm version minor --no-git-tag-version    # or patch for a fix-only commit
  npm run typecheck && npm test && npm run smoke
  git add -A && git commit -m "feat: <what> (vX.Y.0)" && git push
  ```

- The version shown in the page corner is read from `package.json` via the `__APP_VERSION__` Vite
  define, so bumping the version is the only step needed for the label to follow.
- Conventional commit prefixes (`feat:`, `fix:`, `chore:`), imperative subject, and for fixes a body
  that explains the root cause.
- `node_modules/`, `dist/`, `screenshots/` and secret-ish files (`.env*`, `*.pem`, `*.key`, `*.log`,
  `.npmrc`) are gitignored — keep them out of commits.

## Architecture map

- `src/config.ts` — world size, palette, depth order and every gameplay/balance constant.
- `src/core/` — Phaser-free infrastructure: `rng`, `grid` (spatial hash), `pool` (sprite/text
  pools), `textures` (runtime glyph/grid generation), `audio` (WebAudio synth), `state` (shared HUD
  object + event bus), `records` (localStorage), `hidpi` (device pixel ratio helpers), `types`.
- `src/data/` — pure data and curves for weapons, enemies and passives. No Phaser imports; unit
  tested.
- `src/systems/` — `progression` (xp curve, upgrade draw/apply — pure), `loot` (orb homing/damping,
  simulated in unit tests), `fx` (particles, floaters).
- `src/scenes/` — `BootScene` (generates every texture), `MenuScene`, `CodexScene` (in-game codex that
  renders straight from `data/`, so `desc` fields must stay populated), `GameScene` (the simulation),
  `UIScene` (HUD, upgrade panel, pause/game over overlays).
- `scripts/smoke.mjs` — the end-to-end browser test.

## Invariants that are easy to regress

- **No external assets.** Every glyph, grid tile and glow is drawn on Canvas2D at boot, the tab icon
  is rendered to a data url the same way, and all sound is WebAudio oscillators.
- **HiDPI.** Canvas backing store is `devicePixelRatio` × CSS size (capped at 2). Textures are
  generated at `DPR`, sprites must be drawn at `TEX_SCALE = 1/DPR`, cameras use `zoom = DPR`, and
  text objects need `setResolution(DPR)`. Keep WebGL MSAA off (`antialiasGL: false`): the 2×
  supersample is the anti-aliasing, and enabling MSAA dropped the target Intel iGPU from 60 to
  23 fps at 2880×1800.
- **Glowing text needs padding.** Phaser sizes a `Text` canvas as the measured text plus its
  `padding`, and ignores `shadowBlur`, so any `setShadow(...)` glow is clipped unless the style sets
  padding at least as large as the blur (and the position is offset by that padding when the origin
  is not centred).
- **Keyboard input must use the event API** (`keyboard.on('keydown-P', ...)`), never
  `Phaser.Input.Keyboard.JustDown`: Phaser clears `_justDown` on keyup, so a fast tap is invisible to
  polling.
- **XP orbs stay where a bug dies.** Only orbs inside `pickupRadius` may move, and their homing
  speed must always beat the player's (`PLAYER.magnetCatchUp`) or a running player outruns loot that
  already entered the ring. Unpicked orbs expire (`ORB.lifetime` / `ORB.bigLifetime`) and blink for
  `ORB.blinkTime` beforehand, so the field cannot fill up permanently.
- **Ring weapons (paren shield, recursive clone)** take their angles from `ringSlotAngles(count,
  phase)` driven by one shared phase per weapon. Never seed an angle from the count at creation
  time — that desynchronises the ring whenever the count grows.
- **Boss entrances are cutscenes.** `spawnBoss` hands control to `entrance` (see `ENTRANCE` in
  config.ts) which freezes the whole simulation, pans the camera to the spawn point, materialises
  the boss and sweeps an EMP ring that purges every dropped orb and normal bug, then pans back and
  restores follow. Nothing may move the sim forward while `entrance` is set.
- **Boss fights are arena mode.** While `activeBoss` is set the spawner is skipped, so only the
  boss and its minions exist; minions are marked `summoned` and `killEnemy` must not drop loot for
  them. Loot therefore stays empty for the whole fight, and the smoke test asserts exactly that.
- **Weapons engage inside `SPAWN.engageRange`.** Sniping across the screen strands loot far from the
  player and starves progression.
- Balance knobs live in `xpForLevel` (`systems/progression.ts`, pacing) and `SPAWN.*` / `PLAYER.*`
  (`config.ts`, pressure). Change them based on measurements, not feel.

## Debug hooks

- `window.__hud` — live HUD state (`hp`, `level`, `xp`, `kills`, `orbs`, `boss`, `choices`, …); the
  smoke test asserts against it.
- `?skip=<seconds>` — starts a run already progressed, granting the build a real run would have and
  keeping the natural boss schedule. Used by the smoke test for late-game and boss scenarios.
- `?orbLife=<seconds>` — shortens the dropped-loot lifetime so expiry is testable in seconds.
- `window.__menu` — `{ marchers, particles }` for the menu's background swarm, so the smoke test can
  tell whether the animation is actually running.
- `window.__codex` — the open codex page (`{ page, pageIndex, entries }`) or undefined when closed;
  set by `CodexScene` so the smoke test can assert the codex renders every entry.

## Style

- No comments in source files.
- Strict TypeScript with `noUnusedLocals` / `noUnusedParameters` enabled.
- Naming: `PascalCase.ts` for scenes and classes, lowercase single words for `core` / `data` /
  `systems` modules, `camelCase` for functions and variables.
