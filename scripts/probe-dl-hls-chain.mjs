#!/usr/bin/env node
const url = process.argv[2] || "https://korazero.com/dl/94";

async function fetchText(u, headers = {}) {
  const res = await fetch(u, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", ...headers },
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, text };
}

const page = await fetchText(url);
const m = page.text.match(/data-kz-src="([^"]+)"/);
if (!m) {
  console.log("no player", page.status, page.text.slice(0, 120));
  process.exit(1);
}
const master = await fetchText(m[1]);
const variantLine = master.text.split("\n").find((l) => l.trim() && !l.startsWith("#"));
console.log("master", master.status);
console.log("variantLine", variantLine?.slice(0, 100));
const variantUrl = variantLine.startsWith("http") ? variantLine : `https://korazero.com${variantLine}`;
const variant = await fetchText(variantUrl);
console.log("variant via proxy", variant.status, variant.text.slice(0, 80));
const upstream = decodeURIComponent(new URL(variantUrl).searchParams.get("u") || "");
if (upstream) {
  for (const ref of ["", "https://dlhd.pk/", "https://fomis.phantemlis.top/", "https://korazero.com/dl/94"]) {
    const r = await fetchText(upstream, ref ? { Referer: ref } : {});
    console.log("direct upstream ref", ref || "(none)", r.status);
  }
}
