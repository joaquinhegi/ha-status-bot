import fs from "fs";
import { createHomeAssistantClient } from "./haClient.js";
import { createTelegramBot } from "./telegram.js";

function loadOptions() {
  const raw = fs.readFileSync("/data/options.json", "utf8");
  return JSON.parse(raw);
}

function parseAllowedChatIds(value) {
  if (!value || !value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function main() {
  const options = loadOptions();

  const telegramToken = options.telegram_token;
  const allowedChatIds = parseAllowedChatIds(options.allowed_chat_ids);
  const lowBatteryThreshold = Number(options.low_battery_threshold ?? 20);

  if (!telegramToken) {
    throw new Error("Falta configurar telegram_token en el add-on.");
  }

  const supervisorToken = process.env.SUPERVISOR_TOKEN;

  if (!supervisorToken) {
    throw new Error("No existe SUPERVISOR_TOKEN. Revisa homeassistant_api: true en config.yaml.");
  }

  const ha = createHomeAssistantClient({
    baseUrl: "http://supervisor/core/api",
    token: supervisorToken,
  });

  createTelegramBot({
    token: telegramToken,
    allowedChatIds,
    lowBatteryThreshold,
    ha,
  });

  console.log("HA Status Bot iniciado correctamente.");
}

main().catch((error) => {
  console.error("Error arrancando HA Status Bot:", error);
  process.exit(1);
});