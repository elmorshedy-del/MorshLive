# Design systems (Open Design)

This repo uses [Open Design](https://github.com/nexu-io/open-design) as the design toolchain and token contract.

| Path | Purpose |
|------|---------|
| `vendor/open-design/` | Full Open Design repo (git submodule) |
| `design-systems/korazero/` | KoraZero brand system — used by the live site |
| `open-design.project.json` | Project wiring for agents / `od` CLI |

## Setup

```bash
npm run open-design:install
```

This initializes the submodule, registers `korazero` inside the vendor catalog, and prints next steps.

## Run Open Design locally (optional)

```bash
cd vendor/open-design
corepack enable
pnpm install
pnpm tools-dev run web
```

Requires Node ~24 and pnpm 10.33.x per upstream.

## Site CSS

`assets/css/styles.css` imports `design-systems/korazero/tokens.css`.  
Preview: open `design-systems/korazero/components.html`.
