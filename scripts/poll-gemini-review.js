#!/usr/bin/env node
/* ============================================================================
 * poll-gemini-review.js — Block merge until gemini-code-assist finishes review.
 *
 * Usage:  node scripts/poll-gemini-review.js <PR_NUMBER> [owner/repo]
 * Flags:  --interval=30   seconds between polls (default 30)
 *         --max-wait=600  max seconds to wait before exit 1 (default 600)
 *
 * Env:    GITHUB_TOKEN (optional; invalid tokens fall back to public API)
 *         GEMINI_POLL_INTERVAL_MS, GEMINI_POLL_MAX_MS
 *
 * Exit 0 when Gemini posts a completed review (## Code Review on PR reviews).
 * Exit 1 on timeout or missing PR — always quits; never polls forever.
 * ==========================================================================*/
const https = require("https");

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (const arg of argv) {
  if (arg.startsWith("--interval=")) flags.intervalSec = Number(arg.slice("--interval=".length));
  else if (arg.startsWith("--max-wait=")) flags.maxWaitSec = Number(arg.slice("--max-wait=".length));
  else positional.push(arg);
}

const PR = positional[0];
const REPO = positional[1] || process.env.GITHUB_REPOSITORY || "elmorshedy-del/MorshLive";
const [OWNER, REPO_NAME] = REPO.split("/");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const INTERVAL_MS = Number(
  flags.intervalSec != null ? flags.intervalSec * 1000 : process.env.GEMINI_POLL_INTERVAL_MS || 30_000
);
const MAX_WAIT_MS = Number(
  flags.maxWaitSec != null ? flags.maxWaitSec * 1000 : process.env.GEMINI_POLL_MAX_MS || 600_000
);
const GEMINI = "gemini-code-assist[bot]";

if (!PR || !/^\d+$/.test(PR)) {
  console.error("Usage: node scripts/poll-gemini-review.js <PR_NUMBER> [owner/repo] [--interval=30] [--max-wait=600]");
  process.exit(1);
}

let useToken = !!TOKEN;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function api(path) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "morsh-live-gemini-poll",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (useToken && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

    https
      .get({ hostname: "api.github.com", path, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode === 401 && useToken && TOKEN) {
            log("Poll: GitHub token rejected (401) — retrying without auth for public repo API");
            useToken = false;
            api(path).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function reviewComplete(reviews, comments) {
  const doneReview = (reviews || []).find(
    (r) =>
      r.user &&
      r.user.login === GEMINI &&
      r.body &&
      /## Code Review/i.test(r.body) &&
      r.state !== "PENDING"
  );
  if (doneReview) return { kind: "review", body: doneReview.body, state: doneReview.state };

  const doneComment = (comments || []).find(
    (c) =>
      c.user &&
      c.user.login === GEMINI &&
      c.body &&
      /\*\*Review \((commented|approved|changes requested)\):\*\*/i.test(c.body)
  );
  if (doneComment) return { kind: "comment", body: doneComment.body };

  return null;
}

function excerpt(body) {
  const text = String(body || "").replace(/\r/g, "");
  const idx = text.search(/## Code Review/i);
  const slice = idx >= 0 ? text.slice(idx, idx + 600) : text.slice(0, 400);
  return slice.trim() + (slice.length < text.length ? "\n…" : "");
}

async function fetchState() {
  const load = () =>
    Promise.all([
      api(`/repos/${OWNER}/${REPO_NAME}/pulls/${PR}/reviews`),
      api(`/repos/${OWNER}/${REPO_NAME}/issues/${PR}/comments?per_page=100`),
    ]);

  try {
    const [reviews, comments] = await load();
    return reviewComplete(reviews, comments);
  } catch (err) {
    if (useToken && TOKEN && /401/.test(err.message)) {
      useToken = false;
      log("Poll: GitHub token rejected (401) — using public API");
      const [reviews, comments] = await load();
      return reviewComplete(reviews, comments);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const started = Date.now();
  const maxSec = Math.round(MAX_WAIT_MS / 1000);
  const intervalSec = Math.round(INTERVAL_MS / 1000);
  log(`Polling Gemini review on ${OWNER}/${REPO_NAME}#${PR}`);
  log(`  interval: ${intervalSec}s | max wait: ${maxSec}s | then exit ${useToken ? "with token" : "public API"}`);

  let attempt = 0;
  while (Date.now() - started < MAX_WAIT_MS) {
    attempt += 1;
    try {
      const hit = await fetchState();
      if (hit) {
        const waited = Math.round((Date.now() - started) / 1000);
        log(`\n✅ Gemini review complete (${hit.kind}, ${waited}s, attempt ${attempt})\n`);
        log(excerpt(hit.body));
        process.exit(0);
      }
    } catch (err) {
      log(`Poll error (attempt ${attempt}): ${err.message}`);
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    const remaining = Math.max(0, maxSec - elapsed);
    if (remaining <= 0) break;

    log(`… attempt ${attempt}: no completed review yet (${elapsed}s elapsed, ~${remaining}s left)`);
    const waitMs = Math.min(INTERVAL_MS, remaining * 1000);
    if (waitMs > 0) await sleep(waitMs);
  }

  log(`\n❌ Stopped after ${maxSec}s — Gemini review not complete. Do NOT merge yet.`);
  log(`   Comment on the PR: /gemini review`);
  log(`   Then re-run: node scripts/poll-gemini-review.js ${PR}`);
  log(`   Or use agent.md section 4 self-review fallback, note it in the PR, then merge.`);
  process.exit(1);
})();
