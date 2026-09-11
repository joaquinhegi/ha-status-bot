# Bot Authorization Specification

## Purpose

Defines the chat-id allow-list gate and the entity-id membership check that must precede any privileged Home Assistant call, closing the callback_query validation gap found at `src/telegram.js:394-421,463-497`.

## Requirements

### Requirement: Chat-ID Allow-List Gates Privileged Commands

The system MUST reject any command or callback other than `/chatid` from a `chat_id` not present in `allowed_chat_ids`, replying in English with the requester's own `chat_id` so they can request access.

#### Scenario: Allowed chat proceeds

- GIVEN `chat_id` is in `allowed_chat_ids`
- WHEN the chat sends any gated command
- THEN the bot executes the command normally

#### Scenario: Disallowed chat is denied with guidance

- GIVEN `chat_id` is not in `allowed_chat_ids`
- WHEN the chat sends a gated command
- THEN the bot replies in English with an authorization-denied message that includes the chat's own `chat_id`

### Requirement: /start and /help Are Gated

`/start` and `/help` MUST be subject to the same allow-list check as every other command (previously they bypassed it at `src/telegram.js:205-244`).

#### Scenario: Unauthorized /start is denied

- GIVEN `chat_id` is not in `allowed_chat_ids`
- WHEN the chat sends `/start`
- THEN the bot replies with the authorization-denied message instead of the command list

### Requirement: /chatid Stays Ungated By Design

`/chatid` MUST remain reachable by any chat regardless of `allowed_chat_ids`, so an unauthorized user can discover their own `chat_id` and request access. This is intentional and MUST NOT be "fixed" into a gated command later.

#### Scenario: Unknown user discovers their chat_id

- GIVEN `chat_id` is not in `allowed_chat_ids`
- WHEN the chat sends `/chatid`
- THEN the bot replies with that chat's `chat_id`, with no authorization error

### Requirement: Entity-ID Membership Validation Before Privileged Calls

Before invoking `ha.callService` (lights/covers) or a camera snapshot/record call from a `callback_query`, the system MUST verify the `entity_id` parsed from `callback_data` belongs to the most recently fetched candidate set for that domain (the entities the bot itself last offered in its inline keyboard). If it does not, the system MUST reject the action and MUST NOT call the HA API.

#### Scenario: Offered entity is accepted

- GIVEN the bot most recently offered `light.kitchen` in an inline keyboard
- WHEN the callback `entity_id` is `light.kitchen`
- THEN `ha.callService` is invoked normally

#### Scenario: Forged entity is rejected before any HA call

- GIVEN the bot most recently offered only `light.kitchen`, `light.living_room`
- WHEN a callback arrives with `entity_id=light.bedroom_lock` (never offered)
- THEN the bot replies with a safe English rejection message and issues zero HA API calls
