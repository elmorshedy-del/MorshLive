#!/usr/bin/env node
/**
 * KoraZero Diagnostics — does the line enforce its connection limit, and how?
 *
 *   KZ_CONCURRENCY_TEST_APPROVED=1 node scripts/diagnostics/concurrency.mjs stress
 *   KZ_CONCURRENCY_TEST_APPROVED=1 node scripts/diagnostics/concurrency.mjs stagger
 *
 * ---------------------------------------------------------------------------
 * THIS SCRIPT DELIBERATELY EVICTS VIEWERS. It opens several concurrent upstream
 * streams on a line that permits one, which is the very failure the rest of this
 * directory is built to avoid. `run.mjs` holds a lock so two diagnostics can
 * never overlap; this bypasses that by design, so it is gated on an explicit
 * environment variable instead. Run it only on a confirmed-idle line with no
 * viewers present — never during a match.
 * ---------------------------------------------------------------------------
 *
 * WHY IT EXISTS. On 2026-09-18 a set of 15-20 s concurrency pulls concluded the
 * limit was not enforced, because five simultaneous streams all returned 200
 * with bytes flowing. That was wrong, and the error was in the pass criterion:
 * an evicted connection *also* returns 200 and *also* delivers bytes — for about
 * two seconds — before the upstream closes it. "Did any bytes arrive" cannot
 * tell a served stream from an evicted one. Only run length can.
 *
 * So both modes here score on SURVIVAL TO THE FULL DURATION, never on bytes:
 *
 *   stress   N concurrent pulls for 150 s, same channel and different channels,
 *            heavy feeds and light ones. Counts how many reach the end.
 *
 *   stagger  the decisive one. An incumbent streams alone, a newcomer joins 60 s
 *            in, and we see which of the two dies. It runs a SOLO CONTROL first
 *            — the same incumbent, same duration, nobody joining — because
 *            without it "the incumbent died at 62 s" is indistinguishable from
 *            "that feed dies at ~60 s on its own". The control is what makes the
 *            result a result. It then reverses the roles, so the outcome cannot
 *            be a property of one particular feed.
 *
 * Durations are long on purpose. The eviction lands seconds after the *second*
 * connection opens, so a test shorter than the join it is probing cannot see it.
 */

import { measureTransport, resolvePlayable } from "./transport.mjs";

const ORIGIN = process.env.KZ_DIAG_ORIGIN || "https://korazero.com";
const RUN_SECONDS = 150;
const JOIN_AT_SECONDS = 60;

/** Labels are descriptive only; the stream ids are what the provider resolves. */
const FEEDS = {
  74006: "beIN 1 FHD    heavy",
  7053: "beIN 1 HEVC   heavy",
  46028: "beIN 1 FHD Q  heavy",
  3177: "beIN 1 HD     light",
  2449: "beIN 1 HD Q   light",
  3974: "ON E [EG]     light",
};

/**
 * How long the stream actually ran. `meanMbps` is the mean over the delivered
 * period, so bytes/rate recovers the live seconds even when the pull was told to
 * run far longer — which is exactly the number an eviction shows up in.
 */
const ranSeconds = (r) => (r.megabytes && r.meanMbps ? (r.megabytes * 8) / r.meanMbps : 0);

function show(label, target, r) {
  if (r.status !== 200) {
    console.log(`  ${label.padEnd(26)} FAILED ${r.status ?? "-"} ${r.error ?? ""}`);
    return;
  }
  console.log(
    `  ${label.padEnd(26)} ran ${ranSeconds(r).toFixed(0).padStart(3)}s of ${String(target).padStart(3)}s  ` +
      `${String(r.megabytes ?? 0).padStart(6)} MB  ${String(r.meanMbps ?? "-").padStart(6)} Mbps  ` +
      `${r.earlyClose ? "*** DIED EARLY ***" : "survived"}`,
  );
}

async function lineState(when) {
  try {
    const s = await fetch(`${ORIGIN}/api/iptv-lab/status`).then((x) => x.json());
    const a = s.portals[0].account;
    // Recorded, not trusted: this counter has read 0/1 during live pulls.
    console.log(`  [line ${when}: reports ${a.activeConnections}/${a.maxConnections}]`);
  } catch {
    console.log(`  [line ${when}: status unavailable]`);
  }
}

const settle = (secs) => new Promise((r) => setTimeout(r, secs * 1000));

async function stress() {
  const scenarios = [
    ["A — three HEAVY feeds, DIFFERENT channels", ["74006", "7053", "46028"]],
    ["B — three viewers on the SAME heavy channel", ["74006", "74006", "74006"]],
    ["C — three LIGHT feeds, DIFFERENT channels", ["3177", "2449", "3974"]],
    ["D — five concurrent, mixed heavy and light", ["74006", "7053", "46028", "3177", "3974"]],
  ];

  for (const [label, streams] of scenarios) {
    console.log(`\n${"=".repeat(78)}\n${label}   (${streams.length} concurrent, ${RUN_SECONDS}s)\n${"=".repeat(78)}`);
    await lineState("before");

    const metas = [];
    for (const id of streams) {
      metas.push({ id, ...(await resolvePlayable({ origin: ORIGIN, portal: "p1", stream: id })) });
    }

    const results = await Promise.all(
      metas.map((m) =>
        measureTransport({ origin: ORIGIN, tsUrl: m.tsUrl, seconds: RUN_SECONDS }).then((r) => ({ m, r })),
      ),
    );

    let survived = 0;
    for (const { m, r } of results) {
      if (r.status === 200 && !r.earlyClose) survived += 1;
      show(`${m.id} ${FEEDS[m.id] ?? ""}`, RUN_SECONDS, r);
    }
    console.log(`\n  => ${survived}/${results.length} survived the full ${RUN_SECONDS}s`);
    await settle(10);
  }
}

/** One incumbent, one newcomer joining partway. Returns which side died. */
async function join(incumbentMeta, newcomerMeta, incumbentLabel, newcomerLabel) {
  const incumbent = measureTransport({ origin: ORIGIN, tsUrl: incumbentMeta.tsUrl, seconds: RUN_SECONDS });
  console.log(`  t=0    incumbent ${incumbentLabel} starts`);
  await settle(JOIN_AT_SECONDS);
  console.log(`  t=${JOIN_AT_SECONDS}   newcomer ${newcomerLabel} joins`);
  const newcomer = measureTransport({
    origin: ORIGIN,
    tsUrl: newcomerMeta.tsUrl,
    seconds: RUN_SECONDS - JOIN_AT_SECONDS,
  });

  const [ri, rn] = await Promise.all([incumbent, newcomer]);
  show(`incumbent ${incumbentLabel}`, RUN_SECONDS, ri);
  show(`newcomer  ${newcomerLabel}`, RUN_SECONDS - JOIN_AT_SECONDS, rn);

  if (ri.earlyClose && !rn.earlyClose) console.log("  => INCUMBENT EVICTED — a new viewer kills an established one");
  else if (!ri.earlyClose && rn.earlyClose) console.log("  => newcomer refused — established viewers are protected");
  else if (ri.earlyClose && rn.earlyClose) console.log("  => both died");
  else console.log("  => both survived — no eviction at this spacing");
  return ri.earlyClose;
}

async function stagger() {
  const heavy = await resolvePlayable({ origin: ORIGIN, portal: "p1", stream: "74006" });
  const light = await resolvePlayable({ origin: ORIGIN, portal: "p1", stream: "3177" });
  console.log(`heavy = ${heavy.name} (74006)\nlight = ${light.name} (3177)`);

  console.log(`\n${"=".repeat(78)}\nCONTROL — 74006 alone for ${RUN_SECONDS}s, nothing else opened\n${"=".repeat(78)}`);
  const control = await measureTransport({ origin: ORIGIN, tsUrl: heavy.tsUrl, seconds: RUN_SECONDS });
  show("74006 solo", RUN_SECONDS, control);
  if (control.earlyClose) {
    console.log("\n  => SOLO INCUMBENT DIED WITH NOBODY JOINING.");
    console.log("     Stop here: the join tests below cannot attribute anything to the newcomer.");
    return;
  }
  console.log(`  => solo incumbent survives ${RUN_SECONDS}s — a join test is now interpretable`);

  await settle(20);
  console.log(`\n${"=".repeat(78)}\nJOIN — heavy incumbent, light newcomer\n${"=".repeat(78)}`);
  await join(heavy, light, "74006", "3177");

  await settle(20);
  console.log(`\n${"=".repeat(78)}\nREVERSED — light incumbent, heavy newcomer\n${"=".repeat(78)}`);
  await join(light, heavy, "3177", "74006");
}

async function main() {
  if (process.env.KZ_CONCURRENCY_TEST_APPROVED !== "1") {
    console.error("Refusing to run: this script opens concurrent streams and evicts real viewers.");
    console.error("Confirm the line is idle, then set KZ_CONCURRENCY_TEST_APPROVED=1.");
    process.exit(2);
  }

  const mode = process.argv[2];
  if (mode === "stress") await stress();
  else if (mode === "stagger") await stagger();
  else {
    console.error("usage: concurrency.mjs stress|stagger");
    process.exit(2);
  }

  await lineState("after");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
