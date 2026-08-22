/**
 * Build a go4score / KoraPlus frame.php URL from match metadata.
 * Token and kt stay ephemeral — the worker mints them per request.
 */

export function pickGo4scoreChannel(channels = []) {
  if (!Array.isArray(channels) || !channels.length) return null;
  return (
    channels.find((channel) => String(channel.ch || channel.key || "").toLowerCase() === "b1") || channels[0]
  );
}

export function chooseGo4scoreEdge(edges = [], random = Math.random) {
  const list = (Array.isArray(edges) ? edges : []).map(String).filter(Boolean);
  if (!list.length) return "";
  return list[Math.floor(random() * list.length)] || "";
}

export function go4scoreFrameUrl({
  edges = [],
  edgeDomain = "",
  fallbackHost = "a11.kora-plus.li",
  channel = "b1",
  token = "",
  kt = "",
  p = 12,
  edge = "",
} = {}) {
  const chosen = String(edge || chooseGo4scoreEdge(edges, () => 0) || "").replace(/[^a-z0-9-]/gi, "");
  const domain = String(edgeDomain || "")
    .replace(/^\.+/, "")
    .replace(/[^a-z0-9.-]/gi, "");
  const host = chosen && domain ? `${chosen}.${domain}` : fallbackHost;
  const url = new URL(`https://${host}/frame.php`);
  url.searchParams.set("ch", String(channel || "b1"));
  url.searchParams.set("p", String(p));
  if (token) url.searchParams.set("token", String(token));
  if (kt) url.searchParams.set("kt", String(kt));
  return url.toString();
}
