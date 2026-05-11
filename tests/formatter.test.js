import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getLightsOn,
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
];

// ─── getLightsOn ────────────────────────────────────────────

describe("getLightsOn", () => {
  it("devuelve solo las luces encendidas", () => {
    const result = getLightsOn(STATES);
    assert.deepStrictEqual(result, ["Dormitorio", "Salón"]);
  });

  it("devuelve array vacío si no hay luces encendidas", () => {
    const states = [makeEntity("light.a", "off")];
    assert.deepStrictEqual(getLightsOn(states), []);
  });

  it("devuelve array vacío si no hay entidades light", () => {
    assert.deepStrictEqual(getLightsOn([]), []);
  });
});

// ─── getActiveBinarySensors ────────────────────────────────

describe("getActiveBinarySensors", () => {
  it("devuelve sensores binarios activos con device_class", () => {
    const result = getActiveBinarySensors(STATES);
    assert.ok(result.includes("Movimiento cocina (motion)"));
    assert.ok(result.includes("Puerta principal (door)"));
    assert.ok(result.includes("Garaje (garage_door)"));
    assert.ok(result.includes("Vibración (vibration)"));
  });

  it("no incluye sensores en off", () => {
    const result = getActiveBinarySensors(STATES);
    const names = result.map((r) => r.split(" (")[0]);
    assert.ok(!names.includes("Ventana salón"));
  });

  it("muestra solo el nombre si no tiene device_class", () => {
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
  it("devuelve puertas y ventanas abiertas", () => {
    const result = getOpenDoorsAndWindows(STATES);
    assert.ok(result.includes("Puerta principal"));
    assert.ok(result.includes("Garaje"));
  });

  it("no incluye device_class que no sea door/window/garage_door/opening", () => {
    const result = getOpenDoorsAndWindows(STATES);
    assert.ok(!result.includes("Movimiento cocina"));
    assert.ok(!result.includes("Vibración"));
  });

  it("no incluye ventanas cerradas", () => {
    const result = getOpenDoorsAndWindows(STATES);
    assert.ok(!result.includes("Ventana salón"));
  });

  it("devuelve array vacío si todo está cerrado", () => {
    const states = [
      makeEntity("binary_sensor.puerta", "off", { device_class: "door" }),
    ];
    assert.deepStrictEqual(getOpenDoorsAndWindows(states), []);
  });
});

// ─── getLowBatteries ───────────────────────────────────────

describe("getLowBatteries", () => {
  it("devuelve baterías bajo el umbral, ordenadas de menor a mayor", () => {
    const result = getLowBatteries(STATES, 20);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], "Batería ventana: 5%");
    assert.strictEqual(result[1], "Batería puerta: 15%");
  });

  it("no incluye baterías por encima del umbral", () => {
    const result = getLowBatteries(STATES, 20);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Batería movimiento"));
  });

  it("excluye entidades unavailable", () => {
    const result = getLowBatteries(STATES, 100);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Batería rota"));
  });

  it("usa umbral personalizado", () => {
    const result = getLowBatteries(STATES, 10);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], "Batería ventana: 5%");
  });

  it("devuelve vacío si no hay baterías bajas", () => {
    const result = getLowBatteries(STATES, 0);
    assert.strictEqual(result.length, 0);
  });
});

// ─── getTemperatures ──────────────────────────────────────

describe("getTemperatures", () => {
  it("devuelve sensores de temperatura disponibles", () => {
    const result = getTemperatures(STATES);
    assert.strictEqual(result.length, 2);
    assert.ok(result.includes("Temp exterior: 8.2°C"));
    assert.ok(result.includes("Temp salón: 22.5°C"));
  });

  it("excluye sensores unavailable", () => {
    const result = getTemperatures(STATES);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Temp unavailable"));
  });

  it("no incluye sensores con otro device_class", () => {
    const result = getTemperatures(STATES);
    const joined = result.join(" ");
    assert.ok(!joined.includes("Energía"));
  });
});

// ─── formatLights ─────────────────────────────────────────

describe("formatLights", () => {
  it("contiene el título y las luces", () => {
    const text = formatLights(STATES);
    assert.ok(text.includes("💡 Luces encendidas"));
    assert.ok(text.includes("• Salón"));
    assert.ok(text.includes("• Dormitorio"));
  });

  it("muestra mensaje vacío si no hay luces", () => {
    const text = formatLights([]);
    assert.ok(text.includes("No hay luces encendidas"));
  });
});

// ─── formatSensors ────────────────────────────────────────

describe("formatSensors", () => {
  it("contiene el título y sensores activos", () => {
    const text = formatSensors(STATES);
    assert.ok(text.includes("📡 Sensores activos"));
    assert.ok(text.includes("Movimiento cocina (motion)"));
  });

  it("muestra mensaje vacío sin sensores activos", () => {
    const text = formatSensors([]);
    assert.ok(text.includes("No hay sensores activos"));
  });
});

// ─── formatDoors ──────────────────────────────────────────

describe("formatDoors", () => {
  it("contiene el título y puertas abiertas", () => {
    const text = formatDoors(STATES);
    assert.ok(text.includes("🚪 Puertas / ventanas abiertas"));
    assert.ok(text.includes("• Puerta principal"));
  });

  it("muestra 'Todo cerrado' si no hay puertas abiertas", () => {
    const text = formatDoors([]);
    assert.ok(text.includes("Todo cerrado"));
  });
});

// ─── formatBatteries ──────────────────────────────────────

describe("formatBatteries", () => {
  it("contiene el título con el umbral", () => {
    const text = formatBatteries(STATES, 20);
    assert.ok(text.includes("🔋 Baterías bajas <= 20%"));
  });

  it("lista las baterías bajas", () => {
    const text = formatBatteries(STATES, 20);
    assert.ok(text.includes("Batería ventana: 5%"));
    assert.ok(text.includes("Batería puerta: 15%"));
  });

  it("muestra mensaje vacío sin baterías bajas", () => {
    const text = formatBatteries([], 20);
    assert.ok(text.includes("No hay baterías bajas"));
  });
});

// ─── formatTemperatures ───────────────────────────────────

describe("formatTemperatures", () => {
  it("contiene el título y las temperaturas", () => {
    const text = formatTemperatures(STATES);
    assert.ok(text.includes("🌡️ Temperaturas"));
    assert.ok(text.includes("Temp salón: 22.5°C"));
  });

  it("muestra mensaje vacío sin sensores de temperatura", () => {
    const text = formatTemperatures([]);
    assert.ok(text.includes("No hay sensores de temperatura"));
  });
});

// ─── formatFullStatus ─────────────────────────────────────

describe("formatFullStatus", () => {
  it("contiene todas las secciones", () => {
    const text = formatFullStatus(STATES, 20);
    assert.ok(text.includes("🏠 Estado de casa"));
    assert.ok(text.includes("💡 Luces encendidas:"));
    assert.ok(text.includes("🚪 Puertas / ventanas abiertas:"));
    assert.ok(text.includes("📡 Sensores activos:"));
    assert.ok(text.includes("🔋 Baterías bajas <= 20%:"));
    assert.ok(text.includes("🌡️ Temperaturas:"));
  });

  it("incluye datos de cada sección", () => {
    const text = formatFullStatus(STATES, 20);
    assert.ok(text.includes("• Salón"));
    assert.ok(text.includes("• Puerta principal"));
    assert.ok(text.includes("• Batería ventana: 5%"));
    assert.ok(text.includes("Temp salón: 22.5°C"));
  });

  it("funciona con estados vacíos", () => {
    const text = formatFullStatus([], 20);
    assert.ok(text.includes("No hay luces encendidas"));
    assert.ok(text.includes("Todo cerrado"));
    assert.ok(text.includes("No hay sensores activos"));
    assert.ok(text.includes("No hay baterías bajas"));
    assert.ok(text.includes("No hay sensores de temperatura"));
  });
});
