# Cloud Agent rules (MorshLive / KoraZero)

**Mandatory workflow for every code change.** Do not skip steps.

## 1. Branch and PR first — never push straight to `main`

- Create branch: `cursor/<short-description>-5da7`
- Commit focused changes
- **Open a pull request to `main`**
- **Stop — do not merge yet**

## 2. Quality checks

```bash
npm run lint && npm test
```

Both must pass before merge. Open PRs as ready for review once checks are green.

### Forbidden

- **Merging in the same agent turn as PR creation** without green CI
- **Fast-forwarding to `main`** without a PR

## 3. Merge only after CI + self-review

Merge the PR to `main` **only when**:

- `npm run lint && npm test` pass locally and the **CI / quality** check is green
- The self-review checklist below is done

After merge, confirm deploy: Cloudflare Workers Builds on `main`, or run `npm run deploy`.

## 4. Agent self-review checklist

- [ ] No secrets in tracked files
- [ ] Stream routing: `EMBED_BINDING` / `channel-bindings.json` consistent
- [ ] Player 1 and Player 2 VIP use the same `channel.embed` URL for a channel
- [ ] `resolveWatchSelection`: explicit `?match=` always wins
- [ ] Embed iframe: no hardcoded `vip1` for Player 2
- [ ] Operator precedence in boolean conditions (especially embed-row checks)
- [ ] Cache-bust query strings bumped when JS/CSS changes

## 5. Deploy

- Production: merge to `main` → **Cloudflare Workers Builds** (not GitHub Actions — see `docs/DEPLOY.md`)
- Manual / agent: `npm run deploy` with `.env` Cloudflare token
- Custom domain: `korazero.com` → Worker `morshlive`

## 6. User communication

- Do not ask the user to merge — that is **your** job when the checks above are green
- Report: PR link, what you changed, and what you verified
