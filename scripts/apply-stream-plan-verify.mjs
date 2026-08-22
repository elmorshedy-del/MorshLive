#!/usr/bin/env node
/**
 * Record a pre-kickoff probe against assets/data/stream-plans.json.
 *
 * Usage:
 *   node scripts/apply-stream-plan-verify.mjs --match=espn-eng.1-401111111 --source=primary --ok
 *   node scripts/apply-stream-plan-verify.mjs --match=espn-eng.1-401111111 --source=primary --fail --note="blank iframe"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyVerificationResult, emptyCatalog } from "../lib/stream-plan.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "assets", "data", "stream-plans.json");

function parseArgs(argv) {
  const out = { matchId: "", sourceId: "", ok: null, note: "", expiresAt: "" };
  for (const arg of argv) {
    if (arg === "--ok") out.ok = true;
    else if (arg === "--fail") out.ok = false;
    else if (arg.startsWith("--match=")) out.matchId = arg.slice(8);
    else if (arg.startsWith("--source=")) out.sourceId = arg.slice(9);
    else if (arg.startsWith("--note=")) out.note = arg.slice(7);
    else if (arg.startsWith("--expires=")) out.expiresAt = arg.slice(10);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.matchId || args.ok == null) {
    console.error("Usage: node scripts/apply-stream-plan-verify.mjs --match=ID --source=primary --ok|--fail");
    process.exit(2);
  }

  let catalog = emptyCatalog();
  try {
    catalog = { ...emptyCatalog(), ...JSON.parse(fs.readFileSync(CATALOG, "utf8")) };
  } catch {
    catalog = emptyCatalog();
  }
  catalog.plans = Array.isArray(catalog.plans) ? catalog.plans : [];

  const index = catalog.plans.findIndex((plan) => String(plan.matchId || "") === args.matchId);
  if (index < 0) {
    console.error(`No stream plan for ${args.matchId}. Add the match to assets/data/stream-plans.json first.`);
    process.exit(1);
  }

  catalog.plans[index] = applyVerificationResult(catalog.plans[index], {
    sourceId: args.sourceId,
    ok: args.ok,
    note: args.note,
    expiresAt: args.expiresAt || undefined,
  });
  catalog.updatedAt = new Date().toISOString();
  fs.writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`${args.ok ? "verified" : "failed"} ${args.matchId} source=${args.sourceId || "primary"}`);
}

main();
