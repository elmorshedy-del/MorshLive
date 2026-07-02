/* RETIRED. The worldkoora vip1/vip2 embed-binding + per-kickoff "calibration"
 * system is gone. Channel→stream binding is now deterministic in
 * assets/js/data.js (each beIN channel → a stable dlhd id), so there is nothing
 * to sync here. This file is kept only so existing <script> includes 404-free;
 * it intentionally defines no bindings. Safe to delete once the includes are
 * removed from index.html / watch.html / watch-embed.html. */
window.KZ_CHANNEL_BINDINGS = { version: 0, retired: true };
