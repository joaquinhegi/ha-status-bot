import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getLightsOn,
  getAllCameras,
  getActiveBinarySensors,
  getOpenDoorsAndWindows,
  getLowBatteries,
  getTemperatures,
  formatLights,
  formatSensors,
  formatDoors,
  formatBatteries,
  formatTemperatures,
  formatFullStatus,
} from "../src/formatter.js";

// ─── Fixtures ───────────────────────────────────────────────
// friendly_name values stay in Spanish: they simulate real Home Assistant
// entity data from a Spanish-speaking home, and the accented names are the
// regression evidence for the "es" collation kept in src/formatter.js.

function makeEntity(id, state, attrs = {}) {
  return {
    entity_id: id,
    state,
    attributes: { friendly_name: id.split(".")[1], ...attrs },
  };
}

const STATES = [
  // Lights
  makeEntity("light.salon", "on", { friendly_name: "Salón" }),
  makeEntity("light.cocina", "off", { friendly_name: "Cocina" }),
  makeEntity("light.dormitorio", "on", { friendly_name: "Dormitorio" }),

  // Binary sensors
  makeEntity("binary_sensor.movimiento_cocina", "on", {
    friendly_name: "Movimiento cocina",
    device_class: "motion",
  }),
  makeEntity("binary_sensor.puerta_principal", "on", {
    friendly_name: "Puerta principal",
    device_class: "door",
  }),
  makeEntity("binary_sensor.ventana_salon", "off", {
    friendly_name: "Ventana salón",
    device_class: "window",
  }),
  makeEntity("binary_sensor.garaje", "on", {
    friendly_name: "Garaje",
    device_class: "garage_door",
  }),
  makeEntity("binary_sensor.vibracion", "on", {
    friendly_name: "Vibración",
    device_class: "vibration",
  }),

  // Battery sensors
  makeEntity("sensor.bateria_puerta", "15", {
    friendly_name: "Batería puerta",
    device_class: "battery",
    unit_of_measurement: "%",
  }),
  makeEntity("sensor.bateria_movimiento", "80", {
    friendly_name: "Batería movimiento",
    device_class: "battery",
    unit_of_measurement: "%",
  }),
  makeEntity("sensor.bateria_ventana", "5", {
    friendly_name: "Batería ventana",
    device_class: "battery",
    unit_of_measurement: "%",
  }),
  makeEntity("sensor.bateria_rota", "unavailable", {
    friendly_name: "Batería rota",
    device_class: "battery",
  }),

  // Temperature sensors
  makeEntity("sensor.temp_salon", "22.5", {
    friendly_name: "Temp salón",
    device_class: "temperature",
    unit_of_measurement: "°C",
  }),
  makeEntity("sensor.temp_exterior", "8.2", {
    friendly_name: "Temp exterior",
    device_class: "temperature",
    unit_of_measurement: "°C",
  }),
  makeEntity("sensor.temp_unavailable", "unavailable", {
    friendly_name: "Temp unavailable",
    device_class: "temperature",
  }),

  // Unrelated sensor
  makeEntity("sensor.energia", "340", {
    friendly_name: "Energía",
    device_class: "energy",
    unit_of_measurement: "kWh",
  }),

  // Cameras
  makeEntity("camera.patio", "idle", { friendly_name: "Patio" }),
  makeEntity("camera.entrada", "streaming", { friendly_name: "Entrada" }),
  makeEntity("camera.garage", "unavailable", { friendly_name: "Garage" }),
];

// ─── getLightsOn ────────────────────────────────────────────

describe("getLightsOn", () => {
  it("returns only the lights that are on", () => {
    const result = getLightsOn(STATES);
    assert.deepStrictEqual(result, ["Dormitorio", "Salón"]);
  });

  it("returns an empty array when no lights are on", () => {
    const states = [makeEntity("light.a", "off")];
    assert.deepStrictEqual(getLightsOn(states), []);
  });

  it("returns an empty array when there are no light entities", () => {
    assert.deepStrictEqual(getLightsOn([]), []);
  });
});

// ─── getAllCameras ───────────────────────────────────────

describe("getAllCameras", () => {
  it("returns only available cameras, sorted", () => {
    const result = getAllCameras(STATES);
    assert.deepStrictEqual(result, [
      {
        entity_id: "camera.entrada",
        name: "Entrada",
        state: "streaming",
      },
      {
        entity_id: "camera.patio",
        name: "Patio",
        state: "idle",
      },
    ]);
  });

  it("returns an empty array when no cameras are available", () => {
    const states = [makeEntity("camera.test", "unavailable")];
    assert.deepStrictEqual(getAllCameras(states), []);
  });
});

// ─── getActiveBinarySensors ────────────────────────────────

describe("getActiveBinarySensors", () => {
  it("returns active binary sensors with their device_class", () => {
    const result = getActiveBinarySensors(STATES);
    assert.ok(result.includes("Movimiento cocina (motion)"));
    assert.ok(result.includes("Puerta principal (door)"));
    assert.ok(result.includes("Garaje (garage_door)"));
    assert.ok(result.includes("Vibración (vibration)"));
  });

  it("does not include sensors that are off", () => {
    const result = getActiveBinarySensors(STATES);
    const names = result.map((r) => r.split(" (")[0]);
    assert.ok(!names.includes("Ventana salón"));
  });

  it("shows only the name when there is no device_class", () => {
    const states = [
      makeEntity("binary_sensor.generico", "on", {
        friendly_name: "Genérico",
      }),
    ];
    const result = getActiveBinarySensors(states);
    assert.deepStrictEqual(result, ["Genérico"]);
  });
});

// ─── getOpenDoorsAndWindows ────────────────────────────────

describe("getOpenDoorsAndWindows", () => {
  it("returns open doors and windows", () => {
    const result = getOpenDoorsAndWindows(STATES);
    assert.ok(result.includes("Puerta principal"));
    assert.ok(result.includes("Garaje"));
  });

  it("excludes device_class values other than door/window/garage_door/opening", () => {
    const result = getOpenDoorsAndWindows(STATES);
    assert.ok(!result.includes("Movimiento cocina"));
    assert.ok(!result.includes("Vibración"));
  });

  it("does not include closed windows", () => {
    const result = getOpenDoorsAndWindows(STATES);
    assert.ok(!result.includes("Ventana salón"));
  });

  it("returns an empty array when everything is closed", () => {
    const states = [
      makeEntity("binary_sensor.puerta", "off", { device_class: "door" }),
    ];
    assert.deepStrictEqual(getOpenDoorsAndWindows(states), []);
  });
});

// ─── getLowBatteries ───────────────────────────────────────

describe("getLowBatteries", () => {
  it("returns batteries below the threshold, sorted ascending", () => {
    const result = getLowBatteries(STATES, 20);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], "Batería ventana: 5%");
    assert.strictEqual(result[1], "Batería puerta: 15%");
  });

  it("does not include batteries above the threshold", () => {
    const result = getLowBatteries(STATES, 20);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Batería movimiento"));
  });

  it("excludes unavailable entities", () => {
    const result = getLowBatteries(STATES, 100);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Batería rota"));
  });

  it("uses a custom threshold", () => {
    const result = getLowBatteries(STATES, 10);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], "Batería ventana: 5%");
  });

  it("returns an empty array when there are no low batteries", () => {
    const result = getLowBatteries(STATES, 0);
    assert.strictEqual(result.length, 0);
  });
});

// ─── getTemperatures ──────────────────────────────────────

describe("getTemperatures", () => {
  it("returns available temperature sensors", () => {
    const result = getTemperatures(STATES);
    assert.strictEqual(result.length, 2);
    assert.ok(result.includes("Temp exterior: 8.2°C"));
    assert.ok(result.includes("Temp salón: 22.5°C"));
  });

  it("excludes unavailable sensors", () => {
    const result = getTemperatures(STATES);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Temp unavailable"));
  });

  it("does not include sensors with a different device_class", () => {
    const result = getTemperatures(STATES);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Energía"));
  });

  it("sorts accented names using Spanish collation (regression for the kept 'es' locale)", () => {
    const states = [
      makeEntity("sensor.temp_a", "10", {
        friendly_name: "Ábaco",
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
      makeEntity("sensor.temp_b", "11", {
        friendly_name: "Azul",
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
    ];
    const result = getTemperatures(states);
    assert.deepStrictEqual(result, ["Ábaco: 10°C", "Azul: 11°C"]);
  });
});

// ─── formatLights ─────────────────────────────────────────

describe("formatLights", () => {
  it("contains the heading and the lights", () => {
    const text = formatLights(STATES);
    assert.ok(text.includes("• Salón"));
    assert.ok(text.includes("• Dormitorio"));
  });

  it("shows the empty-state message when there are no lights on", () => {
    const text = formatLights([]);
    assert.ok(text.length > 0);
  });
});

// ─── formatSensors ────────────────────────────────────────

describe("formatSensors", () => {
  it("contains the heading and active sensors", () => {
    const text = formatSensors(STATES);
    assert.ok(text.includes("Movimiento cocina (motion)"));
  });

  it("shows the empty-state message when there are no active sensors", () => {
    const text = formatSensors([]);
    assert.ok(text.length > 0);
  });
});

// ─── formatDoors ──────────────────────────────────────────

describe("formatDoors", () => {
  it("contains the heading and open doors", () => {
    const text = formatDoors(STATES);
    assert.ok(text.includes("• Puerta principal"));
  });

  it("shows the empty-state message when nothing is open", () => {
    const text = formatDoors([]);
    assert.ok(text.length > 0);
  });
});

// ─── formatBatteries ──────────────────────────────────────

describe("formatBatteries", () => {
  it("contains the heading with the threshold", () => {
    const text = formatBatteries(STATES, 20);
    assert.ok(text.includes("20%"));
  });

  it("lists the low batteries", () => {
    const text = formatBatteries(STATES, 20);
    assert.ok(text.includes("Batería ventana: 5%"));
    assert.ok(text.includes("Batería puerta: 15%"));
  });

  it("shows the empty-state message when there are no low batteries", () => {
    const text = formatBatteries([], 20);
    assert.ok(text.length > 0);
  });
});

// ─── formatTemperatures ───────────────────────────────────

describe("formatTemperatures", () => {
  it("contains the heading and the temperatures", () => {
    const text = formatTemperatures(STATES);
    assert.ok(text.includes("Temp salón: 22.5°C"));
  });

  it("shows the empty-state message when there are no temperature sensors", () => {
    const text = formatTemperatures([]);
    assert.ok(text.length > 0);
  });
});

// ─── formatFullStatus ─────────────────────────────────────

describe("formatFullStatus", () => {
  it("contains every section heading", () => {
    const text = formatFullStatus(STATES, 20);
    const sectionCount = text.split("\n\n").length;
    assert.strictEqual(sectionCount, 6);
  });

  it("includes data from each section", () => {
    const text = formatFullStatus(STATES, 20);
    assert.ok(text.includes("• Salón"));
    assert.ok(text.includes("• Puerta principal"));
    assert.ok(text.includes("• Batería ventana: 5%"));
    assert.ok(text.includes("Temp salón: 22.5°C"));
  });

  it("works with empty states", () => {
    const text = formatFullStatus([], 20);
    assert.ok(text.length > 0);
  });
});

// ─── user-facing copy ─────────────────────────────────────
// The only block in this file allowed to assert on exact bot-facing English
// copy. Every other describe block above asserts on structure or on
// Spanish fixture data, not on the module's own English output strings.

describe("user-facing copy", () => {
  it("formatLights uses the English heading and empty-state text", () => {
    assert.ok(formatLights(STATES).includes("💡 Lights on"));
    assert.ok(formatLights([]).includes("No lights on"));
  });

  it("formatSensors uses the English heading and empty-state text", () => {
    assert.ok(formatSensors(STATES).includes("📡 Active sensors"));
    assert.ok(formatSensors([]).includes("No active sensors"));
  });

  it("formatDoors uses the English heading and empty-state text", () => {
    assert.ok(formatDoors(STATES).includes("🚪 Open doors / windows"));
    assert.ok(formatDoors([]).includes("Everything closed"));
  });

  it("formatBatteries uses the English heading and empty-state text", () => {
    assert.ok(formatBatteries(STATES, 20).includes("🔋 Low batteries <= 20%"));
    assert.ok(formatBatteries([], 20).includes("No low batteries"));
  });

  it("formatTemperatures uses the English heading and empty-state text", () => {
    assert.ok(formatTemperatures(STATES).includes("🌡️ Temperatures"));
    assert.ok(formatTemperatures([]).includes("No temperature sensors"));
  });

  it("formatFullStatus uses the English section headings and empty-state text", () => {
    const text = formatFullStatus(STATES, 20);
    assert.ok(text.includes("🏠 Home status"));
    assert.ok(text.includes("💡 Lights on:"));
    assert.ok(text.includes("🚪 Open doors / windows:"));
    assert.ok(text.includes("📡 Active sensors:"));
    assert.ok(text.includes("🔋 Low batteries <= 20%:"));
    assert.ok(text.includes("🌡️ Temperatures:"));

    const empty = formatFullStatus([], 20);
    assert.ok(empty.includes("No lights on"));
    assert.ok(empty.includes("Everything closed"));
    assert.ok(empty.includes("No active sensors"));
    assert.ok(empty.includes("No low batteries"));
    assert.ok(empty.includes("No temperature sensors"));
  });
});
