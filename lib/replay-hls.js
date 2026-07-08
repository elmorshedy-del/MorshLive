/** Pure HLS URL helpers for replay proxy — shared by worker + tests. */

export function resolveStreamUrl(relative, base) {
  try {
    const abs = new URL(relative, base);
    const baseUrl = new URL(base);
    if (baseUrl.search && !abs.search) {
      for (const [key, value] of baseUrl.searchParams.entries()) {
        abs.searchParams.set(key, value);
      }
    }
    return abs.toString();
  } catch {
    return relative;
  }
}

export function replayShouldProxyAsset(abs, origin, vortexHost = "nvtboo.vortexvisionworks.com") {
  if (!/^https?:\/\//i.test(abs)) return false;
  try {
    const host = new URL(abs).hostname;
    if (/flashframenetwork\.com$/i.test(host)) return true;
    if (host === vortexHost) return true;
    return new URL(abs).origin !== origin;
  } catch {
    return false;
  }
}

export function rewriteReplayM3u8(body, manifestUrl, origin, proxyUrlFn) {
  const lines = String(body || "").split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/gi, (all, uri) => {
          const abs = resolveStreamUrl(uri, manifestUrl);
          if (!replayShouldProxyAsset(abs, origin)) return all;
          return `URI="${proxyUrlFn(abs)}"`;
        });
      }
      const abs = resolveStreamUrl(trimmed, manifestUrl);
      if (!replayShouldProxyAsset(abs, origin)) return trimmed;
      return proxyUrlFn(abs);
    })
    .join("\n");
}
