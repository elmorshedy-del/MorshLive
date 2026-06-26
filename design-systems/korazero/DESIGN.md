# KoraZero Design System

> Category: Sports Streaming
> Arabic-first live football portal. Dark cinematic canvas, beIN-adjacent purple, live green pulse, zero ad clutter.

Inspired by the [Open Design](https://github.com/nexu-io/open-design) `DESIGN.md` contract — agents and contributors should read this before changing UI.

## 1. Visual Theme & Atmosphere

Dark stadium-night aesthetic: deep navy canvas (`#0a0e17`), soft purple/magenta glow, emerald live accents. Feels premium broadcast, not pirate popup. RTL default; LTR for English. No stock-photo hero — typography and match cards carry the page.

## 2. Color

| Token | Value | Use |
|-------|-------|-----|
| `--kz-bg` | `#0a0e17` | Page background |
| `--kz-brand` | `#7b2ff7` | Primary actions, gradients |
| `--kz-accent` | `#18e29a` | Live state, success, TV focus ring |
| `--kz-gold` | `#ffc94d` | Scores, WC emphasis |
| `--kz-danger` | `#ff3b5c` | Live dot, urgent |
| `--kz-text` | `#e8edf5` | Body |
| `--kz-muted` | `#93a1bd` | Secondary copy, SEO intro |

Gradients: `135deg` brand → magenta for CTAs. Avoid flat pure black.

## 3. Typography

- **Arabic:** Tajawal 400–800
- **Latin logo / EN headings:** Space Grotesk 500–700
- **H1:** clamp 1.9–3.4rem, weight 900, tight line-height 1.16
- **SEO intro / lede:** 1.05–1.12rem, muted, max-width ~42rem
- **Eyebrow / labels:** 0.82rem, uppercase tracking, accent color

Never stack more than three font sizes in one hero block.

## 4. Spacing & Layout

- Container: `min(1200px, 92%)`
- Section padding: 34px vertical
- Card radius: 14px; pills 999px
- Hero intro card: 20–24px padding, 12px internal gap

## 5. Components

- **Hero intro card:** glass surface, 1px border, 4px gradient accent bar (inline-start)
- **Keyword chips:** subtle pills for SEO terms — not loud badges
- **Match cards:** crest + score + commentator + channel row
- **TV spotlight:** split grid, mock TV + remote hint
- **CTAs:** primary gradient button; ghost secondary

## 6. Motion

- Entrance: fadeUp 0.7s ease
- Live dot: pulse ring 1.6s
- Hover cards: translateY(-5px), no bounce
- `prefers-reduced-motion`: disable decorative motion

## 7. Voice & Content (Arabic)

- Lead with **بث مباشر مباريات اليوم** and **كورة أون لاين**
- Mention World Cup 2026 / مونديال 2026 naturally once per block
- Position as clean alternative: بدون إعلانات — avoid aggressive competitor bashing in UI body
- Commentator + beIN MAX channel per match is a trust signal

## 8. Brand

- **Name:** KoraZero / كورة زيرو
- **Domain:** korazero.com
- **Promise:** HD live streams, no ads, no pop-ups, no buffering
- Logo: KoraZero wordmark with ball-as-o

## 9. Anti-patterns

- Icon-only controls without label on mobile (TV, lang)
- Keyword stuffing visible as repeated paragraphs
- Light theme (breaks brand)
- Popup/modal ads patterns
- Shrinking H1 below readable size on mobile for SEO
