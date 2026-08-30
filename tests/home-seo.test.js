import { describe, expect, it } from "vitest";
import { applyHomepageSeoHtml, ORGANIZATION_ALIASES } from "../lib/home-seo.js";

const source = `<!doctype html><html><head><script type="application/ld+json" id="seo-schema">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"KoraZero","alternateName":"كورة زيرو","sameAs":["https://www.facebook.com/example"]}]}</script></head><body><main><h1>KoraZero</h1></main></body></html>`;

describe("homepage SEO build polish", () => {
  it("writes the requested Organization alternate names while preserving known social profiles", () => {
    const html = applyHomepageSeoHtml(source);
    const raw = html.match(/<script type="application\/ld\+json" id="seo-schema">([\s\S]*?)<\/script>/)?.[1];
    const schema = JSON.parse(raw);
    const org = schema["@graph"].find((node) => node["@type"] === "Organization");
    expect(org.alternateName).toEqual([...ORGANIZATION_ALIASES]);
    expect(org.sameAs).toEqual(["https://www.facebook.com/example"]);
  });

  it("adds static paths from the homepage to current matches and the result archive", () => {
    const html = applyHomepageSeoHtml(source);
    expect(html).toContain('href="/matches"');
    expect(html).toContain('href="/matches/archive"');
    expect(html).toContain('href="/league/premier-league"');
    expect(applyHomepageSeoHtml(html)).toBe(html);
  });
});
