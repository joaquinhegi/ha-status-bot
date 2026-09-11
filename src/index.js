import fs from "fs";
import { createHomeAssistantClient } from "./haClient.js";
import { createTelegramBot } from "./telegram.js";

function loadOptions() {
  const optionsPath = process.env.OPTIONS_PATH || "/data/options.json";
  console.log(`Cargando opciones desde ${optionsPath}...`);
  const raw = fs.readFileSync(optionsPath, "utf8");
  const options = JSON.parse(raw);
  console.log("Opciones cargadas correctamente.");
  return options;
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

  console.log(`Chat IDs permitidos: ${allowedChatIds.length ? allowedChatIds.join(", ") : "(todos)"}`);
  console.log(`Umbral batería baja: ${lowBatteryThreshold}%`);

  if (!telegramToken) {
    throw new Error("Falta configurar telegram_token en el add-on.");
  }

  const supervisorToken = process.env.SUPERVISOR_TOKEN;

  if (!supervisorToken) {
    throw new Error("No existe SUPERVISOR_TOKEN. Revisa homeassistant_api: true en config.yaml.");
  }

  console.log("Conectando con Home Assistant API...");
  const ha = createHomeAssistantClient({
    baseUrl: process.env.HA_BASE_URL || "http://supervisor/core/api",
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