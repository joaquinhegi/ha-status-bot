import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── parseAllowedChatIds (replicated from index.js) ────────

function parseAllowedChatIds(value) {
  if (!value || !value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

describe("parseAllowedChatIds", () => {
  it("parsea IDs separados por comas", () => {
    assert.deepStrictEqual(parseAllowedChatIds("123,456,789"), [
      "123",
      "456",
      "789",
    ]);
  });

  it("elimina espacios extra", () => {
    assert.deepStrictEqual(parseAllowedChatIds(" 123 , 456 , 789 "), [
      "123",
      "456",
      "789",
    ]);
  });

  it("devuelve array vacío para cadena vacía", () => {
    assert.deepStrictEqual(parseAllowedChatIds(""), []);
  });

  it("devuelve array vacío para solo espacios", () => {
    assert.deepStrictEqual(parseAllowedChatIds("   "), []);
  });

  it("devuelve array vacío para null", () => {
    assert.deepStrictEqual(parseAllowedChatIds(null), []);
  });

  it("devuelve array vacío para undefined", () => {
    assert.deepStrictEqual(parseAllowedChatIds(undefined), []);
  });

  it("ignora comas extra", () => {
    assert.deepStrictEqual(parseAllowedChatIds("123,,456,"), [
      "123",
      "456",
    ]);
  });

  it("funciona con un solo ID", () => {
    assert.deepStrictEqual(parseAllowedChatIds("12345"), ["12345"]);
  });
});
