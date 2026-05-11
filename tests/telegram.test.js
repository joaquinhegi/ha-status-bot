import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We test the helper functions by re-implementing the logic inline,
// since they're not exported. The actual bot creation requires
// node-telegram-bot-api which starts polling – we test the pure logic instead.

// ─── isAllowed (replicated from telegram.js) ───────────────

function isAllowed(chatId, allowedChatIds) {
  if (!allowedChatIds.length) {
    return true;
  }
  return allowedChatIds.includes(String(chatId));
}

describe("isAllowed", () => {
  it("permite todo si allowedChatIds está vacío", () => {
    assert.strictEqual(isAllowed(123, []), true);
    assert.strictEqual(isAllowed(999, []), true);
  });

  it("permite chat IDs en la lista", () => {
    assert.strictEqual(isAllowed(123, ["123", "456"]), true);
    assert.strictEqual(isAllowed(456, ["123", "456"]), true);
  });

  it("rechaza chat IDs que no están en la lista", () => {
    assert.strictEqual(isAllowed(789, ["123", "456"]), false);
  });

  it("convierte chatId a string para comparar", () => {
    assert.strictEqual(isAllowed(123, ["123"]), true);
  });
});

// ─── safeReply logic (replicated from telegram.js) ─────────

function splitText(text, maxLength = 3900) {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}

describe("splitText (safeReply logic)", () => {
  it("no divide texto corto", () => {
    const chunks = splitText("Hola mundo");
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], "Hola mundo");
  });

  it("divide texto largo en múltiples trozos", () => {
    const longText = "A".repeat(8000);
    const chunks = splitText(longText, 3900);
    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].length, 3900);
    assert.strictEqual(chunks[1].length, 3900);
    assert.strictEqual(chunks[2].length, 200);
  });

  it("mantiene intacto texto exacto al límite", () => {
    const text = "B".repeat(3900);
    const chunks = splitText(text, 3900);
    assert.strictEqual(chunks.length, 1);
  });

  it("divide texto 1 char más largo que el límite", () => {
    const text = "C".repeat(3901);
    const chunks = splitText(text, 3900);
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].length, 3900);
    assert.strictEqual(chunks[1].length, 1);
  });
});
