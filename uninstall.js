#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const SKILL_NAME = "unusual-whales";
const dest = path.join(os.homedir(), ".claude", "skills", SKILL_NAME);

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
  console.log(`✓ ${SKILL_NAME} skill removed from ${dest}`);
} else {
  console.log(`${SKILL_NAME} skill not found at ${dest} — nothing to remove`);
}
