import TelegramBot from "node-telegram-bot-api";

import {
  formatBatteries,
  formatDoors,
  formatFullStatus,
  formatSensors,
  formatTemperatures,
  getAllCameras,
  getAllCovers,
  getAllLights,
  getAllSwitches,
} from "./formatter.js";
import { CAMERA_CLIP_DURATION_SECONDS } from "./haClient.js";

function isAllowed(chatId, allowedChatIds) {
  if (!allowedChatIds.length) {
    return true;
  }

  return allowedChatIds.includes(String(chatId));
}

async function safeReply(bot, chatId, text) {
  const maxLength = 3900;

  if (text.length <= maxLength) {
    await bot.sendMessage(chatId, text);
    return;
  }

  const chunks = [];

  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
  }
}

function buildCameraListKeyboard(cameras) {
  return cameras.map((camera) => [
    {
      text: `📷 ${camera.name}`,
      callback_data: `camera_pick:${camera.entity_id}`,
    },
  ]);
}

function buildLightKeyboard(lights) {
  return lights.map((light) => {
    const icon = light.state === "on" ? "🟡" : "⚫";
    const actionLabel = light.state === "on" ? "Turn off" : "Turn on";
    const action = light.state === "on" ? "light_off" : "light_on";
    return [
      {
        text: `${icon} ${light.name} → ${actionLabel}`,
        callback_data: `${action}:${light.entity_id}`,
      },
    ];
  });
}

function buildSwitchKeyboard(switches) {
  return switches.map((item) => {
    const isOn = item.state === "on";
    const icon = isOn ? "🟢" : "⚫";
    const actionLabel = isOn ? "Turn off" : "Turn on";
    const action = isOn ? "switch_off" : "switch_on";
    return [
      {
        text: `${icon} ${item.name} → ${actionLabel}`,
        callback_data: `${action}:${item.entity_id}`,
      },
    ];
  });
}

function buildCoverKeyboard(covers) {
  return covers.map((cover) => {
    const isOpen = cover.state === "open";
    const icon = isOpen ? "🟢" : "🔴";
    const actionLabel = isOpen ? "Close" : "Open";
    const action = isOpen ? "cover_close" : "cover_open";
    return [
      {
        text: `${icon} ${cover.name} (${cover.state}) → ${actionLabel}`,
        callback_data: `${action}:${cover.entity_id}`,
      },
    ];
  });
}

// Fetches the current HA states, narrows them through `selector`, and builds
// the inline keyboard via `keyboardBuilder`. This is the fetch-plus-rebuild
// sequence genuinely shared by the /lights, /covers, /cameras handlers (via
// replyWithEntityKeyboard below) and the post-action keyboard refresh in the
// callback_query handler, which calls it directly. See code-quality-hygiene
// spec, "Shared Helper for Repeated Fetch+Keyboard+Error Pattern".
async function fetchEntityKeyboard(ha, selector, keyboardBuilder) {
  const states = await ha.getStates();
  const entities = selector(states);
  return { entities, keyboard: keyboardBuilder(entities) };
}

// Wraps fetchEntityKeyboard with the reply/empty-state/error handling shared
// by the /lights, /covers, and /cameras commands: fetch, log the count, reply
// with an empty-state message when nothing was found, or send the built
// keyboard, catching any HA error the same way in all three. The callback
// refresh block cannot reuse this wrapper without changing its behavior: it
// edits an existing message instead of sending a new one, has no empty-state
// reply, and already shares the callback handler's own try/catch, so it calls
// fetchEntityKeyboard directly instead (see the callback_query handler below).
async function replyWithEntityKeyboard(
  bot,
  chatId,
  ha,
  { commandLabel, entityNoun, selector, keyboardBuilder, emptyMessage, listMessage },
) {
  try {
    const { entities, keyboard } = await fetchEntityKeyboard(ha, selector, keyboardBuilder);
    console.log(`[Telegram] ${commandLabel}: ${entities.length} ${entityNoun} found`);

    if (!entities.length) {
      await bot.sendMessage(chatId, emptyMessage);
      return;
    }

    await bot.sendMessage(chatId, listMessage, {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error) {
    console.error(`[Telegram] Error processing ${commandLabel}:`, error);
    await bot.sendMessage(chatId, `Error querying Home Assistant: ${error.message}`);
  }
}

function cameraOptionsKeyboard(entityId) {
  return [
    [
      {
        text: "🖼️ Send photo",
        callback_data: `camera_img:${entityId}`,
      },
    ],
    [
      {
        text: `🎥 Send video (${CAMERA_CLIP_DURATION_SECONDS}s)`,
        callback_data: `camera_vid${CAMERA_CLIP_DURATION_SECONDS}:${entityId}`,
      },
    ],
    [
      {
        text: "⬅️ Back to cameras",
        callback_data: "camera_list",
      },
    ],
  ];
}

async function waitForMediaFile(ha, mediaPath, timeoutMs = 45000, intervalMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const media = await ha.getMediaFile(mediaPath);

      if (media?.buffer?.length > 0) {
        return media;
      }

      lastError = new Error("Empty media file");
    } catch (error) {
      lastError = error;
      if (!String(error.message || "").includes("API error 404")) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error("Could not retrieve the video in time.");
}

function isExpiredCallbackError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("query is too old") ||
    msg.includes("query id is invalid") ||
    msg.includes("response timeout expired")
  );
}

async function safeAnswerCallback(bot, callbackId, text) {
  try {
    await bot.answerCallbackQuery(callbackId, { text });
  } catch (error) {
    if (isExpiredCallbackError(error)) {
      console.warn(`[Telegram] Callback expired while answering: ${text}`);
      return;
    }

    throw error;
  }
}

function ensureNonEmptyBuffer(buffer, label) {
  if (!buffer?.length) {
    throw new Error(`${label} is empty`);
  }
}

async function waitForSnapshot(ha, entityId) {
  return ha.getCameraSnapshot(entityId);
}

async function sendPhotoWithFallback(bot, chatId, buffer, caption, fileName, contentType) {
  ensureNonEmptyBuffer(buffer, "Image");

  try {
    await bot.sendPhoto(chatId, buffer, { caption }, { filename: fileName, contentType });
  } catch (error) {
    console.warn("[Telegram] sendPhoto failed, sending as document:", error.message);
    await bot.sendDocument(
      chatId,
      buffer,
      { caption: `${caption} (sent as file)` },
      { filename: fileName, contentType },
    );
  }
}

async function sendVideoWithFallback(bot, chatId, buffer, caption, fileName, contentType) {
  ensureNonEmptyBuffer(buffer, "Video");

  try {
    await bot.sendVideo(chatId, buffer, { caption }, { filename: fileName, contentType });
  } catch (error) {
    console.warn("[Telegram] sendVideo failed, sending as document:", error.message);
    await bot.sendDocument(
      chatId,
      buffer,
      { caption: `${caption} (sent as file)` },
      { filename: fileName, contentType },
    );
  }
}

// Shape-only check: syntactically valid entity_id, not an authorization decision.
const ENTITY_ID_SHAPE = /^[a-z_]+\.[a-z0-9_]+$/;

// Maps each privileged callback action to the same formatter selector used to
// build the keyboard that offered it. An action absent from this map (e.g.
// camera_list, or an unrecognized action) carries no entity to authorize.
const OFFERED_ENTITY_SELECTORS = {
  light_on: getAllLights,
  light_off: getAllLights,
  switch_on: getAllSwitches,
  switch_off: getAllSwitches,
  cover_open: getAllCovers,
  cover_close: getAllCovers,
  camera_pick: getAllCameras,
  camera_img: getAllCameras,
  [`camera_vid${CAMERA_CLIP_DURATION_SECONDS}`]: getAllCameras,
};

// Authorizes a callback_query entity_id against the domain's currently valid
// entities (fetched fresh, not cached per-chat). A shape-only regex check
// would still let a forged callback drive any entity_id of the right domain;
// membership against the selector output is the actual authorization
// boundary. Returns `requiresEntity: false` for actions with no entity to
// authorize (e.g. camera_list, unknown actions).
function resolveOfferedEntity(action, entityId, states) {
  const selector = OFFERED_ENTITY_SELECTORS[action];

  if (!selector) {
    return { requiresEntity: false, offered: null };
  }

  if (!ENTITY_ID_SHAPE.test(entityId || "")) {
    return { requiresEntity: true, offered: null };
  }

  const offered = selector(states).find((candidate) => candidate.entity_id === entityId) || null;
  return { requiresEntity: true, offered };
}

// Single source of truth for the 2.0.0 Spanish→English command rename. The
// retired-command listener below builds both its matcher and its reply text
// from this one map, so the two cannot drift apart, and so a new retirement
// only ever needs an entry added here.
const RETIRED_COMMAND_MIGRATIONS = {
  estado: "status",
  luces: "lights",
  sensores: "sensors",
  puertas: "doors",
  bateria: "battery",
  temp: "temperature",
  persianas: "covers",
  camaras: "cameras",
};

// Anchored so a retired command can never match as a mere substring of a
// live one — e.g. an unanchored /temp would also fire on /temperature. `\b`
// after the command name additionally stops it from matching a live command
// that happens to start with the same letters.
const RETIRED_COMMAND_PATTERN = new RegExp(
  `^/(${Object.keys(RETIRED_COMMAND_MIGRATIONS).join("|")})\\b`,
);

export function createTelegramBot({
  token,
  allowedChatIds,
  lowBatteryThreshold,
  ha,
  createBot = (botToken) =>
    new TelegramBot(botToken, {
      polling: {
        autoStart: false,
      },
    }),
  logger = console,
}) {
  const bot = createBot(token);

  // Without the catch this rejection was unhandled, and startPolling never ran:
  // the bot logged a successful start and then received nothing, forever. Poll
  // regardless of what deleteWebHook does, so a failure shows up as a
  // polling_error the operator can act on rather than as silence.
  bot
    .deleteWebHook({ drop_pending_updates: true })
    .then(() => {
      logger.log("[Telegram] Webhook removed.");
    })
    .catch((error) => {
      if (error.response?.statusCode === 401 || error.response?.statusCode === 404) {
        logger.error(
          "[Telegram] Telegram rejected the bot token. Check telegram_bot_token in the add-on " +
            "Configuration tab — it must be the token BotFather issued for this bot.",
        );
      } else {
        logger.error("[Telegram] Could not remove the webhook:", error.message);
      }
    })
    .finally(() => {
      bot.startPolling();
      logger.log("[Telegram] Polling started.");
    });

  async function handleCommand(msg, formatter) {
    const chatId = msg.chat.id;
    const cmdText = msg.text;
    console.log(`[Telegram] Command received: ${cmdText} from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    try {
      const states = await ha.getStates();
      const text = formatter(states);
      await safeReply(bot, chatId, text);
      console.log(`[Telegram] Reply sent for ${cmdText} to chat_id=${chatId}`);
    } catch (error) {
      console.error(`[Telegram] Error processing ${cmdText}:`, error);
      await bot.sendMessage(chatId, `Error querying Home Assistant: ${error.message}`);
    }
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /start from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await bot.sendMessage(
      chatId,
      [
        "Hello 👋",
        "",
        "Available commands:",
        "/status - General summary",
        "/lights - Lights (turn on/off)",
        "/switches - Switches (turn on/off)",
        "/covers - Covers (open/close)",
        "/cameras - Camera selection",
        "/sensors - Active sensors",
        "/doors - Open doors and windows",
        "/battery - Low batteries",
        "/temperature - Temperatures",
        "/chatid - View your chat_id",
      ].join("\n"),
    );
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /help from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await bot.sendMessage(
      chatId,
      [
        "Commands:",
        "/status",
        "/lights",
        "/switches",
        "/cameras",
        "/sensors",
        "/doors",
        "/battery",
        "/temperature",
        "/chatid",
      ].join("\n"),
    );
  });

  // /chatid intentionally stays ungated: an unauthorized user must be able to
  // discover their own chat_id in order to request access. Do not add an
  // isAllowed(...) check here — see the bot-authorization spec, requirement
  // "/chatid Stays Ungated By Design".
  bot.onText(/\/chatid/, async (msg) => {
    console.log(`[Telegram] /chatid from chat_id=${msg.chat.id}`);
    await bot.sendMessage(msg.chat.id, `Your chat_id is: ${msg.chat.id}`);
  });

  bot.onText(/\/status/, (msg) => {
    console.log(`[Telegram] /status from chat_id=${msg.chat.id}`);
    return handleCommand(msg, (states) => formatFullStatus(states, lowBatteryThreshold));
  });

  bot.onText(/\/lights/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /lights from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await replyWithEntityKeyboard(bot, chatId, ha, {
      commandLabel: "/lights",
      entityNoun: "lights",
      selector: getAllLights,
      keyboardBuilder: buildLightKeyboard,
      emptyMessage: "💡 No lights available.",
      listMessage: "💡 Lights:",
    });
  });

  bot.onText(/\/switches/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /switches from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await replyWithEntityKeyboard(bot, chatId, ha, {
      commandLabel: "/switches",
      entityNoun: "switches",
      selector: getAllSwitches,
      keyboardBuilder: buildSwitchKeyboard,
      emptyMessage: "🔌 No switches available.",
      listMessage: "🔌 Switches:",
    });
  });

  bot.onText(/\/sensors/, (msg) => {
    console.log(`[Telegram] /sensors from chat_id=${msg.chat.id}`);
    return handleCommand(msg, formatSensors);
  });

  bot.onText(/\/doors/, (msg) => {
    console.log(`[Telegram] /doors from chat_id=${msg.chat.id}`);
    return handleCommand(msg, formatDoors);
  });

  bot.onText(/\/battery/, (msg) => {
    console.log(`[Telegram] /battery from chat_id=${msg.chat.id}`);
    return handleCommand(msg, (states) => formatBatteries(states, lowBatteryThreshold));
  });

  bot.onText(/\/temperature/, (msg) => {
    console.log(`[Telegram] /temperature from chat_id=${msg.chat.id}`);
    return handleCommand(msg, formatTemperatures);
  });

  bot.onText(/\/covers/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /covers from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await replyWithEntityKeyboard(bot, chatId, ha, {
      commandLabel: "/covers",
      entityNoun: "covers",
      selector: getAllCovers,
      keyboardBuilder: buildCoverKeyboard,
      emptyMessage: "🪟 No covers available.",
      listMessage: "🪟 Covers:",
    });
  });

  bot.onText(/\/cameras/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /cameras from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await replyWithEntityKeyboard(bot, chatId, ha, {
      commandLabel: "/cameras",
      entityNoun: "cameras",
      selector: getAllCameras,
      keyboardBuilder: buildCameraListKeyboard,
      emptyMessage: "📷 No cameras available.",
      listMessage: "📷 Select a camera:",
    });
  });

  // Replies ONLY to the eight retired Spanish commands named in
  // RETIRED_COMMAND_MIGRATIONS, telling the user their exact replacement.
  //
  // Deliberate scope limit — do NOT turn this into a general catch-all for
  // arbitrary text. A bot that answers every message it receives is unusable
  // in a group chat: it would reply to normal conversation between people
  // that never intended to address it. Only these eight literal commands
  // get a reply; every other message still gets none.
  //
  // Gated by the allow-list like every other command (unlike /chatid, which
  // is deliberately ungated so a brand-new user can discover their chat_id).
  // These are not brand-new users: they already typed a command that worked
  // before 2.0.0, so an authorized chat still gets guided to the rename. An
  // unauthorized chat gets the same "Not authorized" answer as any other
  // command instead of a free map of the bot's renamed command surface.
  bot.onText(RETIRED_COMMAND_PATTERN, async (msg, match) => {
    const chatId = msg.chat.id;
    const oldCommand = match[1];
    const newCommand = RETIRED_COMMAND_MIGRATIONS[oldCommand];
    console.log(`[Telegram] Retired command /${oldCommand} from chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized chat: ${chatId}`);
      await bot.sendMessage(chatId, `Not authorized. Your chat_id is: ${chatId}`);
      return;
    }

    await bot.sendMessage(
      chatId,
      `/${oldCommand} was renamed in 2.0.0 — use /${newCommand} instead.`,
    );
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const [action, ...payloadParts] = query.data.split(":");
    const entityId = payloadParts.join(":");
    const answer = (text) => safeAnswerCallback(bot, query.id, text);
    console.log(
      `[Telegram] Callback: ${action} → ${entityId || "(no payload)"} from chat_id=${chatId}`,
    );

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Unauthorized callback: chat_id=${chatId}`);
      await answer("Not authorized.");
      return;
    }

    try {
      const states = await ha.getStates();
      const gate = resolveOfferedEntity(action, entityId, states);

      if (gate.requiresEntity && !gate.offered) {
        console.warn(
          `[Telegram] Rejected entity not offered: ${action} -> ${entityId || "(no payload)"}`,
        );
        await answer("Entity not authorized.");
        return;
      }

      if (action === "light_on") {
        await ha.callService("light", "turn_on", { entity_id: entityId });
        console.log(`[Telegram] Light turned on: ${entityId}`);
        await answer("💡 Light turned on");
      } else if (action === "light_off") {
        await ha.callService("light", "turn_off", { entity_id: entityId });
        console.log(`[Telegram] Light turned off: ${entityId}`);
        await answer("💡 Light turned off");
      } else if (action === "switch_on") {
        await ha.callService("switch", "turn_on", { entity_id: entityId });
        console.log(`[Telegram] Switch turned on: ${entityId}`);
        await answer("🔌 Switch turned on");
      } else if (action === "switch_off") {
        await ha.callService("switch", "turn_off", { entity_id: entityId });
        console.log(`[Telegram] Switch turned off: ${entityId}`);
        await answer("🔌 Switch turned off");
      } else if (action === "cover_open") {
        await ha.callService("cover", "open_cover", { entity_id: entityId });
        console.log(`[Telegram] Cover opened: ${entityId}`);
        await answer("🪟 Cover opened");
      } else if (action === "cover_close") {
        await ha.callService("cover", "close_cover", { entity_id: entityId });
        console.log(`[Telegram] Cover closed: ${entityId}`);
        await answer("🪟 Cover closed");
      } else if (action === "camera_pick") {
        const selected = gate.offered;

        await answer(`Camera: ${selected.name}`);
        await bot.editMessageText(`📷 ${selected.name}\n\nChoose an option:`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: cameraOptionsKeyboard(entityId),
          },
        });
        return;
      } else if (action === "camera_list") {
        const cameras = getAllCameras(states);

        await answer("Camera list");

        if (!cameras.length) {
          await bot.editMessageText("📷 No cameras available.", {
            chat_id: chatId,
            message_id: query.message.message_id,
          });
          return;
        }

        await bot.editMessageText("📷 Select a camera:", {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: buildCameraListKeyboard(cameras),
          },
        });
        return;
      } else if (action === "camera_img") {
        await answer("Sending photo...");

        const selected = gate.offered;
        const snapshot = await waitForSnapshot(ha, entityId);
        await sendPhotoWithFallback(
          bot,
          chatId,
          snapshot.buffer,
          `📷 ${selected?.name || entityId}`,
          `${entityId.replace(/\W+/g, "_")}.jpg`,
          snapshot.contentType,
        );
        return;
      } else if (action === `camera_vid${CAMERA_CLIP_DURATION_SECONDS}`) {
        await answer(`Recording video (${CAMERA_CLIP_DURATION_SECONDS}s)...`);

        const selected = gate.offered;

        await bot.sendMessage(
          chatId,
          `🎥 Recording ${CAMERA_CLIP_DURATION_SECONDS} seconds of ${selected?.name || entityId}...`,
        );

        try {
          const clip = await ha.recordCameraClip(entityId, CAMERA_CLIP_DURATION_SECONDS);
          const video = await waitForMediaFile(ha, clip.publicPath, 90000, 3000);

          await sendVideoWithFallback(
            bot,
            chatId,
            video.buffer,
            `🎥 ${selected?.name || entityId} (${CAMERA_CLIP_DURATION_SECONDS}s)`,
            `${entityId.replace(/\W+/g, "_")}_${CAMERA_CLIP_DURATION_SECONDS}s.mp4`,
            video.contentType,
          );
        } catch (recordError) {
          if (recordError.path === "/services/camera/record" && recordError.status >= 500) {
            await bot.sendMessage(
              chatId,
              "⚠️ This camera does not support recording video from Home Assistant (camera.record). Sending a photo instead.",
            );

            const snapshot = await waitForSnapshot(ha, entityId);
            await sendPhotoWithFallback(
              bot,
              chatId,
              snapshot.buffer,
              `📷 ${selected?.name || entityId}`,
              `${entityId.replace(/\W+/g, "_")}.jpg`,
              snapshot.contentType,
            );
            return;
          }

          throw recordError;
        }
        return;
      } else {
        console.log(`[Telegram] Unknown action: ${action}`);
        await answer("Unknown action");
        return;
      }

      // Refresh the inline keyboard after action (a fresh fetch is required
      // here: the action above just changed the entity's state). Uses
      // fetchEntityKeyboard directly rather than replyWithEntityKeyboard: it
      // edits the existing message instead of sending a new one, has no
      // empty-state reply, and shares this handler's own try/catch below.
      if (action.startsWith("light_")) {
        const { keyboard } = await fetchEntityKeyboard(ha, getAllLights, buildLightKeyboard);
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id },
        );
      } else if (action.startsWith("switch_")) {
        const { keyboard } = await fetchEntityKeyboard(ha, getAllSwitches, buildSwitchKeyboard);
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id },
        );
      } else if (action.startsWith("cover_")) {
        const { keyboard } = await fetchEntityKeyboard(ha, getAllCovers, buildCoverKeyboard);
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id },
        );
      }
    } catch (error) {
      console.error(
        `[Telegram] Error processing callback ${action} → ${entityId}: ${error.message}`,
      );
      try {
        await bot.sendMessage(chatId, `⚠️ Error in ${action}: ${error.message}`);
      } catch {
        // If sending the message fails, at least try to answer the callback.
      }
      await answer(`Error: ${error.message}`);
    }
  });

  bot.on("polling_error", (error) => {
    console.error("[Telegram] Polling error:", error.message, error.code);
  });

  logger.log("Telegram bot started.");
  return bot;
}
