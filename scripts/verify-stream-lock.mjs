#!/usr/bin/env node
/**
 * CHATGPT-STAMP 2026-09-06T14:33-04:00 — PRODUCTION-STREAM-LOCK-1
 *
 * Freeze the known-good production playback implementation without freezing the
 * rest of the repository. Every file below must remain byte-for-byte identical
 * to the approved 8fe04a34 state unless an explicit, short-lived stream-change
 * plan is present AND the deploy environment carries the manual approval flag.
 *
 * This guard runs before and after Cloudflare's refresh build and from the local
 * deploy wrapper. Do not weaken or bypass it for ordinary content/data work.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASELINE_COMMIT = "8fe04a34667a75637d20bb46c4072a9925ab573c";
const APPROVAL_VALUE = "YES_I_INTEND_TO_CHANGE_PRODUCTION_STREAMING";
const PLAN_PATH = resolve("config/stream-change-plan.json");
const MAX_PLAN_WINDOW_MS = 24 * 60 * 60 * 1000;

// Git blob SHAs from the known-good production tree. These are exact-byte
// fingerprints, not semantic guesses. Lab and KoraZero Live are intentionally
// locked separately inside the same table.
const LOCKED_FILES = Object.freeze({
  "iptv-lab.html": "67ace9fbc5e58c6dc08c532a5169fe294518e3f9",
  "watch.html": "1221e76d929c3f1fcead13bb88e9504d9102905b",
  "watch-embed.html": "c236f654fd4071f475c05d9e3086fe75c63217a1",
  "assets/js/iptv-lab.js": "5ff9896cc315258753cf23a76b506f32d75ffd1a",
  "assets/js/iptv-quality.js": "1c0de8794befded840bed10eae179a39ff936925",
  "assets/js/mpegts-config.js": "1dec1d1d20a61c5833eb33a117cbdcbd7e7d0433",
  "assets/js/mpegts-recovery-guard.js": "b6095c81cd31b30a99e6fb96ed61607bfbd3ab5c",
  "assets/js/stream-plan-api.js": "8995082c08e1d70ce7cef20bd7e4b1c075564ae8",
  "assets/js/stream-routes.js": "686bff614789077b9151ecf0a6f6c48510769d60",
  "assets/js/watch-embed.js": "3a648bb59889c70f54673faff0690549d7d44c24",
  "assets/js/watch-lab-continuity-guard.js": "4e6242674c51d1926836dd62c216e772707b8346",
  "assets/js/watch-loader.js": "d40237ad871bb08164150881ff0f397d8786dafb",
  "assets/js/watch-xtream.js": "c2bb43f70f3264bd5e01adad35b349471a3371da",
  "assets/js/watch.js": "b2a9181ee1c801b6f5d33b732402215657ea31d3",
  "backend/adapters/xtream-media-safe.js": "8783bb87cbb1f24b3b08be7e12ec373b118f1532",
  "backend/adapters/xtream.js": "0fcd0222e9b357c086a6528d7dc645935b14e69f",
  "backend/router.js": "cd2deaedbec624863dd1fabb0dae0864bb3ec2fd",
  "backend/routes/index.js": "17e90d3f0816109f38f149b533ba039a35c0df72",
  "backend/routes/iptv-lab.js": "1abd3a9a3a5b1b03085bcb8b2933dc838b28639f",
  "backend/routes/stream-plan.js": "9383c53caa67085b2dd26a0f41e44cb6b5d54fff",
  "backend/routes/xtream.js": "443cfaed838dcdc6d0dc397793a1487c92a51d2a",
  "backend/services/iptv-lab.js": "ffe3967558222b8ebae55b0411defcc02524f9eb",
  "backend/services/stream-plan.js": "36633fefa2312730457b71f4a9d058b6a4fda9d0",
  "backend/services/xtream.js": "82e481766d2b87a17a33a88d41185931c3cfaa97",
  "lib/hls-cache.js": "7df783457d4600318b1bf0f0b674a43a8bd2fb5b",
  "lib/hls-recover.js": "4772633e75ee2d80f01035d55e26e8747aec0cf5",
  "lib/iptv-lab.js": "f7a681d3a6e1efc73ed5760165f2793b0f81b1d8",
  "lib/mpegts-config.js": "5a52c8168cd652c87436f3ed36773b382341e0eb",
  "lib/operator-embed.js": "5d7ec9e93e156cc41ee615e199915adf39fee885",
  "lib/stream-plan.js": "1acbe9170d35cdac4a1110880f69a46185aeaf92",
  "lib/xtream-channel-map.js": "a8896e588be715f225ffba8c78c56fae6a852ddf",
  "lib/xtream-client.js": "f86e5b6a538ec08d7ba226f7686fdfdc9dbcfd10",
  "worker.js": "637314e36ca4fa881fe5d0cfd1f5504e9d985655",
  "wrangler.toml": "663088846e92661a19241e1c0c7133ec5873eeaa",
});

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function mismatches() {
  const changed = [];
  for (const [file, expected] of Object.entries(LOCKED_FILES)) {
    const absolute = resolve(file);
    if (!existsSync(absolute)) {
      changed.push({ file, expected, actual: "MISSING" });
      continue;
    }
    const actual = gitBlobSha(readFileSync(absolute));
    if (actual !== expected) changed.push({ file, expected, actual });
  }
  return changed;
}

function approvedPlan(changed) {
  if (process.env.KZ_STREAM_CHANGE_APPROVED !== APPROVAL_VALUE) return null;
  if (!existsSync(PLAN_PATH)) return null;

  let plan;
  try {
    plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  } catch {
    return null;
  }

  const reason = String(plan.reason || "").trim();
  const baseline = String(plan.baseline || "").trim();
  const expiresAt = Date.parse(String(plan.expiresAt || ""));
  const allowed = new Set(Array.isArray(plan.allowedFiles) ? plan.allowedFiles.map(String) : []);
  const now = Date.now();

  if (baseline !== BASELINE_COMMIT) return null;
  if (reason.length < 20) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > MAX_PLAN_WINDOW_MS) return null;
  if (!changed.every(({ file }) => allowed.has(file))) return null;

  return { reason, expiresAt: new Date(expiresAt).toISOString() };
}

const changed = mismatches();
if (!changed.length) {
  console.log(
    `STREAM LOCK OK — ${Object.keys(LOCKED_FILES).length} production playback files match ${BASELINE_COMMIT.slice(0, 8)}.`,
  );
  process.exit(0);
}

const plan = approvedPlan(changed);
if (plan) {
  console.warn("STREAM LOCK EXPLICITLY UNLOCKED FOR A PLANNED CHANGE.");
  console.warn(`Reason: ${plan.reason}`);
  console.warn(`Approval expires: ${plan.expiresAt}`);
  for (const { file } of changed) console.warn(`  approved: ${file}`);
  process.exit(0);
}

console.error("");
console.error("❌ STREAM LOCK — production playback differs from the approved known-good state.");
console.error(`Baseline: ${BASELINE_COMMIT}`);
console.error("");
for (const { file, expected, actual } of changed) {
  console.error(`  ${file}`);
  console.error(`    expected ${expected}`);
  console.error(`    actual   ${actual}`);
}
console.error("");
console.error("Deployment refused. Ordinary repo/content/data changes may continue, but playback is frozen.");
console.error("Intentional streaming work requires BOTH:");
console.error("  1. config/stream-change-plan.json with reason, baseline, expiresAt, and allowedFiles");
console.error(`  2. KZ_STREAM_CHANGE_APPROVED=${APPROVAL_VALUE} in the deliberate deploy environment`);
console.error("After validation, establish a new known-good baseline and remove the temporary approval.");
process.exit(1);
