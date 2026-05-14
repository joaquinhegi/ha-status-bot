function friendlyName(entity) {
  return entity.attributes?.friendly_name || entity.entity_id;
}

function isUnavailable(entity) {
  return entity.state === "unavailable" || entity.state === "unknown";
}

function byFriendlyName(a, b) {
  return friendlyName(a).localeCompare(friendlyName(b), "es");
}

function bulletList(items, emptyText = "Ninguno") {
  if (!items.length) {
    return `• ${emptyText}`;
  }

  return items.map((item) => `• ${item}`).join("\n");
}

export function getLightsOn(states) {
  return states
    .filter((e) => e.entity_id.startsWith("light."))
    .filter((e) => e.state === "on")
    .sort(byFriendlyName)
    .map(friendlyName);
}

export function getAllLights(states) {
  return states
    .filter((e) => e.entity_id.startsWith("light."))
    .filter((e) => !isUnavailable(e))
    .sort(byFriendlyName)
    .map((e) => ({
      entity_id: e.entity_id,
      name: friendlyName(e),
      state: e.state,
    }));
}

export function getAllCovers(states) {
  return states
    .filter((e) => e.entity_id.startsWith("cover."))
    .filter((e) => !isUnavailable(e))
    .sort(byFriendlyName)
    .map((e) => ({
      entity_id: e.entity_id,
      name: friendlyName(e),
      state: e.state,
    }));
}

export function getActiveBinarySensors(states) {
  return states
    .filter((e) => e.entity_id.startsWith("binary_sensor."))
    .filter((e) => e.state === "on")
    .sort(byFriendlyName)
    .map((e) => {
      const deviceClass = e.attributes?.device_class;

      if (deviceClass) {
        return `${friendlyName(e)} (${deviceClass})`;
      }

      return friendlyName(e);
    });
}

export function getOpenDoorsAndWindows(states) {
  const validClasses = new Set([
    "door",
    "garage_door",
    "window",
    "opening",
  ]);

  return states
    .filter((e) => e.entity_id.startsWith("binary_sensor."))
    .filter((e) => e.state === "on")
    .filter((e) => validClasses.has(e.attributes?.device_class))
    .sort(byFriendlyName)
    .map(friendlyName);
}

export function getLowBatteries(states, threshold = 20) {
  return states
    .filter((e) => e.entity_id.startsWith("sensor."))
    .filter((e) => e.attributes?.device_class === "battery")
    .filter((e) => !isUnavailable(e))
    .map((e) => ({
      name: friendlyName(e),
      value: Number(e.state),
      unit: e.attributes?.unit_of_measurement || "%",
    }))
    .filter((e) => Number.isFinite(e.value))
    .filter((e) => e.value <= threshold)
    .sort((a, b) => a.value - b.value)
    .map((e) => `${e.name}: ${e.value}${e.unit}`);
}

export function getTemperatures(states) {
  return states
    .filter((e) => e.entity_id.startsWith("sensor."))
    .filter((e) => e.attributes?.device_class === "temperature")
    .filter((e) => !isUnavailable(e))
    .map((e) => ({
      name: friendlyName(e),
      value: e.state,
      unit: e.attributes?.unit_of_measurement || "°C",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((e) => `${e.name}: ${e.value}${e.unit}`);
}

export function formatLights(states) {
  const lightsOn = getLightsOn(states);

  return [
    "💡 Luces encendidas",
    "",
    bulletList(lightsOn, "No hay luces encendidas"),
  ].join("\n");
}

export function formatSensors(states) {
  const sensors = getActiveBinarySensors(states);

  return [
    "📡 Sensores activos",
    "",
    bulletList(sensors, "No hay sensores activos"),
  ].join("\n");
}

export function formatDoors(states) {
  const doors = getOpenDoorsAndWindows(states);

  return [
    "🚪 Puertas / ventanas abiertas",
    "",
    bulletList(doors, "Todo cerrado"),
  ].join("\n");
}

export function formatBatteries(states, threshold) {
  const batteries = getLowBatteries(states, threshold);

  return [
    `🔋 Baterías bajas <= ${threshold}%`,
    "",
    bulletList(batteries, "No hay baterías bajas"),
  ].join("\n");
}

export function formatTemperatures(states) {
  const temps = getTemperatures(states);

  return [
    "🌡️ Temperaturas",
    "",
    bulletList(temps, "No hay sensores de temperatura"),
  ].join("\n");
}

export function formatFullStatus(states, lowBatteryThreshold) {
  const lightsOn = getLightsOn(states);
  const activeSensors = getActiveBinarySensors(states);
  const openDoors = getOpenDoorsAndWindows(states);
  const lowBatteries = getLowBatteries(states, lowBatteryThreshold);
  const temperatures = getTemperatures(states);

  return [
    "🏠 Estado de casa",
    "",
    "💡 Luces encendidas:",
    bulletList(lightsOn, "No hay luces encendidas"),
    "",
    "🚪 Puertas / ventanas abiertas:",
    bulletList(openDoors, "Todo cerrado"),
    "",
    "📡 Sensores activos:",
    bulletList(activeSensors, "No hay sensores activos"),
    "",
    `🔋 Baterías bajas <= ${lowBatteryThreshold}%:`,
    bulletList(lowBatteries, "No hay baterías bajas"),
    "",
    "🌡️ Temperaturas:",
    bulletList(temperatures, "No hay sensores de temperatura"),
  ].join("\n");
}