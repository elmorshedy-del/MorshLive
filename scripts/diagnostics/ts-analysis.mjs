/**
 * KoraZero Diagnostics — MPEG-TS media clock.
 *
 * The replacement for `bufferFloorSeconds`, which was circular: it consumed at
 * the feed's own mean delivered rate, so it measured deviation from the feed's
 * own trend and never the *level* of that trend. A feed running at 60% of its
 * encode rate for an entire window scored ~0 — exactly the shape that sustained
 * under-delivery, shaping or contention would take.
 *
 * This measures against an absolute reference instead. MPEG-TS carries a
 * Program Clock Reference: a 33-bit counter at 90 kHz, emitted in the adaptation
 * field, which is the encoder's own notion of time. Comparing how much PCR time
 * arrived against how much wall-clock time passed answers the only question that
 * matters for a drain:
 *
 *     at T seconds in, how many seconds of playable media have actually landed?
 *
 * A live feed must deliver ~1 second of media per second of wall clock. Falling
 * behind and staying behind is starvation. Falling behind and catching up is
 * batching, and is harmless as long as the player's buffer covers the excursion.
 * The two look identical in a byte-rate graph; they are unambiguous here.
 *
 * Nothing in this file allocates per packet or keeps the stream in memory: it is
 * fed chunks as they arrive and keeps only the timeline.
 */

const PACKET = 188;
const SYNC = 0x47;
/** 33-bit 90 kHz counter; it wraps roughly every 26.5 hours. */
const PCR_WRAP_SECONDS = 2 ** 33 / 90000;

/**
 * Pull the PCR out of one 188-byte packet, or null when it carries none.
 *
 * Layout: byte 3 holds the adaptation-field-control in bits 5-4. The adaptation
 * field is present when that value has the 0b10 bit. Its first byte is a length,
 * its second a flag set, and bit 4 of those flags (0x10) marks a PCR. The PCR
 * then occupies the next six bytes as a 33-bit base plus a 9-bit extension.
 */
function readPcr(buf, offset) {
  const adaptationFieldControl = (buf[offset + 3] >> 4) & 0b11;
  if (!(adaptationFieldControl & 0b10)) return null;

  const adaptationLength = buf[offset + 4];
  if (adaptationLength < 7) return null; // too short to hold a PCR

  const flags = buf[offset + 5];
  if (!(flags & 0x10)) return null;

  const b = offset + 6;
  // 33-bit base, most significant bit first, ending in the top bit of byte 4.
  const base =
    buf[b] * 2 ** 25 + buf[b + 1] * 2 ** 17 + buf[b + 2] * 2 ** 9 + buf[b + 3] * 2 + (buf[b + 4] >> 7);
  return base / 90000;
}

function readPid(buf, offset) {
  return ((buf[offset + 1] & 0x1f) << 8) | buf[offset + 2];
}

/**
 * Accumulates a TS stream chunk by chunk and reports the media clock against
 * the wall clock.
 *
 * PCR appears only on the PID nominated by the PMT. Rather than parse the PMT,
 * every PID's PCRs are collected and the one carrying the most is used as the
 * clock — on a single-program transport stream that is the same PID, and it
 * survives a stream whose PMT never arrives or arrives late.
 */
export class MediaClock {
  constructor() {
    /** Partial packet carried between chunks. */
    this.carry = Buffer.alloc(0);
    /** pid -> { count, firstSec, lastSec, samples: [[wallMs, mediaSec]] } */
    this.byPid = new Map();
    /** pid -> last continuity counter seen, for loss detection. */
    this.continuity = new Map();
    this.continuityErrors = [];
    this.packets = 0;
    this.resyncs = 0;
    this.bytesSeen = 0;
  }

  /** Feed one arriving chunk. `wallMs` is ms since the first byte of the pull. */
  push(chunk, wallMs) {
    this.bytesSeen += chunk.length;
    let buf = this.carry.length ? Buffer.concat([this.carry, chunk]) : Buffer.from(chunk);
    let offset = 0;

    while (offset + PACKET <= buf.length) {
      if (buf[offset] !== SYNC) {
        // Lost alignment. Hunt for the next sync byte that also has one a
        // packet later, which is what distinguishes a real boundary from a
        // 0x47 that happens to appear inside the payload.
        let candidate = -1;
        for (let i = offset + 1; i + PACKET < buf.length; i += 1) {
          if (buf[i] === SYNC && buf[i + PACKET] === SYNC) {
            candidate = i;
            break;
          }
        }
        if (candidate === -1) break;
        this.resyncs += 1;
        offset = candidate;
        continue;
      }

      this.packets += 1;
      const pid = readPid(buf, offset);

      // Continuity counter increments per packet carrying payload on a PID.
      const adaptationFieldControl = (buf[offset + 3] >> 4) & 0b11;
      if (adaptationFieldControl & 0b01) {
        const cc = buf[offset + 3] & 0x0f;
        const previous = this.continuity.get(pid);
        if (previous !== undefined) {
          const expected = (previous + 1) & 0x0f;
          // A repeat of the same counter is a legal duplicate, not a loss.
          if (cc !== expected && cc !== previous) {
            this.continuityErrors.push({ pid, atSec: +(wallMs / 1000).toFixed(2), expected, got: cc });
          }
        }
        this.continuity.set(pid, cc);
      }

      const pcr = readPcr(buf, offset);
      if (pcr !== null) {
        let entry = this.byPid.get(pid);
        if (!entry) {
          entry = { count: 0, firstSec: pcr, lastSec: pcr, samples: [] };
          this.byPid.set(pid, entry);
        }
        entry.count += 1;
        entry.lastSec = pcr;
        entry.samples.push([wallMs, pcr]);
      }

      offset += PACKET;
    }

    this.carry = offset < buf.length ? buf.subarray(offset) : Buffer.alloc(0);
    // Never let the carry grow without bound on a stream that is not TS at all.
    if (this.carry.length > PACKET * 8) this.carry = this.carry.subarray(this.carry.length - PACKET * 2);
  }

  /** The PID carrying the clock: whichever emitted the most PCRs. */
  clockPid() {
    let best = null;
    for (const [pid, entry] of this.byPid) {
      if (!best || entry.count > this.byPid.get(best).count) best = pid;
    }
    return best;
  }

  /**
   * The result. `mediaSeconds` is how much encoder time arrived; `deficit` is
   * how far behind the wall clock it ever fell, and whether it recovered.
   */
  report(elapsedMs) {
    const pid = this.clockPid();
    const looksLikeTs = this.packets > 20 && this.bytesSeen > 0 && this.packets * PACKET > this.bytesSeen * 0.5;

    if (pid === null) {
      return {
        ok: false,
        reason: looksLikeTs
          ? "transport stream carries no PCR on any PID"
          : "payload does not parse as MPEG-TS (no aligned 188-byte packets)",
        packets: this.packets,
        resyncs: this.resyncs,
        continuityErrors: this.continuityErrors.length,
      };
    }

    const entry = this.byPid.get(pid);
    const samples = entry.samples;

    // Unwrap the 33-bit counter so a rollover mid-pull does not read as a jump
    // backwards of 26 hours.
    let wraps = 0;
    const unwrapped = [];
    for (let i = 0; i < samples.length; i += 1) {
      const [wallMs, raw] = samples[i];
      if (i > 0 && raw < samples[i - 1][1] - PCR_WRAP_SECONDS / 2) wraps += 1;
      unwrapped.push([wallMs, raw + wraps * PCR_WRAP_SECONDS]);
    }

    const originMedia = unwrapped[0][1];
    const originWall = unwrapped[0][0];

    // Discontinuities: the encoder clock jumping, which is content missing from
    // the timeline rather than bytes arriving late. A PCR is normally emitted
    // at least every 100 ms, so anything beyond a wide margin is a real jump.
    const jumps = [];
    for (let i = 1; i < unwrapped.length; i += 1) {
      const mediaStep = unwrapped[i][1] - unwrapped[i - 1][1];
      const wallStep = (unwrapped[i][0] - unwrapped[i - 1][0]) / 1000;
      if (mediaStep < -0.05 || mediaStep > Math.max(1.5, wallStep + 1.5)) {
        jumps.push({
          atSec: +(unwrapped[i][0] / 1000).toFixed(2),
          mediaStepSec: +mediaStep.toFixed(3),
          wallStepSec: +wallStep.toFixed(3),
        });
      }
    }

    // The core series: at each PCR, how far media time trails wall time.
    // Positive deficit means less media arrived than time passed.
    let maxDeficit = 0;
    let maxDeficitAtSec = 0;
    let worstRunStart = null;
    let longestBehindMs = 0;
    let currentRunStart = null;
    const deficitSeries = [];

    // Each arrival is scored against the media that was in hand *before* it
    // landed. That instant — the moment before a delayed PCR arrives — is when
    // the buffer is emptiest. Scoring against the post-arrival value instead
    // reports zero deficit for a feed that has just been silent for seconds,
    // which is the exact blind spot that made the previous metric useless.
    let heldMedia = 0;
    for (const [wallMs, media] of unwrapped) {
      const wallSec = (wallMs - originWall) / 1000;
      const mediaSec = media - originMedia;
      const deficit = wallSec - heldMedia;
      heldMedia = mediaSec;
      deficitSeries.push([+wallSec.toFixed(2), +deficit.toFixed(3)]);

      if (deficit > maxDeficit) {
        maxDeficit = deficit;
        maxDeficitAtSec = wallSec;
      }
      // "Behind" means trailing by more than a quarter second — above ordinary
      // PCR emission jitter, below anything a viewer could notice.
      if (deficit > 0.25) {
        if (currentRunStart === null) currentRunStart = wallMs;
        const run = wallMs - currentRunStart;
        if (run > longestBehindMs) {
          longestBehindMs = run;
          worstRunStart = (currentRunStart - originWall) / 1000;
        }
      } else {
        currentRunStart = null;
      }
    }

    const mediaSeconds = unwrapped[unwrapped.length - 1][1] - originMedia;
    const wallSeconds = (unwrapped[unwrapped.length - 1][0] - originWall) / 1000;
    const finalDeficit = wallSeconds - mediaSeconds;

    return {
      ok: true,
      clockPid: pid,
      pcrSamples: samples.length,
      packets: this.packets,
      resyncs: this.resyncs,
      continuityErrors: this.continuityErrors.length,
      continuityDetail: this.continuityErrors.slice(0, 20),
      discontinuities: jumps.length,
      discontinuityDetail: jumps.slice(0, 20),
      /** Encoder seconds that arrived, between the first and last PCR. */
      mediaSeconds: +mediaSeconds.toFixed(3),
      /** Wall-clock seconds those PCRs spanned. */
      wallSeconds: +wallSeconds.toFixed(3),
      /** <1 means the feed delivered slower than real time over the window. */
      mediaPerWall: wallSeconds > 0 ? +(mediaSeconds / wallSeconds).toFixed(4) : null,
      /** How far media time ever fell behind the clock, and whether it repaid. */
      maxDeficitSec: +maxDeficit.toFixed(3),
      maxDeficitAtSec: +maxDeficitAtSec.toFixed(2),
      finalDeficitSec: +finalDeficit.toFixed(3),
      recovered: maxDeficit > 0.25 ? finalDeficit < maxDeficit * 0.5 : true,
      longestBehindSec: +(longestBehindMs / 1000).toFixed(2),
      longestBehindFromSec: worstRunStart === null ? null : +worstRunStart.toFixed(2),
      /** Full series, kept so this can be recomputed offline. */
      deficitSeries,
      /** Media time covered before the pull started counting, for reference. */
      totalElapsedMs: elapsedMs,
    };
  }
}

/**
 * The verdict this whole file exists to produce.
 *
 * Batching and starvation both look like silence followed by a burst in a byte
 * graph. They differ only in whether the media timeline catches back up.
 */
export function classifyDelivery(clock) {
  if (!clock?.ok) return { verdict: "NO MEDIA CLOCK", detail: clock?.reason || "not analysed" };

  if (clock.mediaSeconds < 1) {
    return { verdict: "NO MEDIA", detail: `only ${clock.mediaSeconds}s of media time arrived` };
  }

  // Sustained under-delivery: the thing the old metric was blind to.
  if (clock.mediaPerWall < 0.95 && clock.finalDeficitSec > 1) {
    return {
      verdict: "STARVING",
      detail:
        `media advanced ${clock.mediaPerWall}x real time and ended ${clock.finalDeficitSec}s behind ` +
        `(worst ${clock.maxDeficitSec}s at ${clock.maxDeficitAtSec}s) — a player drains here`,
    };
  }

  if (clock.discontinuities > 0) {
    return {
      verdict: "TIMELINE BREAKS",
      detail: `${clock.discontinuities} PCR discontinuit${clock.discontinuities === 1 ? "y" : "ies"} — content missing, not late`,
    };
  }

  if (clock.maxDeficitSec > 1.5) {
    return {
      verdict: clock.recovered ? "BATCHED BUT RECOVERS" : "FALLS BEHIND",
      detail:
        `fell ${clock.maxDeficitSec}s behind at ${clock.maxDeficitAtSec}s, ` +
        `${clock.recovered ? `repaid to ${clock.finalDeficitSec}s` : `still ${clock.finalDeficitSec}s behind at the end`} — ` +
        `a buffer of ${Math.ceil(clock.maxDeficitSec)}s or more covers this`,
    };
  }

  return {
    verdict: "KEEPS REAL TIME",
    detail: `media advanced ${clock.mediaPerWall}x real time, never more than ${clock.maxDeficitSec}s behind`,
  };
}
