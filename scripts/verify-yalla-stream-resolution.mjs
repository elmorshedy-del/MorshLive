#!/usr/bin/env node
/* Smoke-test /yk/embed — auto-discovers live yallak0ra match (Portugal vs Croatia). */
import { createServer } from "node:http";
import worker from "../worker.js";

const PORT = 8788;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const env = {
  STREAM_SIGNING_SECRET: "test-secret-yalla-verify",
  ASSETS: { fetch: () => new Response("not found", { status: 404 }) },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const request = new Request(url.toString(), {
    method: req.method,
    headers: { "User-Agent": "morsh-verify/1.0" },
  });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, async () => {
  let failed = 0;
  const tests = [
    {
      label: "auto=live Portugal/Croatia",
      url: `${ORIGIN}/yk/embed/?auto=live&home=Portugal&away=Croatia&serv=1`,
    },
    {
      label: "koraalive direct",
      url: `${ORIGIN}/yk/embed/?page=${encodeURIComponent("https://www.koraalive.net/2026/07/portugal-vs-croatia-world-cup-2026.html")}&serv=1`,
    },
  ];
  for (const t of tests) {
    try {
      const r = await fetch(t.url, { headers: { "User-Agent": "morsh-verify/1.0" } });
      const body = await r.text();
      const mirrors = r.headers.get("x-kz-mirrors") || "0";
      const page = r.headers.get("x-kz-yalla-page") || "";
      const ok = r.ok && (body.includes("data-kz-src") || body.includes("player.twitch.tv"));
      console.log(
        `${ok ? "OK" : "FAIL"} [${t.label}] status=${r.status} mirrors=${mirrors} page=${page.slice(0, 70)}`
      );
      if (!ok) {
        failed++;
        console.log(body.slice(0, 200));
      }
    } catch (err) {
      failed++;
      console.error("ERR", t.label, err.message);
    }
  }
  server.close();
  process.exit(failed ? 1 : 0);
});
