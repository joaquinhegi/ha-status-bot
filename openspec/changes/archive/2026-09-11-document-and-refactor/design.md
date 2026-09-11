# Design: Document and Refactor ha-status-bot

## Revision note

This document was revised after the user rejected the two new source modules the previous version proposed (`src/config.js`, `src/messages.js`).

**New binding constraint: zero new files under `src/`.** Every production change lands inside the four existing modules — `src/index.js`, `src/haClient.js`, `src/telegram.js`, `src/formatter.js`. Files under `tests/` may still be created or rewritten; a devDependency in `package.json` is not a source file. This extends the earlier "no architecture refactor" decision: `src/telegram.js` stays one ~582-line module, and "no new modules" now also covers flat constant and config modules.

| Prior decision | Status in this revision |
|---|---|
| 1 — Testability seam | **Kept unchanged.** It never needed a new file. |
| 2 — Configuration hardening | **Intent kept, vehicle changed.** `loadConfig()` becomes a function inside `src/index.js`. The protective boundary is now the function, not the file. See Decision 2 for what protection that loses. |
| 3 — `src/messages.js` | **Dropped.** User-facing copy stays inline. Replaced by a different decision with the same delivery goal (Decision 3). |
| 4, 5, 6, 7 | **Kept.** |

Three further corrections came out of re-measuring the real source against the plan:

1. The "~582-line single-file diff" framing for the English normalization of `src/telegram.js` was pessimistic by roughly 2.6×. The targeted edit touches ~113 lines, not 582. Evidence and the resulting slicing recommendation are in *Delivery units and binding order*.
2. The previous unit 2 was under-estimated (~350) and actually forecasts ~600 changed lines. It is split into 2a/2b, and the `bootstrap` export moves earlier into unit 1b, where the entrypoint guard it depends on already has to land.
3. `localeCompare(…, "es")` should **stay** `"es"`. The previous version called for making it locale-neutral; that is a silent behavior change to sorting, and collation is a property of the data (Spanish-language Home Assistant entity names), not of the interface language. See Decision 3 and Open Questions.

## Technical Approach

Keep every module where it is. Change what each module **accepts**, not what it **is**.

The whole design rests on one observation: `createTelegramBot({ token, allowedChatIds, lowBatteryThreshold, ha })` at `src/telegram.js:160` is *already* a dependency-injecting factory — `ha` is injected and `formatter.js` is pure. Exactly one hard-wired dependency blocks testing: `new TelegramBot(token, …)` at `src/telegram.js:166`, plus the fire-and-forget `deleteWebHook().then(startPolling)` at `:172-175`. Inject that one construction and 582 lines become testable with no restructuring.

The same move fixes the secret incident, but with a weaker lever than before. Configuration currently lives loose inside `main()` (`src/index.js:25-58`), so overwriting an env read with a literal was a one-line edit at the call site. Under the zero-new-files constraint the fix is a `loadConfig()` function inside `src/index.js` that owns every `process.env` and filesystem read and returns a frozen object. That still removes the convenient place to paste a literal, but it no longer moves the temptation into a different file. Decision 2 states plainly what is lost.

**Explicitly rejected, per the approved non-goals**: no ports/adapters seam, no use-case layer, no command-router extraction, no split of `src/telegram.js`, and now no new source module of any kind. Where a layered or extracted design would be the textbook answer (decisions 1, 2, 3, 5), this design uses parameter injection, function-scoped boundaries, and test-side decoupling instead, and says so each time.

## Architecture Decisions

### Decision 1 — Testability seam: inject the bot constructor, keep the module whole

**Choice**: add two optional parameters to the existing factory: `createBot` (default `(token) => new TelegramBot(token, { polling: { autoStart: false } })`) and `logger` (default `console`). Tests pass a `FakeTelegramBot` from `tests/helpers/fakeTelegramBot.js` that records `onText(regex, handler)` / `on(event, handler)` registrations and every `sendMessage` / `editMessageText` / `editMessageReplyMarkup` / `sendPhoto` / `sendVideo` / `sendDocument` / `answerCallbackQuery` call, resolves `deleteWebHook()`, and no-ops `startPolling()`. A test then does `fake.emitText("/lights", { chat: { id: 1 } })` and the **real** handler body runs against a fake `ha`.

Handler registration is synchronous, so tests need no await to drive commands; only assertions about polling startup await `fake.deleteWebHookPromise`. Nothing new is exported from `src/telegram.js`; `isAllowed`, `safeReply`, and the keyboard builders stay private and are covered *through* the public entry point.

`src/index.js` gets the mirror treatment: `main()` becomes exported `bootstrap({ config, createHaClient, startBot, logger })` with real defaults, and the self-invocation at `:63` moves behind an entrypoint guard (`pathToFileURL(process.argv[1]).href === import.meta.url`) so importing the module no longer starts a bot. `Dockerfile`'s `CMD ["node","src/index.js"]` keeps working unchanged.

`tests/helpers/fakeTelegramBot.js` is a new **test** file, which the constraint permits. It sits outside the `tests/*.test.js` glob so the runner does not collect it as a suite.

| Alternative | Why rejected |
|---|---|
| Export the private helpers and unit-test them | This is the current failure in disguise: it tests helpers in isolation and leaves the wiring — where the authorization defects actually live — uncovered. `tests/telegram.test.js:4-6` documents the repo already doing exactly this. |
| `mock.module()` to stub `node-telegram-bot-api` | Experimental and not stable on Node 20; CI pins Node 20 (`.github/workflows/tests.yml`). |
| Monkey-patch `TelegramBot.prototype` | Leaks global state across test files and still opens a socket on construction. |
| Live test bot over the network | Needs a real token in CI and is non-deterministic. |
| Extract a command-router / use-case layer | The approved hard non-goal. |

**Rationale**: one optional parameter per module buys full behavioral coverage of the two uncovered files. The seam was 90% present already; the old tests re-implement `isAllowed` and the chunking logic inline (`tests/telegram.test.js:10-15,39-48`) because nobody closed the last 10%.

### Decision 2 — Configuration: one validated `loadConfig()` function inside `src/index.js`

**Choice**: `src/index.js` exports `loadConfig({ env = process.env, readFile } = {})`, returning a deep-frozen object:

```js
{
  telegram:      { token, allowedChatIds: [/* strings */] },
  homeAssistant: { baseUrl, token },
  thresholds:    { lowBattery },
}
```

`parseAllowedChatIds` (`src/index.js:14`) and `loadOptions` (`:5-12`) fold into it. `HA_DEFAULT_BASE_URL = "http://supervisor/core/api"` becomes a module-level named constant in the same file. The HA token comes from `requireEnv(env, "SUPERVISOR_TOKEN")`, which throws a message naming `homeassistant_api: true`. Validation is a single table walked once — missing required value, wrong type, or out-of-range threshold all fail at startup with the option name in the message, never at first use.

`bootstrap` accepts `config` and never a raw token, so the use site reads `token: config.homeAssistant.token`.

**What this vehicle keeps, and what it loses.** The honest accounting matters, because a function boundary is genuinely weaker than a file boundary:

| Protection | Separate `src/config.js` | `loadConfig()` in `src/index.js` |
|---|---|---|
| Hardcoding a literal requires editing code that exists only to source values from the environment | Yes | Yes |
| A direct test asserts the value came from injected `env` and that absence throws | Yes | Yes |
| Post-hoc mutation (`config.homeAssistant.token = …`) throws | Yes (frozen) | Yes (frozen) |
| The incident's exact edit (`src/index.js:39`) lands in a *different* file from the one being edited under deadline pressure | Yes | **No** — same file, ~30 lines away |
| `git diff --stat` shows a config-only file changing, which is a standalone review signal | Yes | **No** — the signal is diluted into `src/index.js`, which changes for many reasons |
| A path-scoped lint rule or CODEOWNERS entry can fence env access | Yes | **No** — path scoping has nothing to scope to |

**Compensating control that survives the constraint.** Enable Biome's `process.env` restriction repo-wide rather than path-scoped. That flags the one legitimate read inside `loadConfig`, which then carries exactly one `// biome-ignore` comment in the whole repository. Any second suppression comment appearing in a diff is a review red flag with no judgment required. This is the strongest available substitute for the file boundary, and it is arguably a sharper signal than the file was. Caveat stated honestly: `noProcessEnv` is a Biome nursery rule, so availability depends on the pinned version; if the pinned version does not expose it, fall back to a restricted-globals rule or, failing that, review convention plus the language/secret CI grep from Decision 3.

**Residual risk, stated plainly.** Nothing stops someone writing `const supervisorToken = "…"` inside `bootstrap()` and passing it through. `loadConfig` protects its own output, not the whole file. The remaining guards are the test asserting `createHaClient` receives exactly the `loadConfig` value, the single-suppression lint signal above, and the optional `gitleaks` CI step. That is a weaker stack than the previous design had, and the design does not claim otherwise.

| Alternative | Why rejected |
|---|---|
| Keep config inline in `main()`, just restore the env read | Fixes the line, not the shape. The next person under deadline pressure does the same thing again. |
| Schema validator dependency (zod/ajv) | Three options and one env var do not justify a runtime dependency in an add-on image. |
| `.env` file loading | The Supervisor injects `SUPERVISOR_TOKEN` and writes `/data/options.json`; a second mechanism invites the local-file-with-real-token pattern that already produced `debug-options.json`. |
| A new `src/config.js` | Rejected by the user. This decision is the replacement. |

### Decision 3 — Strings stay inline; decouple the **tests**, not the source

`src/messages.js` is dropped. User-facing English copy stays inline in `src/telegram.js` and `src/formatter.js` as plain literals. No substitute extraction — no shared constants object hidden in `formatter.js`, no exported `MESSAGES` from `telegram.js`. An extraction that is a new file by another name is still the thing that was rejected.

That decision costs something real, because the previous design used `messages.js` as a *delivery* device. The replacement moves the decoupling one layer out, into the test suite, where new files are still allowed and where the coupling actually hurt.

**Choice — copy-decoupled assertions.** When unit 2a writes the behavioral suite for `src/telegram.js`, assertions default to *structure*, not *copy*:

| Assert on | Not on |
|---|---|
| `sendMessage` was called for the right `chat_id` | the exact reply sentence |
| the inline keyboard's `callback_data` values and row count | the button label text |
| `ha.callService` was called with `("light", "turn_on", { entity_id })` | the confirmation toast wording |
| the message body *contains the entity name* from the fake `ha` fixture | the surrounding heading |
| a reply was sent at all on the error path | the error sentence |

Exact-copy assertions are then confined to one dedicated `describe("user-facing copy", …)` block per test file. That block is the only place unit 5b has to touch when every string changes.

**Why this is the right layer.** Copy coupling in production code is harmless — a literal next to the code that sends it is easy to read. Copy coupling in *test* code is what multiplies the diff, because the previous plan wrote every assertion in Spanish in unit 2 and then rewrote all of them in English in unit 5b, paying twice for the same assertions. Concentrating that cost in one block is the same economy `messages.js` was bought for, at zero new source files.

**Mechanical verification, since there is no single file to eyeball.** Add an npm script wired into CI (unit 6) that greps `src/**` for Spanish-specific characters — `[áéíóúÁÉÍÓÚñÑüÜ¿¡]` — and fails on a hit. Deliberately character-class based, not "any non-ASCII", because the emoji in the copy are intentional and must not trip it. **Honest limit**: it catches accented Spanish and inverted punctuation; it will not catch unaccented Spanish such as `"Error consultando Home Assistant"` or `"Luces"`. It is a backstop for regressions after the normalization lands, not a substitute for reading the 5b diff.

**Scope boundaries, stated deliberately:**

- **Log strings are in scope** (the spec requires English `console.*` across `src/**`) but carry no test assertions, so they are pure additions to 5b's line count with no test churn.
- **Sorting collation stays `"es"`.** `friendlyName(a).localeCompare(friendlyName(b), "es")` at `src/formatter.js:10` and the equivalent at `:123` are **not** copy. They are a collation choice matched to the data: the entity names come from a Spanish-language Home Assistant instance, and the existing fixtures (`"Salón"`, `"Batería ventana"`) prove it. Dropping `"es"` changes sort order for accented names — a silent behavior change with no interface benefit. Keep the argument, add an English comment explaining why. Flagged in Open Questions in case the user disagrees.
- **Test fixture `friendly_name` values stay Spanish** (`tests/formatter.test.js:31-104`). They are simulated inputs, not artifacts of the language policy, and the accented ones are the regression evidence for the collation decision above. Anglicizing them would add ~45 touched lines and test nothing. Test `describe`/`it` titles do go to English, per the everything-to-English decision.

| Alternative | Why rejected |
|---|---|
| `src/messages.js` frozen constants object | Rejected by the user. |
| A `MESSAGES` const exported from `src/telegram.js` instead of a new file | Technically satisfies "no new files" while reintroducing the rejected indirection; it also grows the module's public surface, which Decision 1 deliberately keeps closed. Rejected as constraint-laundering. |
| `i18next` / ICU message format | An i18n framework for exactly one locale; adds a dependency and a lookup layer nobody needs. |
| JSON locale files + loader | Same over-engineering, plus a file read at startup, and `/data`-adjacent file loading is what the config decision is trying to narrow. |

### Decision 4 — `haClient.js`: same public surface, optional injected collaborators

**Choice**: the returned object stays identical in shape — `{ getStates, callService, getCameraSnapshot, recordCameraClip, getMediaFile }`. Only the factory's **input** grows optional members: `createHomeAssistantClient({ baseUrl, token, fetchImpl = fetch, sleep = defaultSleep, now = Date.now, logger = console })`.

Internal consolidation, all inside the existing file:

| Today | After |
|---|---|
| `3` at `:137`, `1200` at `:150`, `5 * 60 * 1000` at `:154` | Module-level frozen `HA_RETRY = { ATTEMPTS, DELAY_MS, SNAPSHOT_COOLDOWN_MS }` |
| Two near-identical candidate-URL fallback chains (`getCameraSnapshot:99-123`, `getMediaFile:176-213`) | One private `fetchFirstNonEmpty(candidates, label)` taking `[{ path, useApiBase }]` |
| Inline retry loop at `:135-151` | One private `retryForNonEmpty(fn, { attempts, delayMs })` |
| Spanish comment at `:153` and Spanish error/log strings at `:82, :93, :107, :109, :117, :119, :145, :155, :204, :205, :208, :212` | English |

The English normalization of `haClient.js` folds into this unit rather than into 5a/5b. It is ~13 touched lines against a file this unit is already rewriting, and `haClient` strings carry no user-facing copy assertions, so splitting them out would create a second pass over the same hunks for no review benefit.

**Rationale**: injected `sleep`/`now` cut ~3.6s of real sleeping out of the snapshot test and make the cooldown branch (`:90-94`) — currently untested — assertable without fake timers. Consumers construct the client in exactly one place (`src/index.js:48`), so additive optional inputs are invisible to them.

Rejected: changing the return shape to expose internals for testing (breaks the contract `tests/haClient.test.js` already relies on), and a generic retry library (a 10-line helper does not need a dependency).

### Decision 5 — `entity_id` validation: membership, with a cheap shape precondition

**Choice**: two-stage check inside the `callback_query` handler, before any privileged call.

1. **Shape gate** (no I/O): reject anything not matching `/^[a-z_]+\.[a-z0-9_]+$/`.
2. **Membership gate** (authoritative): a private `resolveOfferedEntity(action, entityId, states)` maps the action prefix to the same formatter selector that built the keyboard — `light_*` → `getAllLights`, `cover_*` → `getAllCovers`, `camera_*` → `getAllCameras` — and requires an exact `entity_id` match. No match ⇒ answer with an inline "unknown entity" reply, no service call, log at warn.

The handler therefore fetches `/states` *before* acting instead of only after. The camera branches (`src/telegram.js:422-519`) already fetch, so they are net-neutral; light and cover actions cost one extra `/states` round trip.

**Accepted tradeoff, stated plainly**: +1 local REST call per light/cover toggle. That is the price of the authorization boundary and it is cheap against a Supervisor-local API.

| Alternative | Why rejected |
|---|---|
| Regex/allow-listed-domain validation only | Still lets any allow-listed chat drive *any* `light.*` entity in the house, including ones the bot never offered. It is a syntax check, not authorization. |
| Signed or opaque callback tokens with a server-side session map | Strongest, but adds mutable per-chat state to a stateless bot and fights Telegram's 64-byte `callback_data` limit. Disproportionate for an allow-listed single-household bot. |
| Cache the last-offered entity list per chat | Cheaper than a refetch but goes stale, and a restart silently breaks every live keyboard. |

### Decision 6 — Lifecycle: capture the bot, one idempotent shutdown, asymmetric error policy

**Choice**: `src/index.js` stops discarding the return value at `:53`, and exports `installProcessHandlers({ bot, processRef = process, exit = (c) => process.exit(c), logger = console, timeoutMs = 10_000 })` — a function in the existing file, not a new module.

| Signal / event | Behavior | Why |
|---|---|---|
| `SIGTERM`, `SIGINT` | Guarded by a `shuttingDown` flag; `await bot.stopPolling({ cancel: true })`, then exit `0`. A `timeoutMs` timer forces exit if `stopPolling` hangs. | The Supervisor sends `SIGTERM` on every add-on stop, restart, and update. Long polling holds an open HTTP request, so an unguarded process is killed mid-request. |
| `unhandledRejection` | Log with context, **do not exit**. | A transient HA 502 inside a detached `.then` (`src/telegram.js:172`) must not take down the add-on. Exiting here converts a recoverable upstream blip into downtime. |
| `uncaughtException` | Log, then exit non-zero. | Process state is no longer trustworthy; the Supervisor restarts on non-zero exit, which is the correct recovery. |
| `polling_error` | Keep logging (`src/telegram.js:576-578`); add `error.code`. No custom reconnect. | `node-telegram-bot-api` already retries polling; a second reconnect loop would fight it. |

**Rationale**: injecting `processRef` and `exit` is what makes this testable at all — a fake `EventEmitter` plus a recording `exit` spy lets a test assert the SIGTERM path without terminating the test runner.

Rejected: a supervising parent process or `pm2` (the Supervisor *is* the supervisor), and exiting on `unhandledRejection` (trades availability for tidiness).

### Decision 7 — Tooling: Biome

**Choice**: one dev dependency, `@biomejs/biome`, with a `biome.json`, plus `lint`, `lint:fix`, `format`, and `check` scripts in `package.json`. Wire `npm run check` into `.github/workflows/tests.yml`. A devDependency adds no file under `src/`, so the constraint is satisfied.

| Alternative | Why rejected |
|---|---|
| ESLint 9 flat config + Prettier | Four-to-five dev dependencies (`eslint`, `@eslint/js`, `globals`, `prettier`, `eslint-config-prettier`) and a flat-config migration for a four-file `src/`. |
| oxlint | Fast, but no formatter, so Prettier comes back anyway. |
| No tooling | The incident shows this repo needs a mechanical gate, not more discipline. |

**Honest limit**: Biome will not catch a hardcoded credential. The secret guards are the `loadConfig` tests (Decision 2), the single-suppression `process.env` signal, and an optional `gitleaks` CI step which remains recommended but not required.

## Data Flow

Production and test paths diverge at exactly two injection points and nowhere else:

```
  PRODUCTION                                    TEST
  ──────────                                    ────
  index.loadConfig(process.env, fs)             index.loadConfig({env:{...}, readFile: () => json})
        │                                             │
        ▼                                             ▼
  bootstrap({createHaClient, startBot})          bootstrap({createHaClient: fake, startBot: fake})
        │                                             │
        ├──► haClient(fetch, setTimeout)              ├──► haClient(fetchImpl: fake, sleep: noop)
        │                                             │
        └──► telegram({createBot: real})  ◄──SEAM──►  └──► telegram({createBot: () => new FakeTelegramBot()})
                    │                                             │
                    ▼                                             ▼
             new TelegramBot(...)                          records handlers + calls
                    │                                             │
                    └──────► same handler bodies + formatter.js ◄──────┘
```

`loadConfig` and `bootstrap` now live in the same file, so the top of that diagram is one module rather than two. The injection contract is unchanged.

Request path, unchanged except for the new gate:

```
  update ─► isAllowed ─► getStates ─► [NEW] shape+membership gate ─► ha.callService ─► refresh keyboard
```

## File Changes

No row creates a file under `src/`.

| File | Action | Description |
|---|---|---|
| `src/index.js` | Modify | Add `loadConfig` (absorbing `loadOptions`, `parseAllowedChatIds`, `HA_DEFAULT_BASE_URL`, validation table); export `bootstrap` and `installProcessHandlers`; entrypoint guard replacing `main().catch(...)` at `:63`; capture the bot at `:53`; English logs. |
| `src/telegram.js` | Modify | `createBot`/`logger` params; entity shape+membership gates; shared light/cover keyboard builders; named constants; English copy and commands. **No restructuring, no new exports.** |
| `src/haClient.js` | Modify | Optional `fetchImpl`/`sleep`/`now`/`logger`; `HA_RETRY` constants; `fetchFirstNonEmpty` + `retryForNonEmpty`; English strings and the `:153` comment. Public surface unchanged. |
| `src/formatter.js` | Modify | English headings and empty-state strings, inline. `localeCompare(…, "es")` kept at `:10` and `:123` with an explanatory English comment. |
| `tests/helpers/fakeTelegramBot.js` | Create | Recording double for `node-telegram-bot-api`. Outside the `tests/*.test.js` glob, so not collected as a suite. |
| `tests/telegram.test.js` | Rewrite | Import and drive the real `createTelegramBot`. Copy-decoupled assertions plus one `user-facing copy` block. No re-implemented logic. |
| `tests/index.test.js` | Rewrite | Import and drive the real `loadConfig`, `bootstrap`, and `installProcessHandlers`. Carries the permanent regression guard for the secret incident. |
| `tests/formatter.test.js` | Modify | English test titles; assertions follow the English strings; Spanish fixture `friendly_name` values retained. |
| `tests/haClient.test.js` | Modify | Add cooldown and retry-exhaustion cases now reachable via injected `sleep`/`now`. |
| `config.yaml` | Modify (breaking) | Renamed options per `sdd-spec`, English description, version bump. |
| `package.json` | Modify | `engines.node: ">=20"`, `license: "MIT"`, `@biomejs/biome`, lint/format/check/`check:lang` scripts. |
| `biome.json` | Create | Formatter + linter config, including the repo-wide `process.env` restriction. |
| `Dockerfile` | Modify | `npm install --omit=dev` → `npm ci --omit=dev` (`:6`). |
| `.gitignore` | Modify | Add `.vscode/`, `.DS_Store`. |
| `README.md` | Rewrite | Actual behavior, old→new command map, option migration table, both breaking-change notices. |
| `.github/workflows/tests.yml` | Modify | Add `npm run check` and `npm run check:lang`. |

## Interfaces / Contracts

```js
// src/index.js — sole owner of process.env and filesystem reads, via loadConfig.
export const HA_DEFAULT_BASE_URL = "http://supervisor/core/api";
export function loadConfig({ env = process.env, readFile } = {}) { /* frozen config or throws */ }
export async function bootstrap({ config, createHaClient, startBot, logger } = {}) {}
export function installProcessHandlers({ bot, processRef, exit, logger, timeoutMs }) {}

// src/telegram.js — additive optional params only; return value unchanged.
export function createTelegramBot({ token, allowedChatIds, lowBatteryThreshold, ha, createBot, logger }) {}

// src/haClient.js — additive optional params only; returned surface unchanged.
export function createHomeAssistantClient({ baseUrl, token, fetchImpl, sleep, now, logger }) {}

// src/formatter.js — unchanged signatures.
```

Every new parameter is optional with a production default, so no call site is forced to change. `src/index.js` gains four exports; `src/telegram.js`, `src/haClient.js`, and `src/formatter.js` gain none.

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit — `loadConfig` | Env sourcing, Supervisor default URL, missing `SUPERVISOR_TOKEN`, chat-id parsing, threshold coercion and bounds, invalid option | Direct calls with injected `env` and `readFile`, from `tests/index.test.js`. No filesystem. |
| Unit — formatter | Existing coverage, English assertions, accented-name sort order preserved | Unchanged fixture approach (`tests/formatter.test.js`). |
| Unit — haClient | Existing cases plus the cooldown branch (`:90-94`), retry exhaustion, non-OK `requestBinary` | Injected `fetchImpl`, `sleep`, `now`. |
| Behavioral — telegram | Every command; allow-list denial; `/chatid` reachable while denied; `/start` and `/help` now denied; keyboard shape; callback dispatch; **entity rejected when not in the offered list**; media fallback | `FakeTelegramBot` + fake `ha`, driving the real handler bodies. Structure-first assertions per Decision 3. |
| Behavioral — bootstrap | HA client built with the Supervisor URL and the `loadConfig` token value; bot started with parsed config; SIGTERM stops polling and exits 0; `unhandledRejection` logs without exiting; `uncaughtException` exits non-zero | Injected `createHaClient`, `startBot`, fake `EventEmitter` as `processRef`, `exit` spy. |
| Copy | Exact English strings for replies, buttons, headings, and empty states | One dedicated `describe("user-facing copy", …)` block per test file. The only place unit 5b rewrites assertions. |
| Integration / E2E | None | No harness exists and none is proposed; a real Telegram or HA endpoint would need live credentials. |

Strict TDD is enabled for this project: the RED test precedes the production edit in every unit below.

## Threat Matrix

No routing, shell, subprocess, VCS/PR-automation, or executable-file-classification boundary is introduced.

| Boundary | Applicability | Design response |
|---|---|---|
| Documentation-like paths | N/A — no file is classified or executed by path or extension. | — |
| Git repository selection | N/A — no git invocation in the runtime or the change. | — |
| Commit state | N/A — no VCS automation. | — |
| Push state | N/A — no VCS automation. | — |
| PR commands | N/A — no PR automation. | — |

Two boundaries this change *does* touch are covered by named decisions rather than by the table above:

| Boundary | Safe behavior | Failure behavior | RED test |
|---|---|---|---|
| Attacker-influenced `entity_id` from `callback_data` (Decision 5) | Act only on an entity the bot itself offered for that action. | Malformed or unoffered `entity_id` ⇒ callback answered with an unknown-entity reply, **zero** `ha.callService` invocations, warn log. | Assert `ha.callService` was never called for `light_on:light.not_offered` and for `../../etc`. |
| Process integration: signals and unhandled errors (Decision 6) | `SIGTERM` stops polling once and exits `0`. | Repeated signals are idempotent; a hung `stopPolling` is force-exited after `timeoutMs`; `unhandledRejection` never exits; `uncaughtException` exits non-zero. | Fake `processRef` emits `SIGTERM` twice ⇒ one `stopPolling`, one `exit(0)`. |

A third boundary is weakened rather than introduced: the credential-hardening boundary of Decision 2 is now function-scoped, not file-scoped. The table in Decision 2 is the complete accounting; it is a design risk carried deliberately at the user's direction, not an oversight.

## Migration / Rollout

Two user-visible breaking changes ship in this work, both already approved:

1. **Language and command names.** All replies become English; commands are renamed with **no Spanish aliases** — `/estado`→`/status`, `/luces`→`/lights`, `/sensores`→`/sensors`, `/puertas`→`/doors`, `/bateria`→`/battery`, `/temp`→`/temperature`, `/persianas`→`/covers`, `/camaras`→`/cameras`. `/start`, `/help`, `/chatid` keep their names. `/start` and `/help` become gated by the allow-list; `/chatid` stays open by design, so an unknown user can still discover their chat id and request access. README carries the full old→new table.
2. **Add-on options rename.** Existing installations must reconfigure after upgrade. README carries an old→new option table; `config.yaml` version is bumped.

### Re-measuring the English normalization of `src/telegram.js`

This is the problem the dropped `messages.js` created, so it gets measured rather than estimated. Changed lines below count additions **plus** deletions, so one modified line costs 2.

`src/telegram.js` is 582 lines, but only the lines carrying a Spanish literal, a Spanish comment, or a renamed command regex actually change:

| Region | Lines | Touched | Changed (add+del) |
|---|---|---|---|
| Module helpers — camera option labels, media errors, callback warning, photo/video fallback captions | `42-158` | 13 | ~26 |
| Bootstrap log, `handleCommand`, `/start`, `/help`, `/chatid` | `160-249` | 32 | ~64 |
| Simple read commands — `/estado`, `/sensores`, `/puertas`, `/bateria`, `/temp` | `251-256`, `299-319` | 10 | ~20 |
| Interactive commands — `/luces`, `/persianas`, `/camaras` | `258-297`, `321-390` | 29 | ~58 |
| `callback_query` handler + final startup log | `392-574`, `580` | 29 | ~58 |
| **Total** | | **113** | **~226** |

**The "~582-line single-file diff" framing was wrong, and this design corrects it.** That number assumed a whole-file rewrite. A targeted string-and-regex edit touches ~113 lines — roughly 39% of the file — for ~226 changed lines. The production half of unit 5b fits inside the 400-line budget on its own, with room to spare.

The budget pressure was never the source file. It is **test-assertion churn**, and that is exactly what Decision 3 addresses:

| Test-authoring approach in unit 2a | Assertion lines unit 5b must rewrite | Unit 5b total |
|---|---|---|
| Copy-coupled (assert exact Spanish strings everywhere) | ~150 touched → ~300 changed | ~526 — **over budget** |
| Copy-decoupled (Decision 3) | ~45 touched → ~90 changed | **~316 — under budget** |

### Slicing recommendation for unit 5b

**Recommendation: ship unit 5b as one commit, measure before opening the PR, and hold option B in reserve.** Do not pre-split.

Rationale: pre-splitting costs real churn — a second pass over `tests/telegram.test.js` and a second round of review setup — to insure against a budget overrun the measurement says is unlikely (~316 against 400). Measure with `git diff --stat` on the finished unit before creating the PR. If it exceeds 400, fall back to option B.

| Option | Slices and estimates | Verdict |
|---|---|---|
| **B — split by change kind** (recommended fallback) | **5b-1 command renames**: 8 `onText` regexes, the `/start` command list (`:212-223`), the `/help` list (`:232-241`), and the ~10 `console.log` lines embedding command names ⇒ ~40 touched → ~80 changed, plus ~25 touched test lines → ~50 changed. **Total ~130.**<br>**5b-2 reply copy**: the remaining ~73 touched → ~146 changed, plus ~20 touched test lines → ~40 changed. **Total ~186.** | **Recommended fallback.** 5b-1 isolates the entire user-visible breaking change into one commit, which is precisely the rollback boundary and precisely what the README migration table documents. The intermediate state — English command names, Spanish replies — is odd but coherent, functional, and shippable if the chain stalls. |
| **A — split by command group** | e.g. 5b-i lights+covers (~58), 5b-ii cameras+callback (~80), 5b-iii read-only+`/start`+`/help` (~84), plus test churn distributed across all three. | **Rejected.** Two concrete objections. First, the group boundary is not clean: `handleCommand`'s shared error copy at `:200` and `safeReply` serve `/estado`, `/sensores`, `/puertas`, `/bateria`, and `/temp` simultaneously, so the first slice must translate strings still used by untranslated commands, and `sendPhotoWithFallback`/`sendVideoWithFallback` captions are shared between the camera image and video paths. Second, every intermediate state is a bot that answers `/lights` in English and `/doors` in Spanish, with a `/start` menu listing a mixture — a worse artifact for both reviewer and user than option B's clean split. More commits also means `tests/telegram.test.js` is touched three times instead of once. |
| **C — documented `size:exception`** | One ~316-line unit, or a ~526-line unit if Decision 3 is not applied. | **Not the first resort.** At ~316 the unit is under budget and needs no exception. Reserve C for one case: if the measured diff exceeds 400 *even after* option B, take the exception on **5b-2** rather than slicing a third time. Reply copy has no clean internal seam left once command names are removed, and a third split would draw arbitrary boundaries — a worse review artifact than one coherent over-budget diff. |

**What this constraint actually costs, stated without spin.** Unit 5b is genuinely harder to review than it was under the `messages.js` plan, and line count understates that. With `messages.js` a reviewer read one new file of copy top to bottom and then scanned mechanical call-site substitutions. Now they must read ~113 in-place edits scattered across 582 lines and verify at each hunk that nothing but a literal changed. The line budget is satisfied; the cognitive load is not equivalent.

The available compensating control is diff discipline, and the design makes it a hard rule:

> **Unit 5b changes string literals, template literals, comments, and command regexes only.** If a hunk in 5b changes control flow, a condition, an argument list, or anything other than a literal or a regex, it belongs in unit 3 or unit 4 and must be moved there before the PR opens.

That invariant is checkable by the reviewer in one pass per hunk and restores most — not all — of what the extraction bought.

### Delivery units and binding order

`delivery_strategy: ask-on-risk`, `review_budget_lines: 400`.

| # | Unit | Est. changed lines | Budget risk |
|---|---|---|---|
| 1a | **Ship first, alone.** Restore the `process.env.SUPERVISOR_TOKEN` read (`src/index.js:39`) and `http://supervisor/core/api` (`:45,:49`); `.gitignore` hygiene. | ~10 | Low |
| 1b | `loadConfig()` + `bootstrap` export + entrypoint guard in `src/index.js`; English `index.js` strings; `tests/index.test.js` config cases. | ~220 | Low |
| 2a | **Testability seam.** `createBot` injection in `src/telegram.js`; `tests/helpers/fakeTelegramBot.js`; replace the re-implemented suite with copy-decoupled behavioral tests for the allow-list, simple read commands, and chunking. Behavior-neutral. | ~356 | **High** |
| 2b | Behavioral coverage completion: callback dispatch, camera flows, media fallback. Test-only. | ~210 | Low |
| 3 | Authorization hardening: entity shape+membership gates, `/start`+`/help` gating, `installProcessHandlers`, tests. | ~220 | Low |
| 4 | DRY: `haClient` constants, `fetchFirstNonEmpty`/`retryForNonEmpty`, injected `sleep`/`now`, English `haClient` strings, shared light/cover keyboard builders in `telegram.js`, `haClient` test additions. | ~300 | Medium |
| 5a | English `formatter.js` (~48) + English `tests/formatter.test.js` (~140). Collation `"es"` retained. | ~190 | Low |
| 5b | English `telegram.js` copy + command renames + bounded test-assertion updates. Literals and regexes only. | ~316 | Medium |
| 6 | `config.yaml` rename, `Dockerfile` `npm ci`, `package.json` hygiene, `biome.json`, `check:lang` script, CI wiring. | ~120 | Low |
| 7 | `README.md` rewrite. | ~350 | Medium |

**Binding order: 1a → 1b → 2a → 2b → 3 → 4 → 5a → 5b → 6 → 7.**

Aggregate ≈ **2,290 changed lines**. Every unit is individually at or under 400; the aggregate is not, so chained PRs are required.

**Why this order:**

- **1a first and alone** so the live-secret fix does not wait on review of anything else.
- **`bootstrap` and the entrypoint guard moved from unit 2 into 1b.** This is a correctness fix, not a preference: `tests/index.test.js` cannot import `src/index.js` to test `loadConfig` while `main().catch(...)` still self-invokes at `:63` and starts a real bot on import. The guard is a prerequisite of 1b's own tests, so it must ship with them.
- **Unit 2 split into 2a/2b.** The previous single unit forecast ~600 changed lines (seam ~16 + `bootstrap` ~40 + fake ~90 + test file 80 deletions and ~380 additions), well over budget. Splitting the *coverage* across two commits does not violate the "keep tests with the behavior they verify" rule, because unit 2 introduces no behavior — it is pure coverage of code that already exists.
- **All testability work precedes every behavioral edit.** Authorization hardening (unit 3) is a logic edit to the currently untested `callback_query` handler; it runs against a real suite or not at all.
- **Unit 4 before 5a/5b** so the shared keyboard builders exist before the copy inside them is rewritten, avoiding a second pass over the same hunks.
- **5a before 5b** so `formatter.js` output is already English when `telegram.js` copy assertions are rewritten against it.

**Rollback boundaries.** Each unit reverts independently. Units 5b, 6, and 7 are the only user-visible reverts; reverting 6 also requires restoring the previous `config.yaml` option names and re-bumping the add-on version. 2b reverts to a repo with partial but honest coverage, never to re-implemented tests.

**`Decision needed before apply: Yes` — `Chained PRs recommended: Yes` — `400-line budget risk: High`** in aggregate. Under `ask-on-risk`, the orchestrator must stop before unit 2a and before unit 5b and put the measured numbers to the user. `sdd-tasks` owns the final forecast wording; this design supplies the measurements and a recommended answer for each question.

## Open Questions

- [ ] **Collation.** This revision keeps `localeCompare(…, "es")` at `src/formatter.js:10` and `:123`, treating sort order as a property of the Spanish entity names rather than of the interface language. If the user wants collation normalized too, it is a two-line change plus the accented-name sort assertions in `tests/formatter.test.js` — but it changes observed ordering for names like `"Salón"`.
- [ ] **Biome `noProcessEnv` availability.** The single-suppression control in Decision 2 depends on the pinned Biome version exposing that nursery rule. Verify at unit 6; if unavailable, the fallback is a restricted-globals rule or review convention plus the `check:lang` grep.
- [ ] Whether `HA_DEFAULT_BASE_URL` should be overridable by an add-on option for non-Supervisor deployments, or hardcoded as the default with no override. Design assumes **default with no override**; adding an override later is a one-line change to the validation table.
- [ ] Optional `gitleaks` CI step — recommended, and more valuable than before now that the config boundary is function-scoped, but still not required by this design.
- [ ] **Operational, outside this design**: the exposed Supervisor token must be revoked in Home Assistant by the user regardless of unit 1a. No code change can do this.
