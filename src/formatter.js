function friendlyName(entity) {
  return entity.attributes?.friendly_name || entity.entity_id;
}

function isUnavailable(entity) {
  return entity.state === "unavailable" || entity.state === "unknown";
}

// Collation is matched to the Spanish-language entity data this bot reads
// from a Spanish-speaking Home Assistant instance (accented friendly names
// are common there), not to the interface language. Keep "es" even after the
// English-copy normalization below — switching to a locale-neutral compare
// would silently change sort order for those names.
function byFriendlyName(a, b) {
  return friendlyName(a).localeCompare(friendlyName(b), "es");
}

function bulletList(items, emptyText = "None") {
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

export function getAllCameras(states) {
  return states
    .filter((e) => e.entity_id.startsWith("camera."))
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
    .sort((a, b) => a.name.localeCompare(b.name, "es")) // See byFriendlyName above: "es" collation is intentional.
    .map((e) => `${e.name}: ${e.value}${e.unit}`);
}

export function formatLights(states) {
  const lightsOn = getLightsOn(states);

  return [
    "💡 Lights on",
    "",
    bulletList(lightsOn, "No lights on"),
  ].join("\n");
}

export function formatSensors(states) {
  const sensors = getActiveBinarySensors(states);

  return [
    "📡 Active sensors",
    "",
    bulletList(sensors, "No active sensors"),
  ].join("\n");
}

export function formatDoors(states) {
  const doors = getOpenDoorsAndWindows(states);

  return [
    "🚪 Open doors / windows",
    "",
    bulletList(doors, "Everything closed"),
  ].join("\n");
}

export function formatBatteries(states, threshold) {
  const batteries = getLowBatteries(states, threshold);

  return [
    `🔋 Low batteries <= ${threshold}%`,
    "",
    bulletList(batteries, "No low batteries"),
  ].join("\n");
}

export function formatTemperatures(states) {
  const temps = getTemperatures(states);

  return [
    "🌡️ Temperatures",
    "",
    bulletList(temps, "No temperature sensors"),
  ].join("\n");
}

export function formatFullStatus(states, lowBatteryThreshold) {
  const lightsOn = getLightsOn(states);
  const activeSensors = getActiveBinarySensors(states);
  const openDoors = getOpenDoorsAndWindows(states);
  const lowBatteries = getLowBatteries(states, lowBatteryThreshold);
  const temperatures = getTemperatures(states);

  return [
    "🏠 Home status",
    "",
    "💡 Lights on:",
    bulletList(lightsOn, "No lights on"),
    "",
    "🚪 Open doors / windows:",
    bulletList(openDoors, "Everything closed"),
    "",
    "📡 Active sensors:",
    bulletList(activeSensors, "No active sensors"),
    "",
    `🔋 Low batteries <= ${lowBatteryThreshold}%:`,
    bulletList(lowBatteries, "No low batteries"),
    "",
    "🌡️ Temperatures:",
    bulletList(temperatures, "No temperature sensors"),
  ].join("\n");
}