import TelegramBot from "node-telegram-bot-api";

import {
  formatBatteries,
  formatDoors,
  formatFullStatus,
  formatLights,
  formatSensors,
  formatTemperatures,
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

    if (!isAllowed(chatId, allowedChatIds)) {
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
    } catch (error) {
      console.error("Error procesando comando:", error);
      await bot.sendMessage(
        chatId,
        `Error consultando Home Assistant: ${error.message}`
      );
    }
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(
      chatId,
      [
        "Hola 👋",
        "",
        "Comandos disponibles:",
        "/estado - Resumen general",
        "/luces - Luces encendidas",
        "/sensores - Sensores activos",
        "/puertas - Puertas y ventanas abiertas",
        "/bateria - Baterías bajas",
        "/temp - Temperaturas",
        "/chatid - Ver tu chat_id",
      ].join("\n")
    );
  });

  bot.onText(/\/help/, async (msg) => {
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
    await bot.sendMessage(msg.chat.id, `Tu chat_id es: ${msg.chat.id}`);
  });

  bot.onText(/\/estado/, (msg) => {
    return handleCommand(msg, (states) =>
      formatFullStatus(states, lowBatteryThreshold)
    );
  });

  bot.onText(/\/luces/, (msg) => {
    return handleCommand(msg, formatLights);
  });

  bot.onText(/\/sensores/, (msg) => {
    return handleCommand(msg, formatSensors);
  });

  bot.onText(/\/puertas/, (msg) => {
    return handleCommand(msg, formatDoors);
  });

  bot.onText(/\/bateria/, (msg) => {
    return handleCommand(msg, (states) =>
      formatBatteries(states, lowBatteryThreshold)
    );
  });

  bot.onText(/\/temp/, (msg) => {
    return handleCommand(msg, formatTemperatures);
  });

  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error.message);
  });

  console.log("Bot de Telegram iniciado.");
  return bot;
}