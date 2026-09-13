#!/usr/bin/env node

// Validates config.yaml against the Home Assistant add-on schema rules, and
// keeps options, schema and translations in agreement.
//
// This exists because `allowed_chat_ids: list(str)` shipped in 2.0.0 and broke
// every installation for four releases. It reads as "a list of strings"; in the
// add-on schema `list(...)` is an ENUMERATION, so it actually meant "the value
// must be the literal text str". Home Assistant rendered a dropdown whose only
// choice was `str`, users picked it, and the add-on refused to start. Nothing in
// the test suite could see it: the defect lived entirely in the manifest.
//
// Reference: https://developers.home-assistant.io/docs/add-ons/configuration

import { readFileSync } from "node:fs";
import { parse } from "yaml";

const SCALAR_TYPES = new Set(["str", "bool", "int", "float", "email", "url", "password", "port"]);
const PARAMETERIZED = /^(str|int|float)\(-?\d*,-?\d*\)$/;
const MATCH_TYPE = /^match\(.+\)$/;
const DEVICE_TYPE = /^device(\(.+\))?$/;
const ENUM_TYPE = /^list\((.+)\)$/;

const problems = [];

function checkScalarType(path, type) {
  const bare = type.endsWith("?") ? type.slice(0, -1) : type;

  const enumMatch = bare.match(ENUM_TYPE);
  if (enumMatch) {
    // The trap this script exists for. A single member that names a type is
    // almost certainly an attempt to declare an array.
    if (!enumMatch[1].includes("|") && SCALAR_TYPES.has(enumMatch[1])) {
      problems.push(
        `${path}: \`${type}\` declares an enumeration whose only allowed value is the literal ` +
          `text "${enumMatch[1]}". For a list of ${enumMatch[1]} values write a YAML sequence:\n` +
          `      ${path.split(".").pop()}:\n        - ${enumMatch[1]}`,
      );
    }
    return;
  }

  if (SCALAR_TYPES.has(bare) || PARAMETERIZED.test(bare) || MATCH_TYPE.test(bare)) {
    return;
  }

  if (DEVICE_TYPE.test(bare)) {
    return;
  }

  problems.push(`${path}: \`${type}\` is not a documented add-on schema type`);
}

function checkSchemaEntry(path, entry) {
  if (typeof entry === "string") {
    checkScalarType(path, entry);
    return;
  }

  if (Array.isArray(entry)) {
    if (entry.length !== 1) {
      problems.push(`${path}: a sequence schema must hold exactly one element schema`);
      return;
    }
    checkSchemaEntry(`${path}[]`, entry[0]);
    return;
  }

  if (entry && typeof entry === "object") {
    for (const [key, value] of Object.entries(entry)) {
      checkSchemaEntry(`${path}.${key}`, value);
    }
    return;
  }

  problems.push(`${path}: unsupported schema entry`);
}

const config = parse(readFileSync("config.yaml", "utf8"));
const schema = config.schema ?? {};
const options = config.options ?? {};

for (const [name, entry] of Object.entries(schema)) {
  checkSchemaEntry(`schema.${name}`, entry);
}

// An option without a default is only valid when its schema marks it optional
// with a trailing `?`, so a mismatch here is a real manifest defect.
for (const [name, entry] of Object.entries(schema)) {
  const optional = typeof entry === "string" && entry.endsWith("?");
  if (!optional && !(name in options)) {
    problems.push(`options.${name}: missing a default, and schema.${name} is not optional`);
  }
}

for (const name of Object.keys(options)) {
  if (!(name in schema)) {
    problems.push(`schema.${name}: missing, but options.${name} defines a default`);
  }
}

// Every option the user can see should say what it is. This is what was missing
// when a Home Assistant token ended up in the Telegram token field.
const translations = parse(readFileSync("translations/en.yaml", "utf8"))?.configuration ?? {};

for (const name of Object.keys(schema)) {
  const entry = translations[name];
  if (!entry?.name || !entry?.description) {
    problems.push(`translations/en.yaml: ${name} needs both a name and a description`);
  }
}

for (const name of Object.keys(translations)) {
  if (!(name in schema)) {
    problems.push(`translations/en.yaml: ${name} is documented but absent from the schema`);
  }
}

if (problems.length > 0) {
  console.error("check:addon found problems in the add-on manifest:\n");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log("check:addon passed — config.yaml, its defaults and translations agree.");
