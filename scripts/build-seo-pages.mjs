#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyHomepageSeoHtml } from "../lib/home-seo.js";
import { buildSeoPages } from "../lib/seo-pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TODAY_JSON = path.join(ROOT, "assets", "data", "today.json");
const TEAM_AR_JSON = path.join(ROOT, "assets", "data", "team-names-ar.json");
const HOME_HTML = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "generated", "seo");
const SITEMAP_SCHEDULE = path.join(ROOT, "sitemap-schedule.xml");
const SITEMAP_INDEX = path.join(ROOT, "sitemap.xml");
const REDIRECTS = path.join(ROOT, "_redirects");
const BEGIN = "# BEGIN generated SEO schedule routes";
const END = "# END generated SEO schedule routes";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeLegacyRoutes(text) {
  return String(text)
    .replace(/^\/live\s+\/tournament\s+301\s*$/m, "/live               /watch?ch=live              301")
    .replace(/^\/bein\s+\/tournament\s+301\s*$/m, "/bein               /watch?ch=live              301")
    .replace(/^\/vip\s+\/tournament\s+301\s*$/m, "/vip                /watch?ch=live              301");
}

function installRedirects(lines) {
  let text = normalizeLegacyRoutes(fs.readFileSync(REDIRECTS, "utf8"));
  const blockRe = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g");
  text = text.replace(blockRe, "");
  const block = `${BEGIN}\n${lines.join("\n")}\n${END}\n`;
  const marker = "# Dynamic splat rules";
  text = text.includes(marker) ? text.replace(marker, `${block}${marker}`) : `${text.trimEnd()}\n${block}`;
  fs.writeFileSync(REDIRECTS, text.endsWith("\n") ? text : `${text}\n`);
}

function installScheduleSitemap() {
  let text = fs.readFileSync(SITEMAP_INDEX, "utf8");
  text = text.replace(
    /\s*<sitemap>\s*<loc>https:\/\/korazero\.com\/sitemap-schedule\.xml<\/loc>[\s\S]*?<\/sitemap>\s*/g,
    "\n",
  );
  const entry = "  <sitemap>\n    <loc>https://korazero.com/sitemap-schedule.xml</loc>\n  </sitemap>\n";
  text = text.replace("</sitemapindex>", `${entry}</sitemapindex>`);
  fs.writeFileSync(SITEMAP_INDEX, text);
}

function installHomepageSeo() {
  if (!fs.existsSync(HOME_HTML)) return;
  const html = fs.readFileSync(HOME_HTML, "utf8");
  fs.writeFileSync(HOME_HTML, applyHomepageSeoHtml(html));
}

function main() {
  const payload = readJson(TODAY_JSON, { matches: [] });
  const teamNamesAr = readJson(TEAM_AR_JSON, {});
  const result = buildSeoPages(payload, { siteUrl: "https://korazero.com", teamNamesAr });

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const page of result.pages) {
    const relative = page.file.replace(/^\//, "");
    const destination = path.join(ROOT, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, page.html);
  }

  fs.writeFileSync(SITEMAP_SCHEDULE, result.sitemapXml);
  installRedirects(result.redirectLines);
  installScheduleSitemap();
  installHomepageSeo();

  console.log(
    `SEO pages: ${result.pages.length} pages for ${result.matchCount} matches -> ${path.relative(ROOT, OUT_DIR)}`,
  );
}

main();
