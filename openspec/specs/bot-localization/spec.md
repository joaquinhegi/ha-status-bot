# Bot Localization Specification

## Purpose

Normalizes all user-facing copy, logs, comments, and command names to English — a deliberate, user-visible breaking behavior change.

## Requirements

### Requirement: English-Only User-Facing Copy

Every string the bot sends to a Telegram chat (replies, button labels, error and authorization messages) MUST be English and MUST NOT contain Spanish text.

#### Scenario: No Spanish in outbound messages

- GIVEN a review of every `bot.sendMessage`/`sendPhoto`/`sendVideo` call and button-label literal in `src/telegram.js`
- WHEN checking the string language
- THEN all strings are English

### Requirement: English-Only Logs and Comments

All `console.log`/`warn`/`error` strings and code comments in `src/**` MUST be English, including the one Spanish inline comment currently at `src/haClient.js:153` (the camera cooldown comment).

#### Scenario: No Spanish log strings remain

- GIVEN a review of `src/**`
- WHEN checking log strings and comments
- THEN none are in Spanish

### Requirement: Commands Are Renamed to English With No Aliases

Every bot command MUST be renamed per the table below, with no Spanish alias registered for any of them. Each of the eight retired Spanish commands MUST instead receive a migration reply naming its exact English replacement — see the "Retired Spanish command" scenario below.

| Old (Spanish) | New (English) |
|---|---|
| `/start` | `/start` (unchanged, already English) |
| `/help` | `/help` (unchanged, already English) |
| `/chatid` | `/chatid` (unchanged, already English) |
| `/estado` | `/status` |
| `/luces` | `/lights` |
| `/sensores` | `/sensors` |
| `/puertas` | `/doors` |
| `/bateria` | `/battery` |
| `/temp` | `/temperature` |
| `/persianas` | `/covers` |
| `/camaras` | `/cameras` |

Rationale: the new names match `src/formatter.js`'s existing English function names (`getAllLights`, `getAllCovers`, `getActiveBinarySensors`, `getOpenDoorsAndWindows`, `getLowBatteries`, `getTemperatures`, `getAllCameras`, `formatFullStatus`), so command names and code identifiers stay consistent. `/temp` is expanded to `/temperature` for naming consistency with the other full-word commands.

#### Scenario: Old Spanish command is no longer recognized

- GIVEN the bot is running with the renamed commands
- WHEN an allowed chat sends `/luces`
- THEN the bot does not run the lights flow, calls no Home Assistant service, and instead
  replies that `/luces` was renamed in 2.0.0 and that `/lights` is its replacement

> Amended twice. First, after verification, to say the command "sends no reply at all"
> instead of the originally-drafted "falls through to unknown-command handling", since
> `src/telegram.js` registered no catch-all `bot.on("message")` handler at the time.
>
> Second, now that the migration catch-all described below exists: a retired command is
> no longer silent. It matches only the eight retired command names — anchored so, for
> example, the retired `/temp` pattern cannot also match the live `/temperature` — and
> is gated by the allow-list like every other command, so an unauthorized chat gets the
> standard "not authorized" answer rather than a map of the renamed command surface. See
> the "Retired Spanish command" scenario below for the authorized case and
> `RETIRED_COMMAND_MIGRATIONS` in `src/telegram.js` for the exact mapping. This remains a
> deliberate, narrow exception: the bot still has no general catch-all for arbitrary text.

#### Scenario: Retired Spanish command names its replacement

- GIVEN the bot is running with the renamed commands
- WHEN an allowed chat sends any of the eight retired commands (`/estado`, `/luces`,
  `/sensores`, `/puertas`, `/bateria`, `/temp`, `/persianas`, `/camaras`)
- THEN the bot calls no Home Assistant service and replies with the command's exact
  English replacement, naming the 2.0.0 rename
- AND WHEN a chat absent from a non-empty `allowed_chat_ids` sends a retired command
- THEN it receives the same "not authorized" reply any other gated command would send,
  not the migration text

#### Scenario: New English command runs the flow

- GIVEN the bot is running with the renamed commands
- WHEN an allowed chat sends `/lights`
- THEN the bot runs the lights flow and replies in English
