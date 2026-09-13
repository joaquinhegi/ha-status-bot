# Changelog

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
