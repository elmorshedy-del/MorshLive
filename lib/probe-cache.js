/**
 * TTL cache with single-flight.
 *
 * Built for the Xtream source probe. A probe opens a real `/live/...` request
 * against the panel, and a lab line is provisioned with `max_connections: 1`.
 * Two callers probing the same channel at the same moment is enough to take
 * the only slot away from the player that is trying to stream it — the panel
 * then closes the player's connection and holds the slot as a ghost session
 * for up to a minute. Collapsing concurrent probes into one upstream request,
 * and reusing the answer for a while, keeps that from happening twice over.
 */
export function createTtlSingleFlight({ ttlMs = 60_000, now = () => Date.now() } = {}) {
  const values = new Map();
  const inflight = new Map();

  return {
    async run(key, factory) {
      const cached = values.get(key);
      if (cached && now() - cached.at < ttlMs) return cached.value;

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = (async () => factory())();
      inflight.set(key, promise);
      try {
        const value = await promise;
        values.set(key, { at: now(), value });
        return value;
      } finally {
        inflight.delete(key);
      }
    },

    /** Test/ops seam: drop everything so the next call re-probes. */
    clear() {
      values.clear();
      inflight.clear();
    },
  };
}
