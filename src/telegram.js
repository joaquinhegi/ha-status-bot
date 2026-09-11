import TelegramBot from "node-telegram-bot-api";

import {
  formatBatteries,
  formatDoors,
  formatFullStatus,
  formatLights,
  formatSensors,
  formatTemperatures,
  getAllLights,
  getAllCovers,
  getAllCameras,
} from "./formatter.js";

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
    const actionLabel = light.state === "on" ? "Apagar" : "Encender";
    const action = light.state === "on" ? "light_off" : "light_on";
    return [
      {
        text: `${icon} ${light.name} → ${actionLabel}`,
        callback_data: `${action}:${light.entity_id}`,
      },
    ];
  });
}

function buildCoverKeyboard(covers) {
  return covers.map((cover) => {
    const isOpen = cover.state === "open";
    const icon = isOpen ? "🟢" : "🔴";
    const actionLabel = isOpen ? "Cerrar" : "Abrir";
    const action = isOpen ? "cover_close" : "cover_open";
    return [
      {
        text: `${icon} ${cover.name} (${cover.state}) → ${actionLabel}`,
        callback_data: `${action}:${cover.entity_id}`,
      },
    ];
  });
}

function cameraOptionsKeyboard(entityId) {
  return [
    [
      {
        text: "🖼️ Enviar imagen",
        callback_data: `camera_img:${entityId}`,
      },
    ],
    [
      {
        text: "🎥 Enviar video (30s)",
        callback_data: `camera_vid30:${entityId}`,
      },
    ],
    [
      {
        text: "⬅️ Volver a cámaras",
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

      lastError = new Error("Archivo multimedia vacío");
    } catch (error) {
      lastError = error;
      if (!String(error.message || "").includes("API error 404")) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error("No se pudo obtener el video a tiempo.");
}

function isExpiredCallbackError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("query is too old") || msg.includes("query id is invalid") || msg.includes("response timeout expired");
}

async function safeAnswerCallback(bot, callbackId, text) {
  try {
    await bot.answerCallbackQuery(callbackId, { text });
  } catch (error) {
    if (isExpiredCallbackError(error)) {
      console.warn(`[Telegram] Callback expirado al responder: ${text}`);
      return;
    }

    throw error;
  }
}

function ensureNonEmptyBuffer(buffer, label) {
  if (!buffer || !buffer.length) {
    throw new Error(`${label} vacío`);
  }
}

async function waitForSnapshot(ha, entityId) {
  return ha.getCameraSnapshot(entityId);
}

async function sendPhotoWithFallback(bot, chatId, buffer, caption, fileName, contentType) {
  ensureNonEmptyBuffer(buffer, "Imagen");

  try {
    await bot.sendPhoto(chatId, buffer, { caption }, { filename: fileName, contentType });
  } catch (error) {
    console.warn("[Telegram] sendPhoto falló, envío como documento:", error.message);
    await bot.sendDocument(
      chatId,
      buffer,
      { caption: `${caption} (enviado como archivo)` },
      { filename: fileName, contentType }
    );
  }
}

async function sendVideoWithFallback(bot, chatId, buffer, caption, fileName, contentType) {
  ensureNonEmptyBuffer(buffer, "Video");

  try {
    await bot.sendVideo(chatId, buffer, { caption }, { filename: fileName, contentType });
  } catch (error) {
    console.warn("[Telegram] sendVideo falló, envío como documento:", error.message);
    await bot.sendDocument(
      chatId,
      buffer,
      { caption: `${caption} (enviado como archivo)` },
      { filename: fileName, contentType }
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
  cover_open: getAllCovers,
  cover_close: getAllCovers,
  camera_pick: getAllCameras,
  camera_img: getAllCameras,
  camera_vid30: getAllCameras,
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

  bot.deleteWebHook({ drop_pending_updates: true }).then(() => {
    bot.startPolling();
    logger.log("[Telegram] Polling iniciado (webhook eliminado).");
  });

  async function handleCommand(msg, formatter) {
    const chatId = msg.chat.id;
    const cmdText = msg.text;
    console.log(`[Telegram] Comando recibido: ${cmdText} de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Chat no autorizado: ${chatId}`);
      await bot.sendMessage(
        chatId,
        `No autorizado. Tu chat_id es: ${chatId}`
      );
      return;
    }

    try {
      const states = await ha.getStates();
      const text = formatter(states);
      await safeReply(bot, chatId, text);
      console.log(`[Telegram] Respuesta enviada para ${cmdText} a chat_id=${chatId}`);
    } catch (error) {
      console.error(`[Telegram] Error procesando ${cmdText}:`, error);
      await bot.sendMessage(
        chatId,
        `Error consultando Home Assistant: ${error.message}`
      );
    }
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /start de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Chat no autorizado: ${chatId}`);
      await bot.sendMessage(chatId, `No autorizado. Tu chat_id es: ${chatId}`);
      return;
    }

    await bot.sendMessage(
      chatId,
      [
        "Hola 👋",
        "",
        "Comandos disponibles:",
        "/estado - Resumen general",
        "/luces - Luces (encender/apagar)",
        "/persianas - Persianas (abrir/cerrar)",
        "/camaras - Selección de cámaras",
        "/sensores - Sensores activos",
        "/puertas - Puertas y ventanas abiertas",
        "/bateria - Baterías bajas",
        "/temp - Temperaturas",
        "/chatid - Ver tu chat_id",
      ].join("\n")
    );
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /help de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Chat no autorizado: ${chatId}`);
      await bot.sendMessage(chatId, `No autorizado. Tu chat_id es: ${chatId}`);
      return;
    }

    await bot.sendMessage(
      chatId,
      [
        "Comandos:",
        "/estado",
        "/luces",
        "/camaras",
        "/sensores",
        "/puertas",
        "/bateria",
        "/temp",
        "/chatid",
      ].join("\n")
    );
  });

  // /chatid intentionally stays ungated: an unauthorized user must be able to
  // discover their own chat_id in order to request access. Do not add an
  // isAllowed(...) check here — see the bot-authorization spec, requirement
  // "/chatid Stays Ungated By Design".
  bot.onText(/\/chatid/, async (msg) => {
    console.log(`[Telegram] /chatid de chat_id=${msg.chat.id}`);
    await bot.sendMessage(msg.chat.id, `Tu chat_id es: ${msg.chat.id}`);
  });

  bot.onText(/\/estado/, (msg) => {
    console.log(`[Telegram] /estado de chat_id=${msg.chat.id}`);
    return handleCommand(msg, (states) =>
      formatFullStatus(states, lowBatteryThreshold)
    );
  });

  bot.onText(/\/luces/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /luces de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Chat no autorizado: ${chatId}`);
      await bot.sendMessage(chatId, `No autorizado. Tu chat_id es: ${chatId}`);
      return;
    }

    try {
      const states = await ha.getStates();
      const lights = getAllLights(states);
      console.log(`[Telegram] /luces: ${lights.length} luces encontradas`);

      if (!lights.length) {
        await bot.sendMessage(chatId, "💡 No hay luces disponibles.");
        return;
      }

      const keyboard = buildLightKeyboard(lights);

      await bot.sendMessage(chatId, "💡 Luces:", {
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      console.error("[Telegram] Error procesando /luces:", error);
      await bot.sendMessage(chatId, `Error consultando Home Assistant: ${error.message}`);
    }
  });

  bot.onText(/\/sensores/, (msg) => {
    console.log(`[Telegram] /sensores de chat_id=${msg.chat.id}`);
    return handleCommand(msg, formatSensors);
  });

  bot.onText(/\/puertas/, (msg) => {
    console.log(`[Telegram] /puertas de chat_id=${msg.chat.id}`);
    return handleCommand(msg, formatDoors);
  });

  bot.onText(/\/bateria/, (msg) => {
    console.log(`[Telegram] /bateria de chat_id=${msg.chat.id}`);
    return handleCommand(msg, (states) =>
      formatBatteries(states, lowBatteryThreshold)
    );
  });

  bot.onText(/\/temp/, (msg) => {
    console.log(`[Telegram] /temp de chat_id=${msg.chat.id}`);
    return handleCommand(msg, formatTemperatures);
  });

  bot.onText(/\/persianas/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /persianas de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Chat no autorizado: ${chatId}`);
      await bot.sendMessage(chatId, `No autorizado. Tu chat_id es: ${chatId}`);
      return;
    }

    try {
      const states = await ha.getStates();
      const covers = getAllCovers(states);
      console.log(`[Telegram] /persianas: ${covers.length} persianas encontradas`);

      if (!covers.length) {
        await bot.sendMessage(chatId, "🪟 No hay persianas disponibles.");
        return;
      }

      const keyboard = buildCoverKeyboard(covers);

      await bot.sendMessage(chatId, "🪟 Persianas:", {
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      console.error("[Telegram] Error procesando /persianas:", error);
      await bot.sendMessage(chatId, `Error consultando Home Assistant: ${error.message}`);
    }
  });

  bot.onText(/\/camaras/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] /camaras de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Chat no autorizado: ${chatId}`);
      await bot.sendMessage(chatId, `No autorizado. Tu chat_id es: ${chatId}`);
      return;
    }

    try {
      const states = await ha.getStates();
      const cameras = getAllCameras(states);
      console.log(`[Telegram] /camaras: ${cameras.length} cámaras encontradas`);

      if (!cameras.length) {
        await bot.sendMessage(chatId, "📷 No hay cámaras disponibles.");
        return;
      }

      await bot.sendMessage(chatId, "📷 Seleccioná una cámara:", {
        reply_markup: { inline_keyboard: buildCameraListKeyboard(cameras) },
      });
    } catch (error) {
      console.error("[Telegram] Error procesando /camaras:", error);
      await bot.sendMessage(chatId, `Error consultando Home Assistant: ${error.message}`);
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const [action, ...payloadParts] = query.data.split(":");
    const entityId = payloadParts.join(":");
    const answer = (text) => safeAnswerCallback(bot, query.id, text);
    console.log(`[Telegram] Callback: ${action} → ${entityId || "(sin payload)"} de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Callback no autorizado: chat_id=${chatId}`);
      await answer("No autorizado.");
      return;
    }

    try {
      const states = await ha.getStates();
      const gate = resolveOfferedEntity(action, entityId, states);

      if (gate.requiresEntity && !gate.offered) {
        console.warn(`[Telegram] Entidad no ofrecida rechazada: ${action} -> ${entityId || "(sin payload)"}`);
        await answer("Entidad no autorizada.");
        return;
      }

      if (action === "light_on") {
        await ha.callService("light", "turn_on", { entity_id: entityId });
        console.log(`[Telegram] Luz encendida: ${entityId}`);
        await answer("💡 Luz encendida");
      } else if (action === "light_off") {
        await ha.callService("light", "turn_off", { entity_id: entityId });
        console.log(`[Telegram] Luz apagada: ${entityId}`);
        await answer("💡 Luz apagada");
      } else if (action === "cover_open") {
        await ha.callService("cover", "open_cover", { entity_id: entityId });
        console.log(`[Telegram] Persiana abierta: ${entityId}`);
        await answer("🪟 Persiana abierta");
      } else if (action === "cover_close") {
        await ha.callService("cover", "close_cover", { entity_id: entityId });
        console.log(`[Telegram] Persiana cerrada: ${entityId}`);
        await answer("🪟 Persiana cerrada");
      } else if (action === "camera_pick") {
        const selected = gate.offered;

        await answer(`Cámara: ${selected.name}`);
        await bot.editMessageText(`📷 ${selected.name}\n\nElegí una opción:`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: cameraOptionsKeyboard(entityId),
          },
        });
        return;
      } else if (action === "camera_list") {
        const cameras = getAllCameras(states);

        await answer("Lista de cámaras");

        if (!cameras.length) {
          await bot.editMessageText("📷 No hay cámaras disponibles.", {
            chat_id: chatId,
            message_id: query.message.message_id,
          });
          return;
        }

        await bot.editMessageText("📷 Seleccioná una cámara:", {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: buildCameraListKeyboard(cameras),
          },
        });
        return;
      } else if (action === "camera_img") {
        await answer("Enviando imagen...");

        const selected = gate.offered;
        const snapshot = await waitForSnapshot(ha, entityId);
        await sendPhotoWithFallback(
          bot,
          chatId,
          snapshot.buffer,
          `📷 ${selected?.name || entityId}`,
          `${entityId.replace(/\W+/g, "_")}.jpg`,
          snapshot.contentType
        );
        return;
      } else if (action === "camera_vid30") {
        await answer("Grabando video (30s)...");

        const selected = gate.offered;

        await bot.sendMessage(chatId, `🎥 Grabando 30 segundos de ${selected?.name || entityId}...`);

        try {
          const clip = await ha.recordCameraClip(entityId, 30);
          const video = await waitForMediaFile(ha, clip.publicPath, 90000, 3000);

          await sendVideoWithFallback(
            bot,
            chatId,
            video.buffer,
            `🎥 ${selected?.name || entityId} (30s)`,
            `${entityId.replace(/\W+/g, "_")}_30s.mp4`,
            video.contentType
          );
        } catch (recordError) {
          if (recordError.path === "/services/camera/record" && recordError.status >= 500) {
            await bot.sendMessage(
              chatId,
              "⚠️ Esta cámara no permite grabar video desde Home Assistant (camera.record). Te envío una imagen en su lugar."
            );

            const snapshot = await waitForSnapshot(ha, entityId);
            await sendPhotoWithFallback(
              bot,
              chatId,
              snapshot.buffer,
              `📷 ${selected?.name || entityId}`,
              `${entityId.replace(/\W+/g, "_")}.jpg`,
              snapshot.contentType
            );
            return;
          }

          throw recordError;
        }
        return;
      } else {
        console.log(`[Telegram] Acción desconocida: ${action}`);
        await answer("Acción desconocida");
        return;
      }

      // Refresh the inline keyboard after action (a fresh fetch is required
      // here: the action above just changed the entity's state).
      const refreshedStates = await ha.getStates();

      if (action.startsWith("light_")) {
        const keyboard = buildLightKeyboard(getAllLights(refreshedStates));
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id }
        );
      } else if (action.startsWith("cover_")) {
        const keyboard = buildCoverKeyboard(getAllCovers(refreshedStates));
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id }
        );
      }
    } catch (error) {
      console.error(`[Telegram] Error procesando callback ${action} → ${entityId}: ${error.message}`);
      try {
        await bot.sendMessage(chatId, `⚠️ Error en ${action}: ${error.message}`);
      } catch {
        // Si falla enviar mensaje, al menos intentamos responder el callback.
      }
      await answer(`Error: ${error.message}`);
    }
  });

  bot.on("polling_error", (error) => {
    console.error("[Telegram] Polling error:", error.message, error.code);
  });

  logger.log("Bot de Telegram iniciado.");
  return bot;
}