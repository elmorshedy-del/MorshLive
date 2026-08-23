#!/usr/bin/env node
/**
 * Fast HTTP probe of yallacuo / koralive AlbaPlayer slots.
 * Use this at T-15 instead of a long visual tour. Bind only after a scorebug.
 *
 *   node scripts/probe-arabic-wrappers.mjs
 */
import { parseAlbaWrapper } from "../lib/bind-loop.js";

const SLOTS = [
  "https://mo.yallacuo.xyz/albaplayer/sport-1/",
  "https://mo.yallacuo.xyz/albaplayer/sport-2/",
  "https://mo.yallacuo.xyz/albaplayer/sport-3/",
  "https://mo.yallacuo.xyz/albaplayer/sport-4/",
  "https://mo.yallacuo.xyz/albaplayer/sport-5/",
  "https://pl.koralive1.cc/albaplayer/bein1/",
  "https://pl.koralive1.cc/albaplayer/bein2/",
  "https://pl.koralive1.cc/albaplayer/bein3/",
  "https://pl.koralive1.cc/albaplayer/bein4/",
  "https://pl.koralive1.cc/albaplayer/bein5/",
];

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 KoraZero-bind-loop" },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  return { status: res.status, html: await res.text() };
}

const rows = [];
for (const url of SLOTS) {
  try {
    const { status, html } = await fetchHtml(url);
    const parsed = parseAlbaWrapper(html);
    rows.push({ url, status, ...parsed });
  } catch (err) {
    rows.push({ url, status: "ERR", title: "", faborId: "", iframeSrc: String(err.message || err) });
  }
}
console.log(JSON.stringify({ probedAt: new Date().toISOString(), slots: rows }, null, 2));
