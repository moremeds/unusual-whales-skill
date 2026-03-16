#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const SKILL_NAME = "unusual-whales";
const dest = path.join(os.homedir(), ".claude", "skills", SKILL_NAME);
const srcSkill = path.join(__dirname, "skill");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Copy skill files
copyDir(srcSkill, dest);

console.log(`\n✓ ${SKILL_NAME} skill installed to ${dest}`);
console.log(`\nUsage in Claude Code:`);
console.log(`  /unusual-whales TSLA          # Single-ticker analysis`);
console.log(`  /unusual-whales SPY --fast     # Quick GEX + Vol only`);
console.log(`  /unusual-whales --scan         # Daily scan mode`);
console.log(`\nPrerequisites:`);
console.log(`  - Playwright MCP server configured in Claude Code`);
console.log(`  - Active Unusual Whales subscription (logged in via Chrome)`);
console.log("");
