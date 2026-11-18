# CLAUDE.md — notes for AI assistants working on this repo

> 給 AI 看的架構說明。人類玩家／設計者請看 `README.md`（怎麼執行、怎麼調參數）與 `docs/GDD.md`（遊戲規則）。
> Keep this file up to date whenever the architecture, invariants or workflow change.

## What this is
A real-time (pausable, 1×/2×/5×) 2D hex-map nation strategy game (SLG), inspired by Hearts of Iron 4 / WorldBox.
Single player vs rule-based AI, and lockstep multiplayer (≤4 nations incl. AI).
Stack: TypeScript, Vite, PixiJS 8 (map), React 19 (UI), Vitest, Node `ws` relay server.
All player-facing text is **Traditional Chinese (zh-Hant)**; keep it that way. Code/comments are English.

## Commands
```bash
npm run dev        # Vite dev server :5173
npm run server     # multiplayer relay :8787 (node runs server/server.ts directly via type stripping, Node >= 22.18)
npm run serve      # build + relay that also serves dist/ (production)
npm test           # vitest (tests/**/*.test.ts) — must stay green
npm run typecheck  # tsc --noEmit (includes src, tests, server)
npm run build
```

## Golden rules (do not break)
1. **The simulation (`src/sim/**`) is deterministic.** Same seed + same command stream ⇒ identical state on every machine. This is what lockstep multiplayer relies on.
   - Never use `Math.random()`, `Date`, `performance.now()`, or iteration over unordered/unstable sources in `src/sim`. Use `nextRandom(state)` / `Rng` from `src/sim/rng.ts` (state.rngState is part of the state).
   - Avoid `Math.sin/cos/exp/pow` with non-integer results in sim (cross-platform float differences). Map gen uses only + − × ÷.
   - Break ties explicitly (`|| a.id - b.id`, `|| a - b`) whenever sorting.
   - Module-level caches are allowed only if they are pure functions of state (see `getModifiers` WeakMap, `territory.ts` signature cache).
2. **Every state change made by a player or AI goes through a `Command`** (`src/sim/commands.ts`): `validateCommand` (returns zh-Hant error or null) + `applyCommand`. AI uses the exact same commands (`src/sim/ai/ai.ts`). Never mutate state from UI code.
3. **`src/sim` must not import from `src/client`, `src/ui`, `src/net`, or DOM/Pixi/React.** UI reads state, never writes it.
4. **Balance numbers live in `src/sim/data/*.json`**, not in code. Tests should read values from `BALANCE`/`BUILDINGS` rather than hard-coding them.
5. Tech/policy effects go through `src/sim/modifiers.ts` (`getModifiers(player)`); don't special-case tech ids in systems.
6. After any change: `npm run typecheck && npm test`. For UI changes also run the game in Chromium (see "Browser testing").

## Layout
```
src/sim/                 deterministic simulation (no DOM)
  types.ts               GameState, Player, Villager, Building, Relation, orders… (single source of truth for state shape)
  game.ts                createGame(setup), stepGame(state, cmds) (one tick), applyCommands (paused)
  commands.ts            Command union, validateCommand, validatePlacement, applyCommand, diplomacy actions, startPlayer
  data/*.json + index.ts balance, terrain, buildings, tech, policies + their TS types (BALANCE, TERRAIN, BUILDINGS, TECHS, POLICY_GROUPS)
  modifiers.ts           DEFAULT_MODIFIERS + getModifiers(player): sums tech/policy `effects`
  economy.ts             rates: gather/building/research per worker, incomePerMinute (incl. trade), canAfford/pay, workEfficiency
  hex.ts                 pointy-top hexes, "odd-r" offset; tile index = row*width+col; neighbors (dir order E,NE,NW,W,SW,SE), hexDistance, tilesInRadius
  mapgen.ts              value-noise continent map from seed (+ fine 'grove' noise → scattered forests; GROVE_THRESHOLD)
  pathfinding.ts         A* over land, moveCost from terrain
  rng.ts                 mulberry32
  state.ts               logEvent, newVillager, getPlayer, secondsToTicks, maxVillagerHp
  systems/               one file per per-tick system (see tick order)
  ai/start.ts            chooseAIStarts (after all humans picked)
  ai/ai.ts               Brain: diplomacy → research → military(+war: defend, rally at border, attack nearest known target / enemy capital) → economy (rebalance, expansion by newLand score); runs every BALANCE.ai.thinkEverySeconds, staggered per player
src/client/
  controller.ts          GameController: real time → ticks, command queue, speed, selection (villager/tile/group), newGame(options)
  net.ts                 NetClient (lobby/WebSocket) + NetGameController (overrides issue/update/setSpeed; driven by server 'step')
  renderer.ts            PixiJS MapRenderer: tile layer cached by state.mapVersion; units/buildings/overlay redrawn per frame
  audio.ts               music playlists (public/audio/music, CC0, see public/audio/CREDITS.md) + Web Audio synthesized SFX; client-only
  log.ts                 MessageLog: client-side history (events of the local player + chat), capped at 500
src/ui/describe.ts       villagerStatus / activityIcon (also used by renderer icons and the units-on-tile list)
src/ui/ChatLog.tsx       bottom-left log; Enter opens history + input; chat via controller.sendChat (net: {t:'chat'} through server)
src/ui/Sound.tsx         useGameAudio(controller): SFX via controller.onIssue + relation-status watcher, music mood; SoundButton
src/net/protocol.ts      ClientMessage/ServerMessage types, NATIONS, constants
src/net/hash.ts          stateHash(state) — FNV-1a of a state summary (desync detection)
src/ui/                  React: Root (menu/lobby) → Game (App.tsx) + panels (Research, Diplomacy, EndOverlay), describe.ts (status text)
server/server.ts         relay + static hosting; duplicates a few constants from protocol.ts (keep in sync!)
tests/                   vitest; tests/helpers.ts has startAt/run/ok/addBuilding/freeTile/exploreAll
docs/GDD.md              game design doc (zh-Hant) — update it when rules change
```

## Tick order (`stepGame`)
1. apply commands (in given order) → if phase !== 'playing' stop here (no tick advance)
2. `state.tick++`
3. `runJobs` (movement + orders: explore/gather/construct/work/train/garrison/attack)
4. `runCombat` (same-tile, at-war only; damage accumulated then applied simultaneously)
5. `updateTerritory` (recomputes only if territory-building signature changed)
6. `runFood` → `runPopulation` → `runResearch` → `runLoyalty` (1/s) → `runDiplomacy` (1/s) → `runAI` → `runVictory` (1/s)
7. `updateTerritory` again, `updateVision`

Phases: `choosingStart` → `playing` → `ended` (`state.result`). AI picks starts when every human has a start (`applyCommand` chooseStart / playerLeft).

## Key game rules encoded in code (see GDD for full list)
- Knowledge per player: `knowledge[i]` 0 Unknown (land/water only) / 1 Explored; `visible[i]` derived each tick. Territory is always visible.
- Territory = land tiles within `territoryRadius` of *active* territory buildings; each building first holds its own tile, then first-come by building id. Territory signature includes owner (captures trigger a recompute). Watchtowers are active only while garrisoned (`isActive`).
- Placement rules: `validatePlacement` (territory: connected / near / foreign). `connectsToTerritory` enforces contiguous territory.
- Population grows only if `populationBlocked` is null (cap from camp+houses; food protection: income ≥ consumption + newcomer).
- Soldiers: level ≥ 2, cannot gather/work/build/train. Training is uninterruptible once paid.
- Loyalty decays when unsupervised; defection = subverted by nearest foreign territory within range, else leaves.
- Diplomacy statuses: none → establishing (deadline; both consulates needed) → allied; war; cooldowns. `setStatus` keeps `player.atWar` in sync and removes consulates on none/war.
- While allied (both consulates built), `shareExploration` merges both nations' `knowledge` every second (and once when becoming allied). Knowledge is never reset, so it survives a break-up. Consulates give their owner vision (`visionRadius` 2).
- Combat only between nations with relation status `war`; `attack` command refuses tiles of nations not at war.
- Support: a stationary soldier with no enemy on its tile hits an enemy on an adjacent tile where its nation is fighting (own unit/building present), at `combat.supportDamageMultiplier`; supporters are not hit back.
- Capture: a complete building with `capturable` that drops to 0 HP changes owner (HP → `captureHpShare`); others are destroyed and plundered. Jobs check `b.owner === v.owner` so former owners stop working there.
- Elimination: no villagers or no complete territory building. Victory: conquest / territory share / time limit (score `nationScore`).

## How to add things
- **Balance tweak**: edit JSON only.
- **New tech/policy**: add to `tech.json`/`policies.json`; effects must be keys of `DEFAULT_MODIFIERS`. New effect key ⇒ add default in `modifiers.ts` and apply it where relevant.
- **New building**: add to `buildings.json` (all fields incl. `hp`, `trainingSlots`, `garrisonSlots`), draw it in `renderer.ts` `drawBuilding`, add special behavior in systems if needed, maybe AI usage in `ai.ts`. `BuildingType` is derived from the JSON keys.
  - Production scaling is data-driven in `economy.buildingRatePerWorker`: `rateModifier` (modifier key), `freshWaterBonus`, `nonStoneMultiplier`, `nonForestMultiplier`, `forestAdjacencyBonus`. Placement restrictions: `placement`, `forbiddenTerrain`, `territory`, `maxOutsideDistance`. Prefer adding a generic field over `b.type === '…'` checks.
- **New command**: add to the `Command` union, handle in `validateCommand` + `applyCommand` (TS exhaustiveness will flag switches), expose in UI via `controller.issue(...)`, consider AI usage, add tests. Server forwards any command whose `player` matches the sender (except `playerLeft`, which only the server may send).
- **New villager order**: add to `VillagerOrder` in `types.ts`, handle in `systems/jobs.ts`, status text in `ui/describe.ts`.
- **New per-tick system**: new file in `systems/`, call it from `stepGame` in a deliberate position; keep it deterministic; throttle to 1/s with `state.tick % BALANCE.ticksPerSecond === 0` if heavy.
- **New state field**: add to `types.ts`, initialize in `createGame` (and `newVillager`/building creation), include in `net/hash.ts` if it matters for sync.

## Multiplayer (lockstep)
- Server is a dumb relay: every 100 ms it broadcasts `{t:'step', frame, n: speed, cmds}`; clients run `stepGame` n times (or `applyCommands` if n=0). Clients never advance time on their own.
- Clients send `{t:'hash'}` every 50 frames; mismatch ⇒ server broadcasts `desync` ⇒ red banner in UI. If you add state that can diverge, add it to `stateHash`.
- Disconnect after start ⇒ server injects `{type:'playerLeft'}` ⇒ that nation becomes AI.
- Client-side validation happens before sending; the authoritative check happens when the step is applied (errors for own commands surface via `lastError`).
- Single-player `GameController` applies queued commands at the next tick; commands validated against the *current* state (a command depending on a not-yet-applied one, e.g. setSoldier then garrison in the same 100 ms, is rejected — scripts must wait a tick).

## Testing
- `tests/sim.test.ts` (M1), `m2`…`m5` (feature rules), `wood.test.ts` (wood availability across seeds, lumber camp), `net.test.ts` (real server on port 0 + two headless peers; checks per-frame hash equality and AI takeover).
- Use helpers in `tests/helpers.ts`. Tests that mutate `BALANCE` must restore it (see `m5.test.ts` afterEach).
- AI balance check (not committed): write a temporary test that runs 3 AIs (+ an idle human) for 60 min on a few seeds and logs land share / pop / soldiers / towers / houses / relations every 15 min. Last tuning: top AI ≈ 20–37% land at 30 min; territory victory around 32–45 min when the human does nothing. Delete the test afterwards.

## Browser testing
- Chromium + Playwright are preinstalled in the cloud environment (`require('playwright')`, no install).
- In dev builds the current controller is exposed as `window.__game` (state, issue, select, setSpeed, localPlayer). Flow: main menu → "單人遊戲（對 AI）" → start overlay → select land tile → "在此建國".
- Commands are applied on the next tick; wait ~200 ms between dependent commands in scripts.

## Known limitations / TODO ideas
- No save/load. No unit formations or box selection on the map (group select via list only).
- AI is rule-based and can stall on maps without stone (fallback: weak mine on any land).
- Building jobs (farm/mine/lumber) never deplete, so workers never go idle on their own; the AI's `rebalance()` pulls one worker per think for houses, unattended sites, missing wood producers or big surpluses. Keep that in mind when adding new infinite jobs.
- Validation of stale/queued commands (see above). Lobby has no reconnect.
- `server/server.ts` duplicates `NATIONS`/constants from `src/net/protocol.ts` so it runs with plain `node`; keep both in sync.

## Chat
- Chat is **not** part of the simulation (no Command): `GameController.sendChat` adds locally; `NetGameController.sendChat` sends `{t:'chat'}`, the server trims/limits (120 chars) and broadcasts `{t:'chat', player, text}` to everyone incl. the sender.
- Global keyboard shortcuts must ignore events whose target is an INPUT/TEXTAREA (see `Game` onKey and `ChatLog`).

## Audio
- Never play sounds from `src/sim`. UI hooks: `GameController.onIssue(cmd, error)` (set by `useGameAudio`) and a 250 ms watcher on the local player's relations.
- Browsers need a user gesture first: `audio.unlock()` is called from the menu buttons.
- New music: add files to `public/audio/music/`, list them in `PLAYLISTS` in `audio.ts`, and credit them in `public/audio/CREDITS.md` (prefer CC0). Re-encode to ~128 kbps (`ffmpeg -i in.mp3 -map_metadata -1 -b:a 128k out.mp3`) to keep the repo small.

## Conventions
- Commit messages: imperative summary + bullet list; development branch per session as instructed by the environment.
- Update `docs/GDD.md` (rules), `README.md` (how to run/tune) and this file when relevant.
- Keep UI strings zh-Hant; error messages returned by `validateCommand` are shown to players verbatim.
