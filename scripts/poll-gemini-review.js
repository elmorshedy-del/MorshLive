#!/usr/bin/env node
/* ============================================================================
 * poll-gemini-review.js — Block merge until gemini-code-assist finishes review.
 *
 * Usage:  node scripts/poll-gemini-review.js <PR_NUMBER> [owner/repo]
 * Env:    GITHUB_TOKEN (optional, increases rate limits)
 *
 * Exit 0 when Gemini posts a completed review (## Code Review on PR reviews).
 * Exit 1 on timeout or missing PR.
 * ==========================================================================*/
const https = require("https");

const PR = process.argv[2];
const REPO = process.argv[3] || process.env.GITHUB_REPOSITORY || "elmorshedy-del/MorshLive";
const [OWNER, REPO_NAME] = REPO.split("/");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const INTERVAL_MS = Number(process.env.GEMINI_POLL_INTERVAL_MS || 30_000);
const MAX_WAIT_MS = Number(process.env.GEMINI_POLL_MAX_MS || 600_000);
const GEMINI = "gemini-code-assist[bot]";

if (!PR || !/^\d+$/.test(PR)) {
  console.error("Usage: node scripts/poll-gemini-review.js <PR_NUMBER> [owner/repo]");
  process.exit(1);
}

function api(path) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "morsh-live-gemini-poll",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    https
      .get(
        {
          hostname: "api.github.com",
          path,
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
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
        }
      )
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
  const [reviews, comments] = await Promise.all([
    api(`/repos/${OWNER}/${REPO_NAME}/pulls/${PR}/reviews`),
    api(`/repos/${OWNER}/${REPO_NAME}/issues/${PR}/comments?per_page=100`),
  ]);
  return reviewComplete(reviews, comments);
}

(async () => {
  const started = Date.now();
  console.log(`Polling Gemini review on ${OWNER}/${REPO_NAME}#${PR} (max ${MAX_WAIT_MS / 1000}s)…`);

  while (Date.now() - started < MAX_WAIT_MS) {
    try {
      const hit = await fetchState();
      if (hit) {
        console.log(`\n✅ Gemini review complete (${hit.kind}, ${Math.round((Date.now() - started) / 1000)}s wait)\n`);
        console.log(excerpt(hit.body));
        process.exit(0);
      }
    } catch (err) {
      console.warn("Poll error:", err.message);
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`… still waiting (${elapsed}s) — looking for gemini-code-assist ## Code Review`);
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  console.error(`\n❌ Timed out after ${MAX_WAIT_MS / 1000}s — Gemini review not complete. Do NOT merge.`);
  console.error(`   Comment on the PR: /gemini review`);
  console.error(`   Then re-run: node scripts/poll-gemini-review.js ${PR}`);
  process.exit(1);
})();
