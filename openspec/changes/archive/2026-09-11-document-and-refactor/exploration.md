## Exploration: document-and-refactor — ha-status-bot end-to-end discovery

### 1. What the app does

**Purpose**: Home Assistant Supervisor add-on. Runs a long-polling Telegram bot that lets an authorized chat query the state of a home (lights, covers, binary sensors, doors/windows, low batteries, temperatures, cameras) and issue simple commands (turn lights on/off, open/close covers, fetch camera snapshot/video).

**Deployment**: Packaged as an HA add-on — `config.yaml` (add-on manifest, HA Supervisor schema), `repository.yaml` (add-on store metadata), `Dockerfile` (node:20-alpine, `npm install --omit=dev`, `CMD ["node","src/index.js"]`). `homeassistant_api: true` in config.yaml tells the Supervisor to inject `SUPERVISOR_TOKEN` for authenticating against `http://supervisor/core/api`.

**Entry point / lifecycle**: `src/index.js` `main()` — reads `/data/options.json` (or `$OPTIONS_PATH` override), validates `telegram_token`, builds `allowedChatIds`, constructs an HA client, constructs and starts the Telegram bot (long polling), logs a startup message, then returns. There is no supervising loop, no shutdown hook, no crash-restart logic beyond process exit on `main()` rejection.

**Runtime deps**: only `node-telegram-bot-api` (^0.66.0). HA REST calls use Node 20's native `fetch`.

### 2. Module map (file:line-count, responsibility, collaborators)

| File | Lines | Responsibility | Exports | Collaborators |
|---|---|---|---|---|
| `src/index.js` | 66 | Bootstrap: load options, parse config, wire HA client + Telegram bot | none (script) | `haClient.js`, `telegram.js` |
| `src/haClient.js` | 222 | HA REST adapter: states, service calls, camera snapshot/record with retry/fallback, generic media file fetch with candidate-path fallback | `createHomeAssistantClient` | `fetch` (global), consumed by `index.js`, `telegram.js` |
| `src/formatter.js` | 202 | Pure functions: filter/derive/format entity lists (lights, covers, cameras, binary sensors, doors/windows, low batteries, temperatures) into Telegram-ready text | 12 functions (`getLightsOn`, `getAllLights`, `getAllCovers`, `getAllCameras`, `getActiveBinarySensors`, `getOpenDoorsAndWindows`, `getLowBatteries`, `getTemperatures`, `formatLights`, `formatSensors`, `formatDoors`, `formatBatteries`, `formatTemperatures`, `formatFullStatus`) | none (pure, no I/O) — genuinely hexagonal-friendly domain layer |
| `src/telegram.js` | 582 | Telegram adapter: command registration (`/start /help /chatid /estado /luces /sensores /puertas /bateria /temp /persianas /camaras`), inline-keyboard construction, `callback_query` dispatch (light/cover toggle, camera pick/list/img/vid30), authorization gate, message chunking, media send-with-fallback | `createTelegramBot` | `node-telegram-bot-api`, `formatter.js`, `ha` client passed in |

Data flow: Telegram update → `telegram.js` handler → `isAllowed` gate → `ha.getStates()` (haClient→HA REST) → `formatter.js` pure transform → `bot.sendMessage`/`sendPhoto`/`sendVideo`. Actions (light/cover/camera) go the other way: callback → `ha.callService(...)` → HA REST → re-fetch states → rebuild keyboard.

### 3. Tests (tests/*.test.js, 749 total lines)

| File | Lines | What it actually tests |
|---|---|---|
| `tests/formatter.test.js` | 373 | Imports the REAL `src/formatter.js` exports and exercises them thoroughly against a shared fixture (`STATES`). Good, real coverage of the domain layer. |
| `tests/haClient.test.js` | 238 | Imports the REAL `createHomeAssistantClient`, mocks `globalThis.fetch`. Covers `getStates` (incl. 401 error), `callService`, camera snapshot happy path + proxy-fallback chain, `recordCameraClip`, `getMediaFile` candidate-path fallback. NOT covered: the `cameraSnapshotUnavailableUntil` cooldown throttle branch (haClient.js:90-94), `requestBinary`'s non-OK branch, empty-buffer-after-3-retries exhaustion path. |
| `tests/telegram.test.js` | 79 | **Does NOT import `src/telegram.js` at all.** It re-implements `isAllowed` and a `splitText` copy of `safeReply`'s chunking logic inline in the test file (the file's own comment admits this: "since they're not exported... we re-implement the logic inline"). Zero of `telegram.js`'s 582 lines — including `createTelegramBot`, all command handlers, the `callback_query` dispatcher, authorization enforcement as actually wired, camera flows, error handling — are exercised by any test. These tests will pass even if the real `isAllowed`/`safeReply` diverge from the copies. |
| `tests/index.test.js` | 59 | Same anti-pattern: re-implements `parseAllowedChatIds` inline; does not import `src/index.js`. `loadOptions`, `main`, option validation, the hardcoded token, and the hardcoded `baseUrl` are entirely untested. |

**Verdict**: formatter and haClient have real unit coverage; telegram.js (the largest, most complex file) and index.js (bootstrap, where the two worst defects live) have **zero executable coverage of the real code** — only coverage of hand-copied stand-ins. This is a **testing antipattern (false confidence)**, not just a coverage gap.

### 4. External integrations

**Home Assistant Supervisor/Core REST API** (`src/haClient.js`):
- Auth: `Authorization: Bearer <token>` header on every request. Token is meant to be `SUPERVISOR_TOKEN` (Supervisor-injected env var per `homeassistant_api: true`), but is currently hardcoded (see §6.1).
- Base URL: meant to be `http://supervisor/core/api` (correct value is commented out at index.js:45), currently hardcoded to `http://homeassistant.local:8123/api` (see §6.1) — bypasses the Supervisor proxy entirely.
- Endpoints used: `GET /states`, `POST /services/{domain}/{service}`, `GET /camera_proxy/{entity}` (+ `/api/camera_proxy/{entity}` fallback), arbitrary `/media/...` and `/api/media_proxy/media/...` candidate paths for downloaded snapshots/clips.
- Error handling: non-OK responses throw a typed `Error` with `.status/.path/.method/.body`; camera snapshot/record has bespoke retry (3 attempts, 1200ms sleep) and a 5-minute cooldown cache (`cameraSnapshotUnavailableUntil`) once retries are exhausted for an entity. No generic retry/backoff for `getStates()` or `callService()` — a transient 5xx on `/states` propagates straight to the Telegram error message.
- Rate limits: none enforced or handled; HA itself has none for local REST calls typically, so this is low risk but undocumented.

**Telegram Bot API** (`node-telegram-bot-api`, `src/telegram.js`):
- Auth: bot token from add-on option `telegram_token`, long-polling mode (`autoStart: false` then explicit `deleteWebHook` + `startPolling`).
- Authorization model: `isAllowed(chatId, allowedChatIds)` — allow-list of chat IDs from `allowed_chat_ids` option; empty list = allow all (documented in README, matches config.yaml default `""`). `/start`, `/help`, `/chatid` are **not** gated by `isAllowed` (by design for `/chatid`, inconsistently for `/start`/`/help` — see §6).
- Error handling: `polling_error` listener logs only, no reconnect/backoff logic beyond the library's own; every command handler wraps HA calls in try/catch and replies with `Error consultando Home Assistant: ${error.message}` (leaks raw upstream error text to the end user, including internal `.body` details when the underlying `Error.message` includes them from `buildApiError`).
- Message-size handling: `safeReply` chunks any text over 3900 chars (Telegram's real limit is 4096) — magic number, no shared constant with HA's 4096.

### 5. Configuration surface — read vs dead

| Source | Field | Read by code? | Where |
|---|---|---|---|
| `config.yaml` options | `telegram_token` | ✅ | `index.js:28` |
| `config.yaml` options | `allowed_chat_ids` | ✅ | `index.js:29` |
| `config.yaml` options | `low_battery_threshold` | ✅ | `index.js:30` |
| `config.yaml` | `homeassistant_api: true` | ⚠️ Declared but effectively **ignored** — the code no longer reads `SUPERVISOR_TOKEN` (hardcoded instead), so the Supervisor's whole reason for injecting this env var is currently dead in practice. | `index.js:39,45,49` |
| env | `OPTIONS_PATH` | ✅ (undocumented in README) | `index.js:6` |
| env | `SUPERVISOR_TOKEN` | ❌ commented out, replaced by hardcoded literal | `index.js:39` |
| `debug-options.json` (gitignored, present on disk locally) | `telegram_token`, `allowed_chat_ids`, `low_battery_threshold` | Consumed indirectly only if `OPTIONS_PATH` points at it; not referenced anywhere in code or README | repo root |
| hardcoded `baseUrl` | `"http://homeassistant.local:8123/api"` | Not sourced from any option/env — should be configurable or default to the Supervisor proxy | `index.js:49` |

No genuinely dead add-on options were found — all three declared `options` are consumed. The real problem is the opposite: two **security-relevant config paths that exist and are correct in the manifest are being silently bypassed by hardcoded values in code.**

### 6. Antipattern & defect inventory (ranked, with fix-cost estimates against the 400-line review budget)

**CRITICAL**

1. **Hardcoded Supervisor JWT** at `src/index.js:39`, with `process.env.SUPERVISOR_TOKEN` commented out inline. Confirmed present in the current working tree (uncommitted per `git status`). This is a live credential checked into a script that would be committed/pushed if not caught. Fix: restore `process.env.SUPERVISOR_TOKEN`. Cost: ~3 changed lines. Also recommend rotating the token regardless, since it may have been exposed to any process/log that read this file.
2. **Hardcoded HA base URL** at `src/index.js:49` (`http://homeassistant.local:8123/api`), with the correct Supervisor proxy URL `http://supervisor/core/api` commented out at line 45 and unused. Combined with #1, this reroutes all HA traffic away from the Supervisor's authenticated proxy to a raw mDNS hostname/port — wrong for an add-on, non-portable, and defeats the purpose of `homeassistant_api: true`. Fix: restore supervisor URL, ideally as a small config default rather than a literal. Cost: ~5 changed lines (combine with #1 fix).
3. **Real secret material on disk**: `debug-options.json` (gitignored, so not tracked, but physically present in the working directory) contains what appears to be a live Telegram bot token and a real chat ID in plaintext. Not verifiable from this read-only exploration whether it was ever committed before the `.gitignore` rule was added (no shell/git-log access available in this phase) — flagged for the user to check `git log --all --follow -- debug-options.json` and rotate the token if any doubt exists. Not a code-line fix; an operational action item.

**HIGH**

4. **God-object adapter**: `src/telegram.js` (582 lines) mixes transport (Telegram SDK wiring), authorization, HA domain calls, keyboard-building/UI, retry/polling loops for media, and error formatting in one file with no application/use-case seam — a hexagonal-architecture violation (the only genuinely clean module is `formatter.js`, which is pure). Estimated extraction cost (command router + keyboard builders + camera use-case module): **150–250 changed lines** — exceeds the 400-line single-PR budget when combined with anything else; should be its own slice.
5. **Duplicated authorization+fetch+keyboard boilerplate**: `/luces` (telegram.js:258-297), `/persianas` (321-361), `/camaras` (363-390) each independently repeat `isAllowed` check → `ha.getStates()` → build/send keyboard → try/catch → error message, instead of sharing a helper. The lights/covers keyboard-building logic is additionally duplicated a second time inside the `callback_query` "refresh after action" block (529-563) — 4 near-identical keyboard builders total (2 initial + 2 refresh). Fix cost: ~60–100 changed lines.
6. **Unvalidated, attacker-influenceable `entity_id` in privileged calls**: in the `callback_query` handler, `entityId` is parsed directly from `query.data` (telegram.js:394-395) and passed straight to `ha.callService("light"/"cover", ...)` (406-421) and to `ha.getCameraSnapshot`/`recordCameraClip` (463-497) **without verifying it belongs to the previously-fetched light/cover/camera list**. Any chat already inside the `allowedChatIds` allow-list (i.e., any client capable of sending arbitrary `callback_data`) can trigger HA service calls or camera snapshot/record actions against arbitrary entity-id strings, not just ones the bot itself offered. This is a missing authorization/validation boundary beyond the chat-id gate. Fix cost: ~20–40 changed lines (membership check before each privileged call).
7. **No process-level safety net**: no `process.on('unhandledRejection')`/`uncaughtException` handler anywhere; `bot.on("polling_error")` only logs; the `bot` instance returned by `createTelegramBot` is discarded at the call site (`index.js:53`), so nothing can call `bot.stopPolling()` on shutdown — no `SIGTERM`/`SIGINT` handling at all, which matters for a Docker/HA-Supervisor-managed process that receives `SIGTERM` on add-on stop/restart/update. Fix cost: ~15–30 changed lines.

**MEDIUM**

8. **Magic numbers/strings scattered with no shared constants**: message chunk size `3900` (telegram.js:24, unrelated to Telegram's real 4096 limit, no comment linking the two); media-wait defaults `45000`/`2500` (telegram.js:74); the literal `30`-second video duration baked into 5+ separate places (default param, UI button label, callback action name `camera_vid30`, filename suffix, caption text) so changing the duration requires touching all of them; HA client retry count `3` and sleep `1200` (haClient.js:137,150); 5-minute cooldown `5*60*1000` (haClient.js:154). Fix cost: ~30–50 changed lines to extract named constants.
9. **Copy-pasted fallback/retry logic**: `getCameraSnapshot` and `getMediaFile` in haClient.js implement near-identical multi-candidate-URL + logging + fallback patterns; `sendPhotoWithFallback`/`sendVideoWithFallback` in telegram.js are near-duplicates differing only by method name/label. Fix cost: ~40–60 changed lines to unify.
10. **Long function / dispatch-by-if-chain**: the `callback_query` handler (telegram.js:392-574) is one ~180-line function handling 8+ action branches with per-branch HA calls, error handling, and UI refresh logic inline — high cyclomatic complexity, hard to test in isolation (consistent with §3's finding that none of it is tested). Fix cost: ~80–120 changed lines to split into a dispatch table of small handlers.
11. **No ports/adapters seam between transport and domain**: `haClient.js` embeds `console.log/warn/error` directly inside the HTTP adapter (no injectable logger port), and `telegram.js` wires the Telegram SDK directly to HA domain calls and formatting with no intermediate application/use-case layer — the only clean boundary in the codebase is `formatter.js` (pure functions, no I/O). A full fix is a design-level refactor, not a quick patch — recommend routing this into `sdd-design` rather than folding it into this change's line budget.
12. **Inconsistent authorization coverage**: `/start` and `/help` respond to any chat without an `isAllowed` check (telegram.js:205-244), while every other command (and callbacks) does check. `/chatid` intentionally has no check (by design, so unauthorized users can discover their own chat_id to request allow-listing) — that one is correct, not a bug. The `/start`/`/help` gap is a minor, low-impact information-disclosure inconsistency (reveals the command list only) but should be normalized either way. Fix cost: ~10 changed lines if desired.

**LOW**

13. **Dockerfile vs README mismatch, and a real drift risk**: the actual `Dockerfile:6` runs `npm install --omit=dev`, but `README.md:149,155` documents (and recommends) `npm ci --omit=dev`. `npm ci` is deterministic against `package-lock.json`; `npm install` is not — this is both a documentation inaccuracy and a real reproducibility defect in the Docker build. Fix cost: 1 line (Dockerfile) or 2 lines (README), pick one direction.
14. **Stale dependency pin**: `package.json` pins `node-telegram-bot-api` to `^0.66.0`. Verified via web search that the upstream package is actively maintained, with `1.2.0` published recently and a from-scratch v2 redesign available — the project is stuck on a `0.x` line (caret range on `0.x.y` only allows patch bumps per npm semver rules) years behind current releases, with a documented v1→v2 migration path available upstream. Not an immediate defect, but a hygiene/upgrade-planning item.
15. **`package.json` hygiene**: no `engines.node` field despite Dockerfile/CI pinning Node 20 (memory-confirmed); no `license` field despite README claiming MIT; no lint/format/type-check tooling configured anywhere (no ESLint/Prettier/tsconfig); no `start` script (Dockerfile calls `node src/index.js` directly, bypassing npm scripts — harmless but inconsistent).
16. **Untracked local artifacts not fully ignored**: `.vscode/` and `.DS_Store` are present as untracked files but not listed in `.gitignore` (only `node_modules/`, `.env`, `debug-options.json` are). Minor hygiene, 2-line `.gitignore` fix.
17. **Dead `if: false` job**: `.github/workflows/bump-version.yml` contains a `tag:` job gated by `if: false` with a comment explaining the real tag creation happens in `create-tag.yml` — this is intentionally-dead leftover scaffolding; either remove the job or replace with a comment-only note (cosmetic, ~5 lines).

### 7. Language inconsistency catalogue (documentation, not necessarily a defect)

| Layer | Language | Examples |
|---|---|---|
| Code identifiers (function/variable names) | English throughout | `getLightsOn`, `isAllowed`, `parseAllowedChatIds`, `createHomeAssistantClient` |
| Code comments | English | `// Refresh the inline keyboard after action`, `// Evita loops largos...` (this one is actually Spanish — see below) |
| Console/log messages | Mixed — English bracket tags (`[Telegram]`, `[HA API]`) + Spanish sentence bodies | `"[Telegram] Comando recibido: ${cmdText} de chat_id=${chatId}"` (telegram.js:180), `"Cargando opciones desde ${optionsPath}..."` (index.js:7) |
| One inline comment | Spanish, inconsistent with the rest of the comment style | `// Evita loops largos: si la cámara no da bytes válidos, pausamos reintentos por 5 min.` (haClient.js:153) — the only Spanish code comment found; every other comment in the codebase is English |
| User-facing Telegram copy | 100% Spanish | `/start` command list, all error replies (`"Error consultando Home Assistant: ..."`), authorization denial (`"No autorizado. Tu chat_id es: ..."`), all button labels |
| Error messages surfaced to users | Spanish wrapper text + raw (often English/technical) `error.message` interpolated in — e.g. `"Home Assistant API error 401: ..."` (haClient.js:7, English) gets embedded inside a Spanish sentence sent to the Telegram user | telegram.js:200, 295, 359, 388 |

Net finding: the split is consistent (identifiers/comments = English, user-facing copy = Spanish) with exactly **one outlier Spanish code comment** (haClient.js:153) and the surfaced-error-text seam where English HTTP error internals leak into Spanish user messages verbatim — worth a documented convention rather than a functional fix.

### 8. Documentation gap analysis (README.md vs code)

| README claim | Reality | Evidence |
|---|---|---|
| "consulta la API REST del Supervisor (`http://supervisor/core/api`)" (README:36) | Code currently hardcodes `http://homeassistant.local:8123/api` instead | `index.js:49` |
| `SUPERVISOR_TOKEN` is "inyectado automáticamente por el Supervisor" and is what auths HA calls (README:135,189) | Code hardcodes a literal token instead of reading the env var | `index.js:39` |
| Dockerfile section shows `npm ci --omit=dev` (README:149) | Actual Dockerfile uses `npm install --omit=dev` | `Dockerfile:6` |
| "callService... Actualmente no se usa desde el bot" (README:219) | `callService` **is** used — every light/cover toggle and every camera snapshot/record call goes through it | `telegram.js:407,411,415,419`, `haClient.js:130,164` |
| No mention of `OPTIONS_PATH` env override or `debug-options.json` | Both exist and are load-bearing for local/dev testing | `index.js:6`, repo root file |
| Comandos disponibles table omits `/start`/`/help` authorization behavior | `/start`/`/help` bypass the `isAllowed` gate that every other command enforces | `telegram.js:205-244` |
| Tests section says "telegram.js: Autorización, partición de mensajes largos y manejo de comandos" (README:313) tested | The test file only re-implements `isAllowed`/chunk-splitting logic inline; it never imports or exercises `src/telegram.js` | `tests/telegram.test.js:1-8` |
| Tests section says "index.js: Carga de opciones y parseo de chat IDs" tested | Same pattern — re-implemented inline, `src/index.js` is never imported | `tests/index.test.js:1-14` |

### Recommendation

Slice the fix work to respect the 400-line review budget:
- **Slice 1 (secrets/config, CRITICAL, ~10-15 lines)**: restore `SUPERVISOR_TOKEN` env read, restore Supervisor base URL, add `.gitignore` hygiene, flag `debug-options.json` for token rotation. Ship first, independently, ask-on-risk given secret exposure.
- **Slice 2 (authorization hardening, HIGH, ~60-100 lines)**: entity membership validation before privileged HA calls, normalize `/start`/`/help` gating, add process-level shutdown/error handlers.
- **Slice 3 (DRY/magic-number cleanup, MEDIUM, ~100-150 lines)**: extract shared keyboard builders, named constants, unify fallback helpers.
- **Slice 4 (test-quality fix, HIGH but test-only, ~100-150 lines)**: rewrite `tests/telegram.test.js` and `tests/index.test.js` to import and exercise the real modules instead of re-implemented copies.
- **Slice 5 (architecture refactor, out of this budget)**: introduce an application/use-case layer between `telegram.js` and `haClient.js`/`formatter.js` — recommend routing through `sdd-design` as a separate, larger effort, not a single PR.
- **Documentation**: rewrite README once Slice 1 lands, so it describes reality rather than the pre-refactor and pre-hardcode state.

### Risks

- `debug-options.json`'s real-looking token could not be confirmed clean/dirty against git history from this read-only phase (no shell/git-log tool access) — recommend the user or a later phase run `git log --all --follow -- debug-options.json` and rotate the token regardless.
- The hardcoded Supervisor JWT is on the *current uncommitted working tree*; if a commit/push happens before Slice 1 lands, it becomes a permanent git-history leak requiring token rotation + history rewrite.
- `src/telegram.js`'s size (582 lines) and lack of real test coverage mean any refactor there carries real regression risk; recommend adding real tests (Slice 4) before or alongside any structural refactor (Slice 5), not after.
- This exploration could not write `openspec/changes/document-and-refactor/exploration.md` to the filesystem — the executing session had no file-write tool available. Full content was persisted to Engram (`sdd/document-and-refactor/explore`) instead; the orchestrator or a subsequent phase with write access should materialize the OpenSpec file from this Engram record to satisfy the hybrid artifact-store contract.

### Ready for Proposal
Yes — scope is clear enough to move to `sdd-propose`. Recommend the proposal explicitly reference the 5-slice breakdown above so `sdd-tasks` can plan chained PRs against the 400-line budget.
