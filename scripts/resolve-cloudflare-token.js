#!/usr/bin/env node
/**
 * Find a Cloudflare API token that can deploy to Pages.
 * Checks known secret names, then any env value that looks like cfat_/cfut_.
 * Prints export lines for bash: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 */
const https = require("https");

const ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLAREID || "";
const PROJECT = process.env.CF_PAGES_PROJECT || "korazero";

const PREFERRED = [
  "CLOUDFLARE_TOKEN5",
  "CLOUDFLARE_API_TOKEN",
  "Cloudflare",
  "CLOUDFLARE_TOKEN",
  "CF_API_TOKEN",
];

function candidates() {
  const seen = new Set();
  const list = [];

  function add(name, raw) {
    if (!raw || seen.has(raw)) return;
    const value = String(raw).trim().replace(/ /g, "");
    if (!/^cf(at|ut|k)_[A-Za-z0-9]+/.test(value)) return;
    seen.add(value);
    list.push({ name, value });
  }

  for (const name of PREFERRED) add(name, process.env[name]);
  for (const [name, value] of Object.entries(process.env)) {
    if (/cloud|cf_|token/i.test(name)) add(name, value);
  }
  for (const [, value] of Object.entries(process.env)) {
    if (typeof value === "string" && /^cfat_[A-Za-z0-9]{40}/.test(value.trim())) {
      add("(scan)", value);
    }
  }
  return list;
}

function probe(token) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.cloudflare.com",
        path: `/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/upload-token`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve({ ok: res.statusCode === 200 && json.success, status: res.statusCode, errors: json.errors });
          } catch {
            resolve({ ok: false, status: res.statusCode, errors: [] });
          }
        });
      }
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}

(async () => {
  if (!ACCOUNT_ID) {
    console.error("Missing CLOUDFLARE_ACCOUNT_ID");
    process.exit(1);
  }

  const list = candidates();
  if (!list.length) {
    console.error("No Cloudflare token candidates in environment.");
    console.error("Checked:", PREFERRED.join(", "), "+ env scan for cfat_");
    process.exit(1);
  }

  for (const { name, value } of list) {
    const result = await probe(value);
    if (result.ok) {
      if (process.argv.includes("--export")) {
        const esc = value.replace(/'/g, "'\\''");
        console.log(`export CLOUDFLARE_API_TOKEN='${esc}'`);
        console.log(`export CLOUDFLARE_ACCOUNT_ID='${ACCOUNT_ID}'`);
      } else {
        console.log(JSON.stringify({ ok: true, source: name, accountId: ACCOUNT_ID }));
      }
      process.exit(0);
    }
    if (!process.argv.includes("--quiet")) {
      console.error(`[skip] ${name}: status ${result.status}`, result.errors?.[0]?.message || result.error || "");
    }
  }

  console.error("No token with Pages deploy permission found.");
  process.exit(1);
})();
