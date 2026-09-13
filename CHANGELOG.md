# Changelog

## 2.1.1

Fixes `/switches` failing outright, and the same latent fault in every other
inline keyboard.

Telegram refuses a `callback_data` over 64 bytes, and rejects the **whole
message** when a single button breaks the limit. The payload carried the entity
ID, which has no length bound — a smart plug integration readily produces
`switch.termotanque_electrico_del_lavadero_proteccion_sobrecarga`, and one such
entity made the entire keyboard unsendable. `/switches` hit it first because
those integrations generate the longest names, but `/lights`, `/covers` and
`/cameras` were equally exposed.

- The payload now carries a short digest of the entity ID, so it is a fixed 20–21
  bytes no matter how long the entity is named.
- The entity ID is resolved by matching that digest against the entities the bot
  itself just offered, so it never travels through the user at all. That is
  stronger than the previous check, which validated a user-supplied ID against
  the offered list.
- A button rendered before this release still carries the old payload. Pressing
  one now answers that the keyboard is from an older version and asks you to send
  the command again, instead of refusing without explanation.

## 2.1.0

### Added

- **`/switches`** — switch entities were not surfaced anywhere: no command listed
  them and no keyboard offered them, so a switch in Home Assistant was invisible
  to the bot. It now works exactly like `/lights`: one inline button per switch,
  🟢 when on and ⚫ when off, turning it on or off in place and refreshing the
  keyboard afterwards. Switches are covered by the same entity authorization gate
  as lights and covers, so a callback naming a switch the bot never displayed is
  rejected before any service call.

### Fixed

- **Camera videos and snapshots could not be retrieved.** Sending a recorded clip
  failed with a 403 followed by three 404s. Home Assistant serves its media folder
  through signed media-source URLs, so a request carrying only a bearer token is
  refused — fetching media over HTTP never worked, and the four fallback paths the
  add-on tried were four ways of being wrong.

  The add-on now maps Home Assistant's media folder read-only and reads the file
  off the mount, which is the supported route. **This needs no action from you**:
  the mapping ships with the add-on.

- The wait loop that polls while Home Assistant finishes writing a file decided
  whether to keep waiting by matching the text `API error 404` in an error
  message. Moving the read off HTTP would have made that string stop appearing, so
  the loop would have given up on the first missing-file error instead of waiting.
  Errors now carry an explicit flag.

## 2.0.4

Fixes the add-on schema. `allowed_chat_ids` could not be configured at all since
2.0.0, and this is the defect behind every configuration problem reported against
the 2.0.x line.

`config.yaml` declared:

```yaml
allowed_chat_ids: list(str)
```

That reads as "a list of strings". In the Home Assistant add-on schema `list(...)`
is an **enumeration of literal values**, so it actually meant "this option must be
the text `str`". Home Assistant rendered a dropdown whose only choice was `str`,
which is what installations ended up storing, and saving anything else failed with
`value must be one of [str]`.

The correct syntax for a list of strings is a YAML sequence:

```yaml
allowed_chat_ids:
  - str
```

- Fixed the schema. You can now enter chat IDs as list entries, or leave the option
  empty to allow every chat.
- Added `npm run check:addon`, which validates `config.yaml` against the documented
  schema types and keeps options, schema and `translations/en.yaml` in agreement. It
  rejects this exact mistake with the correct syntax in the message, and runs in CI.
  No test could have caught the original defect: it lived entirely in the manifest.

If your installation still shows `str` stored in **Allowed chat IDs**, clear the
field, save, and then add your IDs as separate entries.

## 2.0.3

Explains the options where you actually configure them, and stops sending you to
a bot that cannot answer.

A Home Assistant long-lived token pasted into `telegram_bot_token` turned out not
to be carelessness: the Configuration screen showed one token field with no
explanation, and this add-on never asks for a Home Assistant credential, so there
was nothing on screen saying which token belonged there.

- Added `translations/en.yaml`, so Home Assistant shows a name and a description
  for every option in the add-on Configuration tab. `telegram_bot_token` now says
  in the UI that it takes the BotFather token and never a Home Assistant one.
- The invalid `allowed_chat_ids` message no longer tells you to send `/chatid` to
  the bot. The add-on refuses to start while the option is invalid, so the bot
  cannot reply. It now tells you to clear the option, start the add-on, ask for
  your ID, and then fill it in.
- The rejected-token message names why no Home Assistant credential is wanted:
  `config.yaml` declares `homeassistant_api`, so the Supervisor injects one.

## 2.0.2

Rejects a misconfigured add-on at startup instead of running in a state where it
answers nobody.

2.0.1 stopped the crash loop, but an add-on whose options were wrong still
started, logged a successful start, and then did nothing — the hardest kind of
failure to read from a log.

- `telegram_bot_token` is now checked for the shape BotFather issues. A Home
  Assistant long-lived token pasted into this field is named as such instead of
  being accepted, which previously let the add-on start and then answer every
  Telegram call with 404. The rejected value never appears in the log.
- `allowed_chat_ids` entries must now look like chat IDs. A value such as the
  literal `str` was previously accepted as a one-entry list, so the add-on
  started cleanly and matched no chat at all.
- Startup no longer reports success when it failed. `deleteWebHook` rejections
  were unhandled and skipped `startPolling` entirely, so the add-on logged a
  successful start and then received nothing. Polling now starts regardless, and
  a token Telegram rejects is reported as such.

## 2.0.1

Fixes an upgrade failure: 2.0.0 crash-looped on any installation that already
had `allowed_chat_ids` configured.

Home Assistant keeps an installation's stored option values when an add-on is
upgraded in place. Renaming the option's schema from `str` to `list(str)` in
2.0.0 did not rewrite what was already stored, so an upgraded add-on received
the old comma-separated string, rejected it, and exited — repeatedly.

- `allowed_chat_ids` now accepts the pre-2.0.0 comma-separated string and logs a
  warning asking you to move each ID to its own list entry. The add-on starts
  either way; nothing is required of you to recover from the crash loop.
- Entries the Supervisor delivers as numbers are coerced to strings. Previously
  a numeric list passed validation, started the add-on, and then denied every
  chat with no error anywhere — a quieter failure than the crash.
- An empty or absent `allowed_chat_ids` is treated as "allow every chat",
  including when it arrives as `null`.
- A shape that cannot be interpreted is still rejected, but the message now
  names the fix instead of only the rule.
- The entrypoint guard no longer throws when `process.argv[1]` is absent.

## 2.0.0

> **⚠️ Breaking release.** Every bot command was renamed and two add-on options were renamed.
> There are no aliases for the old names. **You must reconfigure this add-on's Configuration
> tab after updating**, and you must relearn the commands — see below.

### Breaking: bot commands renamed (English only, no aliases)

`/start`, `/help`, and `/chatid` are unchanged. Every other command was renamed:

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

The old commands are no longer recognized. Typing one of the eight commands above now gets a
reply telling you it was renamed in 2.0.0 and naming its exact replacement — it is not silently
ignored.

### Breaking: add-on options renamed

| Old option (type) | New option (type) |
|---|---|
| `telegram_token` (`str`) | `telegram_bot_token` (`password`) |
| `low_battery_threshold` (`int`) | `low_battery_threshold_percent` (`int(0,100)`) |
| `allowed_chat_ids` (`str`, comma-separated) | `allowed_chat_ids` (`list(str)`) — same name, new type |

### Breaking: bot replies are now in English

Every reply, button label, and error message the bot sends is in English. There is no
language-selection option.

### Reconfiguration steps after updating

1. Open the add-on's **Configuration** tab in Home Assistant.
2. Re-enter your Telegram bot token under the new `telegram_bot_token` field.
3. Re-enter your low-battery threshold under the new `low_battery_threshold_percent` field
   (a number between `0` and `100`).
4. Re-enter each allowed chat ID as its own entry in the `allowed_chat_ids` list, instead of one
   comma-separated string.
5. Save and restart the add-on. It will not start with the old option names in place —
   `telegram_bot_token` is required and validated on startup.
6. Relearn the command names from the table above — your Telegram bot menu and any saved
   shortcuts using the old Spanish commands will stop working.

### Other improvements

- Fixed: the Home Assistant `camera_proxy` snapshot path no longer gets permanently disabled
  after a single empty-but-reachable response; only a chain where every candidate actually fails
  to be reached now falls back to the slower `camera.snapshot` service path.
- Added: every inline-button action (light on/off, cover open/close, camera pick/photo/video) is
  now authorized against the entity list the bot itself most recently offered, on top of the
  chat-level allow-list — a crafted or out-of-band callback can no longer target an entity the
  bot never displayed.
- Added: `/start` and `/help` are now gated by `allowed_chat_ids`, like every other command.
- Added: graceful shutdown — `SIGTERM`/`SIGINT` (sent by the Supervisor on add-on stop, restart,
  or update) now stop polling cleanly before the process exits, instead of being killed mid-request.
- Improved: the test suite grew from 59 to 141 tests.
