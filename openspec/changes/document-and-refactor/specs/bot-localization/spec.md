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

Every bot command MUST be renamed per the table below, with no Spanish alias registered for any of them.

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
- WHEN a chat sends `/luces`
- THEN the bot does not run the lights flow (falls through to unknown-command handling)

#### Scenario: New English command runs the flow

- GIVEN the bot is running with the renamed commands
- WHEN an allowed chat sends `/lights`
- THEN the bot runs the lights flow and replies in English
