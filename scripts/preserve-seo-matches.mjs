#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedSeoMatches } from "../lib/match-seo-data.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODAY_JSON = path.join(ROOT, "assets", "data", "today.json");
const TEMP_ARCHIVE = path.join(os.tmpdir(), "korazero-seo-matches-prev.json");

let payload = { matches: [] };
try {
  payload = JSON.parse(fs.readFileSync(TODAY_JSON, "utf8"));
} catch {
  /* first run */
}

const existing = Array.isArray(payload.seoMatches) ? payload.seoMatches : payload.matches || [];
const observedAt = payload.updatedAt || `${payload.date || "1970-01-01"}T00:00:00Z`;
const preserved = seedSeoMatches(existing, observedAt);
fs.writeFileSync(TEMP_ARCHIVE, JSON.stringify(preserved));
console.log(`Preserved ${preserved.length} SEO match page(s) before fixture refresh.`);
