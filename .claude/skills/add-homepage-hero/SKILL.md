---
name: add-homepage-hero
description: Add one or more owner-approved homepage hero artworks to the KoraZero carousel without removing existing heroes, while preserving image quality, crawlability, SEO metadata, tests, CI, and production deployment. Use whenever the user asks to add, replace, rotate, or publish homepage hero/banner artwork.
---

# Add a homepage hero to KoraZero

This is the canonical procedure for adding homepage hero artwork to KoraZero/MorshLive.

Do not rediscover the carousel from scratch. Do not use a runtime image injector, data URI, base64-part loader, or ad-hoc JavaScript to make an image appear. Heroes are first-class static site assets and must be visible directly in the HTML source so browsers and crawlers can discover them.

The goal is simple:

1. preserve every existing hero unless the user explicitly asks to remove one;
2. add the owner's exact approved artwork as a real file;
3. add a real static `<img>` to `index.html`;
4. update the carousel math for the total slide count;
5. expose useful Arabic image metadata to search crawlers;
6. extend image integrity tests;
7. pass CI and Stream Lock;
8. merge and verify production.

## Read first

Before editing:

1. Read repo-root `AGENTS.md`.
2. Read the **Hero images** section in `AGENTS.md`.
3. Inspect the current homepage carousel in:
   - `index.html`
   - `assets/css/home-showdown.css` if present
   - the `.home-showdown*` rules in `assets/css/styles.css`
4. Inspect `tests/hero-images.test.js`.
5. Count the current hero images and record every filename before changing anything.
6. Work from current `main`, not a stale branch.

Never skip repository instructions in favor of this skill. This skill is the hero-specific layer on top of them.

## Architecture invariant

Homepage hero artwork must follow this path:

| Surface | File | Requirement |
| --- | --- | --- |
| Binary asset | `assets/img/<hero>.jpg` | Real image file in the repo |
| Homepage markup | `index.html` | Static `<img>` with real width/height and descriptive alt text |
| Carousel layout | `assets/css/home-showdown.css` or existing hero CSS | Width/flex/keyframes match the total number of slides |
| Structured image metadata | `index.html` → `#seo-schema` | `ImageObject` for important campaign heroes |
| Image discovery | `sitemap-core.xml` | Homepage image entries for important campaign heroes |
| Integrity tests | `tests/hero-images.test.js` | File decodes, is complete, keeps native dimensions, and remains wired |

A hero is not complete if only one or two of these surfaces are updated.

## Non-negotiable preservation rule

Before making the change, write down the current hero filenames.

After making the change, every one of those filenames must still be present in the carousel unless the user explicitly asked for removal or replacement.

For an add-only request:

```text
before = N heroes
after  = N + number_of_new_heroes
```

Do not silently push out the oldest slide.

Do not replace the existing Saudi or Europe hero just because a new campaign is more current.

## Phase 1 — establish the approved source artwork

Use the exact user-approved artwork.

If the user supplied or approved an image in the conversation, that is the source of truth.

Do not:

- regenerate it;
- change its composition;
- crop it;
- resize it;
- retype its Arabic;
- remove its logo;
- “clean it up”;
- replace it with a visually similar version.

If conversion to JPEG is required, follow the repo-root Hero images rules exactly: native dimensions, one pass, JPEG quality 95, 4:4:4 chroma (`subsampling=0`), no resize.

Existing hero files must never be re-encoded merely because another hero is being added.

## Phase 2 — store the image as a real repository asset

Preferred path:

```text
assets/img/korazero-<campaign-slug>.jpg
```

Use a stable ASCII filename even when the artwork text is Arabic.

Examples:

```text
assets/img/korazero-khaleeji27.jpg
assets/img/korazero-nations-league-2026.jpg
```

The image must be a real Git blob/file.

### Forbidden shortcuts

Never ship a homepage hero as:

- `data:image/...;base64,...`;
- `.b64` chunks fetched by JavaScript;
- an image reconstructed in the browser;
- a temporary Adobe/ChatGPT/CDN URL;
- a runtime DOM injector;
- a JS file whose only purpose is to insert the hero;
- an external hotlink when the approved bytes can live in the repo.

These make caching, crawling, testing, and rollback behavior worse and were the cause of a previous half-wired implementation.

### If the agent's GitHub tool is text-oriented

Use a binary-capable path:

1. obtain the approved image bytes;
2. base64-encode those bytes without altering the image;
3. create a Git blob using base64 encoding;
4. add that blob to the branch tree at `assets/img/<name>.jpg`.

Do not solve a binary-tool limitation by moving the image into JavaScript.

## Phase 3 — verify native image dimensions before markup

Decode the full image, not just its header.

Example:

```bash
python3 - <<'PY'
from PIL import Image
p = "assets/img/korazero-example.jpg"
im = Image.open(p)
im.load()
print(im.size, im.mode)
PY
```

Record:

- width;
- height;
- byte size;
- successful full-frame decode.

The `width` and `height` attributes in HTML and tests must match the real file.

Never edit expected dimensions to match an accidentally shrunk file.

## Phase 4 — add static HTML, exactly like the existing Saudi hero

The hero belongs directly inside:

```html
<div class="home-showdown-track">
  ...
</div>
```

Normal shape:

```html
<img
  src="assets/img/korazero-example.jpg?v=YYYYMMDDhero"
  width="<REAL_WIDTH>"
  height="<REAL_HEIGHT>"
  alt="<natural descriptive Arabic text>"
  decoding="async"
/>
```

Use `fetchpriority="high"` on only the first/initial hero unless current markup intentionally does otherwise.

When a new hero becomes first, move the high priority to that hero and remove it from the old first image.

### Alt text

Alt text should describe the campaign naturally and include the main Arabic entity users might search for.

Good:

```text
خليجي 27 — كأس الخليج العربي في جدة 2026 | كورة زيرو
```

Bad:

```text
hero image
football banner
image 1
```

Do not keyword-stuff the alt attribute.

## Phase 5 — recalculate carousel CSS from the total slide count

Let total slides after the change be `N`.

The basic layout invariant is:

```text
track width  = N × 100%
slide flex   = 100 / N %
slide width  = 100 / N %
```

For four slides:

```css
.home-showdown-track {
  width: 400%;
}
.home-showdown-track img {
  flex: 0 0 25%;
  width: 25%;
}
```

For five slides:

```text
width: 500%
each slide: 20%
```

Do not leave old two-slide or three-slide percentages in place.

### Animation

Preserve the existing behavior: approximately four seconds held on each poster and approximately one second sliding to the next.

For four slides, the known-good pattern is:

```css
.home-showdown-track {
  animation: home-showdown-slide 20s ease-in-out infinite;
}

@keyframes home-showdown-slide {
  0%, 20% { transform: translateX(0); }
  25%, 45% { transform: translateX(-25%); }
  50%, 70% { transform: translateX(-50%); }
  75%, 95% { transform: translateX(-75%); }
  100% { transform: translateX(0); }
}
```

If `N` changes, calculate equivalent stops rather than copying four-slide numbers blindly.

Keep:

```css
@media (prefers-reduced-motion: reduce) {
  .home-showdown-track { animation: none; }
}
```

## Phase 6 — make the image crawler-visible

The static `<img>` is the first and most important crawler signal.

For an important tournament/campaign hero, also add an `ImageObject` to the existing `#seo-schema` graph in `index.html`.

Example:

```json
{
  "@type": "ImageObject",
  "name": "خليجي 27 — كأس الخليج العربي | كورة زيرو",
  "description": "صورة كورة زيرو لبطولة خليجي 27 وكأس الخليج العربي في جدة 2026.",
  "contentUrl": "https://korazero.com/assets/img/korazero-khaleeji27.jpg",
  "url": "https://korazero.com/assets/img/korazero-khaleeji27.jpg",
  "encodingFormat": "image/jpeg",
  "width": 1536,
  "height": 864,
  "inLanguage": "ar"
}
```

Use the real production image URL and dimensions.

### Image sitemap

For important campaign heroes, `sitemap-core.xml` should expose image discovery on the homepage.

The root `urlset` must include the image namespace:

```xml
xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
```

Then add under the homepage `<url>`:

```xml
<image:image>
  <image:loc>https://korazero.com/assets/img/korazero-khaleeji27.jpg</image:loc>
  <image:title>خليجي 27 — كأس الخليج العربي | كورة زيرو</image:title>
  <image:caption>خليجي 27 وكأس الخليج العربي في جدة 2026 على كورة زيرو</image:caption>
</image:image>
```

Do not create a separate crawl-only page merely to expose the image.

Do not hide the only useful tournament wording inside JavaScript.

## Phase 7 — update hero integrity tests

Every homepage hero must be listed in `tests/hero-images.test.js` with its real dimensions.

Example:

```js
const HEROES = [
  { file: "assets/img/korazero-khaleeji27.jpg", width: 1536, height: 864 },
  { file: "assets/img/korazero-nations-league-2026.jpg", width: 1536, height: 864 },
  { file: "assets/img/korazero-saudi.jpg", width: 1672, height: 941 },
  { file: "assets/img/korazero-showdown.jpg", width: 1374, height: 768 },
];
```

The tests must continue to prove:

- JPEG has a valid frame;
- JPEG has a complete end-of-image marker;
- file is not crushed into a thumbnail;
- dimensions equal the expected native dimensions;
- `index.html` declares those same dimensions.

Also keep/add a carousel preservation assertion containing every hero filename and the expected track/slide percentage for the current count.

Example for four:

```js
expect(html).toContain("korazero-khaleeji27.jpg");
expect(html).toContain("korazero-nations-league-2026.jpg");
expect(html).toContain("korazero-saudi.jpg");
expect(html).toContain("korazero-showdown.jpg");
expect(css).toMatch(/width: 400%/);
expect(css).toMatch(/flex: 0 0 25%/);
```

Do not weaken the test when a file fails. Fix the asset or markup.

## Phase 8 — remove obsolete hero hacks

If the branch or repo contains a temporary hero injector created for the same campaign, remove it once static HTML is in place.

Examples to remove:

```text
assets/js/khaleeji-hero.js
khaleeji27-part0.b64
khaleeji27-part1.b64
...
runtime script injection from match-status.js
```

Do not leave two code paths that can both insert the same slide.

After cleanup, search for the campaign filename and old injector name to prove there is only one rendering path.

## Phase 9 — verification matrix

All applicable rows must pass.

| Gate | Evidence | PASS | FAIL |
| --- | --- | --- | --- |
| Existing hero preservation | compare before/after filenames | all pre-existing heroes still present | any old hero disappeared without explicit request |
| Binary asset | repo tree | real file exists under `assets/img/` | data URI, JS reconstruction, temporary CDN only |
| Full decode | Pillow/`im.load()` | image fully decodes | truncated/corrupt |
| Native dimensions | file + HTML + test | exact match | resized or stale markup |
| Static crawl path | `index.html` source | direct `<img src=...>` | injected only after JS |
| Alt text | HTML | useful natural Arabic | generic/empty/keyword spam |
| Structured data | `#seo-schema` | correct `ImageObject` for important campaign | missing/wrong URL/dimensions |
| Image sitemap | `sitemap-core.xml` | correct image loc/title/caption | omitted or temporary URL |
| Carousel math | CSS | percentages match total slide count | clipping/blank slide/wrong offset |
| Integrity test | `tests/hero-images.test.js` | all heroes covered | new hero unguarded |
| Lint | `npm run lint` | exit 0 | any error |
| Tests | `npm test` | exit 0 | any regression |
| Stream safety | `npm run verify:stream-lock` | exit 0 | unrelated playback change |
| CI | GitHub CI + Stream Lock | green | pending/failed/cancelled |
| Production | live homepage + image URL | new markup/file served | merge exists but live site remains old |

There is no “mostly done.” A required failed gate means the change is incomplete.

## Phase 10 — diff review

A normal add-only hero change should usually be limited to:

```text
assets/img/<new-hero>.jpg
index.html
assets/css/home-showdown.css
sitemap-core.xml
tests/hero-images.test.js
```

If cleaning a previous workaround, it may also delete the obsolete injector and remove its one hook from another file.

Unexpected changes to match routing, stream code, fixture data, or backend services are a red flag.

Do not mix a hero campaign with unrelated streaming fixes.

## Phase 11 — PR, CI, merge

Follow the root Git workflow.

1. Branch from latest `main`.
2. Add the exact approved binary assets.
3. Make the focused markup/CSS/SEO/test changes.
4. Run verification.
5. Open a focused PR.
6. Wait for GitHub CI and Stream Lock.
7. Inspect failures instead of bypassing them.
8. When the requested work is complete and checks are green, merge the PR.

The PR body should explicitly state:

- new hero filenames and native dimensions;
- total slide count after change;
- names of preserved existing heroes;
- whether any old hero was removed;
- crawler/SEO surfaces added;
- test results;
- whether any runtime injector was removed.

## Phase 12 — production verification

After merge, do not assume production updated.

Verify:

```bash
curl -fsS https://korazero.com/ | grep -E "korazero-.*\.jpg"
curl -I https://korazero.com/assets/img/<new-hero>.jpg
```

Confirm:

1. live homepage contains the new static `<img>`;
2. every expected existing hero is still present;
3. new image returns a successful response;
4. the current versioned CSS is live;
5. the carousel has no blank frame or missing slide.

If production is still old, follow the root `AGENTS.md` production-freshness procedure and deploy. Do not report success from a branch preview alone.

## Common failure modes

### “I added the image but one old hero disappeared”

The carousel was treated as replacement rather than append-only. Restore the missing hero and recalculate CSS for the true slide count.

### “The image exists but Google cannot really see what it is”

Check, in order:

1. direct static `<img>` in `index.html`;
2. useful Arabic alt text;
3. public first-party image URL;
4. `ImageObject`;
5. image sitemap entry.

Do not compensate with keyword stuffing.

### “The branch has CSS for the new slide but the image is blank”

Check whether the actual JPEG exists in `assets/img`. A previous implementation wired a hero before its binary bytes were ever committed.

### “My GitHub tool cannot upload binary images”

Create a base64 Git blob and put it in the tree. Do not create a browser-side base64 loader.

### “The image looked good in chat but is blurry on the site”

Check the committed pixel dimensions and byte size. Do not resize or re-encode the user-approved source.

### “CI fails on an unrelated lint issue”

Inspect whether the branch introduced the issue. Fix only what is needed for the branch to become green; do not disable lint. If a stale temporary hero hook is causing it, remove the hook.

### “The image is in the DOM only after JavaScript runs”

That is the wrong architecture for homepage hero artwork. Move it into static `index.html`.

### “The hero works in preview, so the task is done”

No. Merge with green checks, then verify live production.

## Current known-good example

As of the Gulf Cup + Nations League change, KoraZero uses four static homepage heroes:

```text
assets/img/korazero-khaleeji27.jpg
assets/img/korazero-nations-league-2026.jpg
assets/img/korazero-saudi.jpg
assets/img/korazero-showdown.jpg
```

Known-good four-slide CSS:

```text
track width: 400%
each slide: 25%
cycle: 20s
```

Do not treat this count as permanent. Always recount the current `index.html` before editing.

## Definition of done

A homepage hero addition is **PASS** only when every applicable statement is true:

- [ ] current `AGENTS.md` was read;
- [ ] current hero filenames were recorded before editing;
- [ ] user's exact approved source artwork was used;
- [ ] image exists as a real repo asset;
- [ ] full image decodes successfully;
- [ ] native dimensions were preserved;
- [ ] every pre-existing hero remains unless removal was explicitly requested;
- [ ] new hero is a static `<img>` in `index.html`;
- [ ] real width/height attributes are present;
- [ ] cache-busting `?v=` was set/bumped;
- [ ] only the initial slide has high fetch priority unless intentionally changed;
- [ ] carousel width/flex/keyframes match the total slide count;
- [ ] descriptive Arabic alt text is present;
- [ ] important campaign image has an `ImageObject`;
- [ ] important campaign image is exposed in `sitemap-core.xml`;
- [ ] `tests/hero-images.test.js` covers the new hero;
- [ ] obsolete runtime injection/base64 hacks for the campaign are removed;
- [ ] lint passes;
- [ ] tests pass;
- [ ] Stream Lock passes;
- [ ] GitHub CI is green;
- [ ] PR is merged;
- [ ] live production homepage and direct image URL are verified.

If any required box is false, report the task as incomplete rather than saying the hero was published.

## Final report format

Keep the user-facing report concise:

```text
Added: <hero campaign(s)>
Assets: <filenames + dimensions>
Carousel: <N> total; existing heroes preserved
SEO: static img + Arabic alt + ImageObject + image sitemap
Tests: hero integrity PASS; lint PASS; tests PASS; Stream Lock PASS
Merged: PR #<n>, <merge SHA>
Production: <verified / exact blocker>
```

Do not claim a check passed unless it was actually run.
