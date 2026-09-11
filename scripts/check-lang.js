#!/usr/bin/env node
// Regression backstop for the English-only source policy: fails the build if
// any Spanish accented character or inverted punctuation mark is found under
// src/**. Character-class based, NOT "any non-ASCII" — emoji are intentional
// and must keep passing. This catches accented Spanish only; it will not
// catch unaccented Spanish words (e.g. "Luces"). See the code-quality-hygiene
// spec and the design's "Decision 3" honest-limit note.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = new URL("../src", import.meta.url).pathname;
const SPANISH_CHARS = /[áéíóúÁÉÍÓÚñÑüÜ¿¡]/;

function listFiles(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function findViolations(files) {
  const violations = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (SPANISH_CHARS.test(line)) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  return violations;
}

const violations = findViolations(listFiles(SRC_DIR));

if (violations.length > 0) {
  console.error("Found Spanish characters under src/**:\n");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log("check:lang passed — no Spanish characters found under src/**.");
