# Cloud Agent rules (MorshLive / KoraZero)

**Mandatory workflow for every code change.** Do not skip steps.

## 1. Branch and PR first — never push straight to `main`

- Create branch: `cursor/<short-description>-5da7`
- Commit focused changes
- **Open a pull request to `main` before considering the task done**
- Do **not** fast-forward merge locally to `main` and push without a PR

## 2. Gemini Code Assist review (required)

This repo uses [Gemini Code Assist on GitHub](https://github.com/marketplace/gemini-code-assist).

On every PR:

1. Wait for `gemini-code-assist[bot]` to post a review (auto-triggered via `.gemini/config.yaml`)
2. If no review after ~3 minutes, comment on the PR: `/gemini review`
3. Read **all** inline comments and the summary
4. Fix **MEDIUM** severity and above (and any LOW issues that are clearly bugs)
5. Push fixes to the **same PR branch** — do not open a duplicate PR
6. Wait for Gemini to re-review or comment `/gemini review` again after pushes

If Gemini is unavailable, run an equivalent review yourself (Bugbot checklist in section 4) and note that in the PR body.

## 3. Merge only after review

- Merge the PR to `main` **only when**:
  - Gemini feedback is addressed (or explicitly declined with reason in PR), **and**
  - Build/deploy sanity checks pass
- After merge, confirm deploy (Cloudflare Worker `morshlive`) if the change affects the live site

## 4. Agent self-review checklist (when Gemini has not responded)

- [ ] No secrets in tracked files
- [ ] Stream routing: `EMBED_BINDING` / `channel-bindings.json` consistent
- [ ] Player 1 and Player 2 VIP use the same `channel.embed` URL for a channel
- [ ] `resolveWatchSelection`: explicit `?match=` always wins
- [ ] Embed iframe: no hardcoded `vip1` for Player 2
- [ ] Operator precedence in boolean conditions (especially embed-row checks)
- [ ] Cache-bust query strings bumped when JS/CSS changes

## 5. Deploy

- Production: Cloudflare Worker **`morshlive`** (not stale Pages `korazero`)
- Custom domain: `korazero.com` → Worker, not Pages
- Do not ask the user to run terminal commands — use PR + merge + Cloudflare Git deploy

## 6. User communication

- Do not tell the user to merge or run review steps that are **your** job
- Summarize what Gemini found and what you fixed
- Link the PR number
