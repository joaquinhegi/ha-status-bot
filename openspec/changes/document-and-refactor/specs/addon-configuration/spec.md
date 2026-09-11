# Add-on Configuration Specification

## Purpose

Defines the breaking-but-minimal rename and retype of `config.yaml`'s add-on options, given that `homeassistant_api: true` already causes the Supervisor to inject `SUPERVISOR_TOKEN` (see `ha-connection-config`).

## Requirements

### Requirement: Renamed and Retyped Options

`config.yaml`'s `options` and `schema` blocks MUST match this table.

| Old name (type) | New name (type) | Rationale |
|---|---|---|
| `telegram_token` (password) | `telegram_bot_token` (password) | Disambiguates the Telegram bot's own token from the HA `SUPERVISOR_TOKEN` now referenced in the same configuration surface |
| `allowed_chat_ids` (str) | `allowed_chat_ids` (list(str)) | Replaces ad hoc comma-separated string parsing with a typed, repeatable Supervisor UI field; name is unchanged because it was already accurate |
| `low_battery_threshold` (int) | `low_battery_threshold_percent` (int, bounded 0-100) | States the unit explicitly in the name; type is bounded to a valid percentage |

#### Scenario: config.yaml reflects the new schema

- GIVEN `config.yaml` is read
- WHEN inspecting `options` and `schema`
- THEN the three entries match the table's new names, types, and bounds exactly

### Requirement: Add-on Description Is English

The add-on `description` field MUST be English (it currently reads, in Spanish, "Bot de Telegram para consultar luces, sensores, puertas, baterías y temperaturas de Home Assistant").

#### Scenario: Description is English

- GIVEN `config.yaml` is read
- WHEN inspecting the `description` field
- THEN it contains no Spanish text
