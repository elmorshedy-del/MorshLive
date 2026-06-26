# Cloud Agent rules (MorshLive / KoraZero)

**Mandatory workflow for every code change.** Do not skip steps.

## 1. Branch and PR first — never push straight to `main`

- Create branch: `cursor/<short-description>-5da7`
- Commit focused changes
- **Open a pull request to `main`**
- **Stop — do not merge yet**

## 2. Gemini Code Assist review — MANDATORY POLL

This repo uses [Gemini Code Assist on GitHub](https://github.com/marketplace/gemini-code-assist).

### You MUST run this before every merge

```bash
node scripts/poll-gemini-review.js <PR_NUMBER>
```

- Polls every **30s** (configurable: `--interval=30`)
- **Always stops** after **10 minutes** max (`--max-wait=600`) — exit 1 if Gemini never finishes
- **Exit 0** = `gemini-code-assist[bot]` posted `## Code Review` → safe to proceed
- **Exit 1** = timed out or no review — do **not** merge until resolved or self-review fallback (section 4)
- Open PRs as **ready for review** (not draft) — Gemini workflows skip draft PRs
- Invalid `GITHUB_TOKEN` in the environment is ignored; the script falls back to the public GitHub API

### Forbidden

- **Merging in the same agent turn as PR creation** without a successful poll
- **Merging before** `gemini-code-assist[bot]` finishes (summary-only “reviewing shortly” is NOT enough)
- **Fast-forwarding to `main`** without a PR

### After poll succeeds

1. Read **all** inline review comments and the summary
2. Fix **MEDIUM** severity and above (and clear LOW bugs)
3. Push fixes to the **same PR branch**
4. **Run `poll-gemini-review.js` again** after every fix push
5. Only then merge

If Gemini times out after 10 minutes, comment `/gemini review` on the PR, poll again.  
If still unavailable, run section 4 self-review, note that in the PR body, then merge.

## 3. Merge only after poll + fixes

Merge the PR to `main` **only when**:

- `node scripts/poll-gemini-review.js <PR#>` exited **0**, and
- Gemini feedback is addressed (or explicitly declined with reason in PR), and
- CI is green (including **Gemini review gate** if enabled on the repo)

After merge, confirm Cloudflare Worker `morshlive` deploy if the change affects the live site.

## 4. Agent self-review checklist (Gemini timeout fallback only)

- [ ] No secrets in tracked files
- [ ] Stream routing: `EMBED_BINDING` / `channel-bindings.json` consistent
- [ ] Player 1 and Player 2 VIP use the same `channel.embed` URL for a channel
- [ ] `resolveWatchSelection`: explicit `?match=` always wins
- [ ] Embed iframe: no hardcoded `vip1` for Player 2
- [ ] Operator precedence in boolean conditions (especially embed-row checks)
- [ ] Cache-bust query strings bumped when JS/CSS changes

## 5. Deploy

- Production: Cloudflare Worker **`morshlive`**
- Custom domain: `korazero.com` → Worker (not stale Pages `korazero`)

## 6. User communication

- Do not ask the user to merge or poll Gemini — that is **your** job
- Report: PR link, poll wait time, what Gemini found, what you fixed
