#!/usr/bin/env node
/**
 * Find a Cloudflare API token that can deploy the morshlive Worker.
 * Loads .env (gitignored) then checks env vars.
 * Prints export lines for bash: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] == null || process.env[m[1]] === "") {
      process.env[m[1]] = val;
    }
  }
}

loadDotEnv();

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
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/morshlive`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve({ ok: (res.statusCode === 200 || res.statusCode === 404) && json.success !== false, status: res.statusCode, errors: json.errors });
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

  console.error("No token with Workers deploy permission found.");
  process.exit(1);
})();
