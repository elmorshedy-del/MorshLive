# KoraZero design system (Open Design)

Bundled design system for [KoraZero](https://korazero.com) — Arabic-first live football streaming.

## Files

| File | Role |
|------|------|
| `DESIGN.md` | Brand contract (9-section Open Design schema) |
| `tokens.css` | Machine-readable tokens — paste `:root` into artifacts |
| `components.html` | Reference fixture (hero intro, match card, buttons) |
| `manifest.json` | OD design-system-project manifest |

## With Open Design installed

```bash
npm run open-design:install   # init submodule + register korazero in vendor catalog
```

Then in Open Design desktop or `od` CLI, pick design system **KoraZero** when generating UI.

Vendor repo: `vendor/open-design` (git submodule).

## Site integration

Production CSS imports tokens via `assets/css/styles.css`:

```css
@import url("../../design-systems/korazero/tokens.css");
```

Preview components locally: open `design-systems/korazero/components.html` in a browser.
