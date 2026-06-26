#!/usr/bin/env node
/* ============================================================================
 * install-open-design.js — Init Open Design submodule + register KoraZero DS.
 *
 * Usage:  npm run open-design:install
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "open-design");
const KZ_DS = path.join(ROOT, "design-systems", "korazero");
const VENDOR_DS_LINK = path.join(VENDOR, "design-systems", "korazero");

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: opts.cwd || ROOT, ...opts });
}

function symlinkKorazero() {
  if (!fs.existsSync(VENDOR)) {
    console.error("vendor/open-design missing — run: git submodule update --init --recursive");
    process.exit(1);
  }
  const dsDir = path.join(VENDOR, "design-systems");
  fs.mkdirSync(dsDir, { recursive: true });
  try {
    if (fs.existsSync(VENDOR_DS_LINK)) {
      const stat = fs.lstatSync(VENDOR_DS_LINK);
      if (stat.isSymbolicLink() || stat.isDirectory()) fs.rmSync(VENDOR_DS_LINK, { recursive: true, force: true });
    }
  } catch (_) { /* ignore */ }
  const rel = path.relative(dsDir, KZ_DS);
  fs.symlinkSync(rel, VENDOR_DS_LINK, "dir");
  console.log(`Linked design-systems/korazero → vendor/open-design/design-systems/korazero`);
}

(function main() {
  if (!fs.existsSync(path.join(VENDOR, "package.json"))) {
    console.log("Initializing git submodule vendor/open-design …");
    run("git submodule update --init --recursive vendor/open-design");
  }
  symlinkKorazero();
  console.log("\n✅ Open Design ready.");
  console.log("   Catalog: vendor/open-design/design-systems/ (+ korazero symlink)");
  console.log("   Tokens:  design-systems/korazero/tokens.css");
  console.log("   Preview: design-systems/korazero/components.html");
  console.log("\nOptional — run Open Design UI:");
  console.log("   cd vendor/open-design && corepack enable && pnpm install && pnpm tools-dev run web");
  console.log("\nOptional — MCP for Cursor:");
  console.log("   cd vendor/open-design && npx od mcp install cursor");
})();
