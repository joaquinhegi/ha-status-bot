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

export function createTelegramBot({
  token,
  allowedChatIds,
  lowBatteryThreshold,
  ha,
}) {
  const bot = new TelegramBot(token, {
    polling: true,
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

    await bot.sendMessage(
      chatId,
      [
        "Hola 👋",
        "",
        "Comandos disponibles:",
        "/estado - Resumen general",
        "/luces - Luces (encender/apagar)",
        "/persianas - Persianas (abrir/cerrar)",
        "/sensores - Sensores activos",
        "/puertas - Puertas y ventanas abiertas",
        "/bateria - Baterías bajas",
        "/temp - Temperaturas",
        "/chatid - Ver tu chat_id",
      ].join("\n")
    );
  });

  bot.onText(/\/help/, async (msg) => {
    console.log(`[Telegram] /help de chat_id=${msg.chat.id}`);
    await bot.sendMessage(
      msg.chat.id,
      [
        "Comandos:",
        "/estado",
        "/luces",
        "/sensores",
        "/puertas",
        "/bateria",
        "/temp",
        "/chatid",
      ].join("\n")
    );
  });

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

      const keyboard = lights.map((light) => {
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

      const keyboard = covers.map((cover) => {
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

      await bot.sendMessage(chatId, "🪟 Persianas:", {
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      console.error("[Telegram] Error procesando /persianas:", error);
      await bot.sendMessage(chatId, `Error consultando Home Assistant: ${error.message}`);
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const [action, entityId] = query.data.split(":");
    console.log(`[Telegram] Callback: ${action} → ${entityId} de chat_id=${chatId}`);

    if (!isAllowed(chatId, allowedChatIds)) {
      console.log(`[Telegram] Callback no autorizado: chat_id=${chatId}`);
      await bot.answerCallbackQuery(query.id, { text: "No autorizado." });
      return;
    }

    try {
      if (action === "light_on") {
        await ha.callService("light", "turn_on", { entity_id: entityId });
        console.log(`[Telegram] Luz encendida: ${entityId}`);
        await bot.answerCallbackQuery(query.id, { text: "💡 Luz encendida" });
      } else if (action === "light_off") {
        await ha.callService("light", "turn_off", { entity_id: entityId });
        console.log(`[Telegram] Luz apagada: ${entityId}`);
        await bot.answerCallbackQuery(query.id, { text: "💡 Luz apagada" });
      } else if (action === "cover_open") {
        await ha.callService("cover", "open_cover", { entity_id: entityId });
        console.log(`[Telegram] Persiana abierta: ${entityId}`);
        await bot.answerCallbackQuery(query.id, { text: "🪟 Persiana abierta" });
      } else if (action === "cover_close") {
        await ha.callService("cover", "close_cover", { entity_id: entityId });
        console.log(`[Telegram] Persiana cerrada: ${entityId}`);
        await bot.answerCallbackQuery(query.id, { text: "🪟 Persiana cerrada" });
      } else {
        console.log(`[Telegram] Acción desconocida: ${action}`);
        await bot.answerCallbackQuery(query.id, { text: "Acción desconocida" });
        return;
      }

      // Refresh the inline keyboard after action
      const states = await ha.getStates();

      if (action.startsWith("light_")) {
        const lights = getAllLights(states);
        const keyboard = lights.map((light) => {
          const icon = light.state === "on" ? "🟡" : "⚫";
          const actionLabel = light.state === "on" ? "Apagar" : "Encender";
          const cbAction = light.state === "on" ? "light_off" : "light_on";
          return [
            {
              text: `${icon} ${light.name} → ${actionLabel}`,
              callback_data: `${cbAction}:${light.entity_id}`,
            },
          ];
        });
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id }
        );
      } else if (action.startsWith("cover_")) {
        const covers = getAllCovers(states);
        const keyboard = covers.map((cover) => {
          const isOpen = cover.state === "open";
          const icon = isOpen ? "🟢" : "🔴";
          const actionLabel = isOpen ? "Cerrar" : "Abrir";
          const cbAction = isOpen ? "cover_close" : "cover_open";
          return [
            {
              text: `${icon} ${cover.name} (${cover.state}) → ${actionLabel}`,
              callback_data: `${cbAction}:${cover.entity_id}`,
            },
          ];
        });
        await bot.editMessageReplyMarkup(
          { inline_keyboard: keyboard },
          { chat_id: chatId, message_id: query.message.message_id }
        );
      }
    } catch (error) {
      console.error(`[Telegram] Error procesando callback ${action} → ${entityId}:`, error);
      await bot.answerCallbackQuery(query.id, {
        text: `Error: ${error.message}`,
      });
    }
  });

  bot.on("polling_error", (error) => {
    console.error("[Telegram] Polling error:", error.message);
  });

  console.log("Bot de Telegram iniciado.");
  return bot;
}