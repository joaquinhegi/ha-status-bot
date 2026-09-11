# HA Status Bot

![Tests](https://github.com/joaquinhegi/ha-status-bot/actions/workflows/tests.yml/badge.svg)
![Version](https://img.shields.io/github/v/tag/joaquinhegi/ha-status-bot?label=version&color=orange)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

A **Home Assistant Supervisor add-on** that runs a **Telegram** bot to query and control a home
directly from a chat: which lights are on, which sensors are active, which doors/windows are
open, low batteries, temperatures, camera snapshots/video, and turning lights or covers on/off —
all through simple commands and inline buttons.

> **Upgrading from 1.x?** Version `2.0.0` renames every bot command and two add-on options, and
> all bot replies are now in English. Read [Upgrading to 2.0.0](#upgrading-to-200) before you
> update.

---

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [Authorization model](#authorization-model)
- [Upgrading to 2.0.0](#upgrading-to-200)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Docker](#docker)
- [Project structure](#project-structure)
- [License](#license)

---

## How it works

The bot runs inside the Home Assistant Supervisor as a long-running add-on process (long
polling — no public URL or webhook is needed). When a user sends a command, the bot calls the
Home Assistant REST API to read the current entity states (or to change one, for the light/cover
actions), then replies with a formatted summary or an inline keyboard.

```
Telegram user  →  Bot (long polling)  →  Home Assistant REST API  →  Formatted reply  →  Telegram user
```

**Runtime lifecycle:**

- On start, the bot removes any existing webhook and begins polling Telegram for updates.
- `SIGTERM`/`SIGINT` (sent by the Supervisor on add-on stop, restart, or update) trigger a
  graceful shutdown: polling stops before the process exits.
- An unhandled promise rejection (for example, a transient Home Assistant error) is logged and
  does **not** crash the process; an uncaught synchronous exception does exit the process, since
  it indicates a state the add-on can no longer trust.

**Modules:**

| File | Responsibility |
|---|---|
| `src/index.js` | Entry point: loads and validates add-on configuration, wires the Home Assistant client and the Telegram bot together, installs shutdown/error handlers. |
| `src/haClient.js` | Home Assistant REST client: reading states, calling services, fetching camera snapshots/clips with retry and fallback. |
| `src/telegram.js` | Telegram bot: command handlers, inline keyboards, authorization checks, callback dispatch. |
| `src/formatter.js` | Pure functions that filter and format entity states into the text shown to the user. No I/O. |

---

## Requirements

- **Home Assistant** with the **Supervisor** (Home Assistant OS or Supervised install).
- A **Telegram bot** created through [@BotFather](https://t.me/BotFather), and its token.
- The **chat_id** of every user or group that should be allowed to use the bot (each user can
  discover their own with the bot's `/chatid` command — see
  [Authorization model](#authorization-model)).

---

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add:

   ```
   https://github.com/joaquinhegi/ha-status-bot
   ```

2. Install the **HA Status Bot** add-on.
3. Set the options described in [Configuration](#configuration) below.
4. Start the add-on. It begins polling Telegram immediately.

---

## Configuration

Options are set from the add-on's **Configuration** tab in Home Assistant and are exactly as
declared in `config.yaml`:

| Option | Type | Default | Description |
|---|---|---|---|
| `telegram_bot_token` | `password` | `""` | Bot token issued by BotFather. Required. |
| `allowed_chat_ids` | `list(str)` | `[]` | Chat IDs allowed to use the bot, one per list entry. An empty list allows **any** chat — see [Authorization model](#authorization-model). |
| `low_battery_threshold_percent` | `int(0,100)` | `20` | Battery percentage at or below which a sensor is reported as low. |

These three names and types match `config.yaml` exactly. If you are updating from a version
before `2.0.0`, see [Upgrading to 2.0.0](#upgrading-to-200) — the option names and the type of
`allowed_chat_ids` changed and existing installs must be reconfigured.

---

## Commands

| Command | Description | Gated by allow-list? |
|---|---|---|
| `/start` | Welcome message and command list. | Yes |
| `/help` | Short command list. | Yes |
| `/status` | Full summary: lights, doors/windows, sensors, batteries, temperatures. | Yes |
| `/lights` | Inline buttons to turn each light on or off. | Yes |
| `/covers` | Inline buttons to open or close each cover. | Yes |
| `/cameras` | Pick a camera, then request a photo or a 30-second video clip. | Yes |
| `/sensors` | Binary sensors currently active. | Yes |
| `/doors` | Doors and windows currently open. | Yes |
| `/battery` | Batteries at or below the configured threshold. | Yes |
| `/temperature` | All available temperature readings. | Yes |
| `/chatid` | Replies with the chat_id of the current conversation. | **No — intentionally** |

---

## Authorization model

Every command and every inline-button action checks the requesting `chat_id` against
`allowed_chat_ids`:

- If `allowed_chat_ids` is empty, every chat is allowed.
- If it has entries, only a matching `chat_id` is allowed; any other chat receives a message
  telling it its own `chat_id` and that it is not authorized.

**`/chatid` is deliberately left ungated.** A brand-new user has no way to learn their own
`chat_id` if the command that reveals it is itself gated, so `/chatid` always replies — this is
intentional, not an oversight, and is the supported way for someone to request access from the
add-on owner.

Beyond the chat-level allow-list, every inline-button action (turning a light on/off, opening or
closing a cover, picking a camera) is also checked against the **entity list the bot itself most
recently offered** for that action, before any Home Assistant service call is made. This prevents
an already-authorized chat from calling out-of-band or crafted button actions against entities
the bot never displayed to it.

---

## Upgrading to 2.0.0

Version `2.0.0` is a **breaking release**. It does not add new features on its own; it renames
existing commands and options and switches all bot replies to English. There are no aliases for
the old names — old commands and old option names simply stop being recognized.

### 1. Bot commands renamed (English only, no aliases)

| Old command | New command |
|---|---|
| `/estado` | `/status` |
| `/luces` | `/lights` |
| `/sensores` | `/sensors` |
| `/puertas` | `/doors` |
| `/bateria` | `/battery` |
| `/temp` | `/temperature` |
| `/persianas` | `/covers` |
| `/camaras` | `/cameras` |

`/start`, `/help`, and `/chatid` keep their names. After upgrading, the old commands no longer run
their old flow — instead, each one gets a reply telling you it was renamed in 2.0.0 and naming its
exact replacement (gated by `allowed_chat_ids` like every other command). Update any saved
shortcuts, bot menus, or scripts that send the old command text.

### 2. Add-on options renamed

| Old option (type) | New option (type) |
|---|---|
| `telegram_token` (`password`) | `telegram_bot_token` (`password`) |
| `low_battery_threshold` (`int`) | `low_battery_threshold_percent` (`int`, bounded `0`–`100`) |
| `allowed_chat_ids` (`str`, comma-separated) | `allowed_chat_ids` (`list(str)`) — same name, new type |

**Existing installations must be reconfigured after updating**: open the add-on's Configuration
tab and re-enter the token and threshold under their new names, and re-enter each allowed chat ID
as a separate list entry instead of a comma-separated string. The add-on will not start with the
old option names in place — `telegram_bot_token` is required and validated on startup.

### 3. Bot replies are now in English

Every reply, button label, and error message the bot sends is in English. There is no
language-selection option.

---

## Environment variables

These are set by the Home Assistant Supervisor automatically and normally require no action:

| Variable | Source | Purpose |
|---|---|---|
| `SUPERVISOR_TOKEN` | Injected by the Supervisor because `config.yaml` declares `homeassistant_api: true`. | Bearer token used to authenticate every Home Assistant REST call. Required; the add-on exits with an explicit error if it is missing. |

These two are optional overrides, useful when running the bot **outside** the Supervisor (local
development, a manual container run):

| Variable | Default | Purpose |
|---|---|---|
| `HA_BASE_URL` | `http://supervisor/core/api` | Base URL of the Home Assistant REST API. Only override this for local runs against a Home Assistant instance reachable at a different address. |
| `OPTIONS_PATH` | `/data/options.json` | Path to the JSON file holding the add-on options (`telegram_bot_token`, `allowed_chat_ids`, `low_battery_threshold_percent`). Point this at a local file to run the bot without the Supervisor. |

**Never hardcode `SUPERVISOR_TOKEN`, a Telegram bot token, or any other credential in source,
in a committed file, or in this README.** Provide them only through the add-on Configuration UI
or through environment variables / a local, gitignored options file at development time.

---

## Development

Scripts below are exactly as declared in `package.json`:

```bash
node --test                # run the test suite
npm run test:coverage       # run the test suite with coverage instrumentation
npm run lint                # check for lint issues (Biome)
npm run lint:fix             # check and auto-fix lint issues
npm run format               # apply formatting (Biome)
npm run check                # run Biome's combined lint + format check
npm run check:lang           # fail if src/ contains Spanish characters
```

The test suite uses Node's built-in [test runner](https://nodejs.org/api/test.html) — no
external test framework is installed. Every test file imports and exercises the real module it
covers (`src/formatter.js`, `src/haClient.js`, `src/telegram.js`, `src/index.js`); none of them
re-implement production logic inline, so a regression in the real code fails the corresponding
test.

Code style and linting are enforced with [Biome](https://biomejs.dev) (`biome.json`), including a
rule that forbids reading `process.env` anywhere except the single authorized entry point in
`src/index.js`. `npm run check:lang` is a project-specific guard that fails if any accented
Spanish character appears under `src/`, keeping the codebase's English-only convention.

To run the bot locally without a Home Assistant Supervisor, point it at a local options file and
a reachable Home Assistant instance:

```bash
SUPERVISOR_TOKEN=<your-long-lived-access-token> \
HA_BASE_URL=http://localhost:8123/api \
OPTIONS_PATH=./local-options.json \
node src/index.js
```

Where `local-options.json` (kept out of version control) provides
`telegram_bot_token`, `allowed_chat_ids`, and `low_battery_threshold_percent`.

---

## Docker

Build the image manually:

```bash
docker build -t ha-status-bot .
```

The `Dockerfile` installs dependencies with `npm ci --omit=dev` for a reproducible,
lockfile-exact install, then runs `node src/index.js` directly.

Run it outside Home Assistant (for local testing):

```bash
docker run \
  -e SUPERVISOR_TOKEN=<your-long-lived-access-token> \
  -e HA_BASE_URL=http://host.docker.internal:8123/api \
  -v /path/to/local-options.json:/data/options.json \
  ha-status-bot
```

---

## Project structure

```
ha-status-bot/
├── config.yaml          # Home Assistant Supervisor add-on manifest
├── Dockerfile            # Add-on image
├── package.json          # Dependencies, scripts, metadata
├── biome.json            # Lint/format configuration
├── scripts/
│   └── check-lang.js     # Fails CI if src/ contains Spanish characters
├── src/
│   ├── index.js           # Entry point: config loading, wiring, lifecycle
│   ├── haClient.js         # Home Assistant REST client
│   ├── telegram.js         # Telegram bot: commands, keyboards, authorization
│   └── formatter.js        # Pure entity-state formatting functions
└── tests/
    ├── formatter.test.js
    ├── haClient.test.js
    ├── telegram.test.js
    ├── index.test.js
    └── helpers/
        └── fakeTelegramBot.js   # Test double used by telegram.test.js
```

---

## License

MIT
