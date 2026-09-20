# Handoff notes — read this before touching the code

Written 2026-09-21 after a full build-and-debug session with Claude Code. This
file exists so a different AI tool (ChatGPT, Codex, another Claude session,
or a human) can pick this project up with zero prior context. It captures
things that are **not obvious from reading the code alone**, especially
values that look arbitrary but were tuned against real production failures.

Full narrative + test results + cost estimate are in a shared doc:
**https://claude.ai/artifact/EQ8B3hxEJqVG3fFcfN2sZ6** (Claude account login
required — same account that built this). Read it if you want the full story;
this file is the condensed "don't repeat these mistakes" version.

## What this is

A Next.js 14 App Router service that answers Hostatom customer questions on
LINE using Gemini, grounded strictly in a Google Sheet FAQ (no hallucinated
prices/policies allowed). Built as a **Proof of Concept**, not yet handling
real customer traffic. See `README.md`'s original brief if present in chat
history — the short version: webhook at `/api/line-webhook`, FAQ fetched from
`SHEET_CSV_URL` (published CSV), Gemini model is `gemini-3.5-flash` and that
choice is locked by the original spec, not up for casual swapping.

## Where things live (none of this is tied to one computer)

- **Code**: this GitHub repo, `main` branch. Vercel auto-deploys on push.
- **Deployment**: Vercel project `line-ai-chatbot`, prod domain
  `line-ai-chatbot-alpha.vercel.app`.
- **FAQ data**: a Google Sheet, published as CSV at the URL in
  `SHEET_CSV_URL`. Edits there go live within 60s (cache TTL), no redeploy
  needed.
- **Secrets**: `.env.local` is git-ignored and NEVER committed. On a new
  machine you must recreate it with 4 values (see below) and also add them
  to Vercel → Settings → Environment Variables (Production **and** Preview).

```
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
GEMINI_API_KEY=
SHEET_CSV_URL=
```

If you don't have these saved in a password manager, regenerate them:
LINE token/secret from LINE Developers Console → Messaging API tab; Gemini
key from https://aistudio.google.com/apikey; the Sheet URL from the Sheet's
File → Share → Publish to web (CSV) dialog.

## Non-obvious decisions — do not "fix" these back to naive values

| In the code | Value | Why it's NOT a mistake |
| --- | --- | --- |
| `lib/constants.ts` `SHEET_CSV_URL` var name | must match exactly | An earlier deploy broke because Vercel had it saved as `GOOGLE_SHEET_CSV_URL` instead. Any env var mismatch here fails silently into `DEFAULT_REPLY` for everything. |
| `GEMINI_THINKING_BUDGET = 512` | caps Gemini's internal "thinking" tokens | Without this, Gemini 3.5 Flash spent 900+ of its 1024 output-token budget "thinking" and got cut off (`MAX_TOKENS`) before writing an actual answer, truncating replies mid-sentence. |
| `GEMINI_TIMEOUT_MS = 25_000` | 25 seconds | Real measured Gemini latency for this model is ~7-8s warm, ~13-15s cold — nowhere near the "1-4s" the original brief assumed. 7s and 8.5s were both tried and both timed out in production logs. |
| `export const maxDuration = 30` in `route.ts` | 30s | Vercel Functions (all plans, Fluid Compute) default to a 300s max duration as of the docs checked this session — NOT the 10s the original brief assumed for Hobby plan. Don't shrink this back down without re-checking. |
| `<greeting_handling>` block in `lib/gemini.ts`'s `buildPrompt()` | added | Without it, the strict "only answer from FAQ" rule made the bot respond to a plain "สวัสดี" (hello) with the FAQ-miss default message, which reads badly in a demo. This carve-out only applies to greetings/thanks, not to service questions. |
| `DEFAULT_REPLY` in `constants.ts` | generic text, no phone number | Deliberately changed to remove Hostatom's real phone number since this is a test project, not a live support channel. `lib/gemini.ts` interpolates this constant into the system prompt — **only edit it in one place**, never hardcode the string elsewhere. |

## The one thing that will bite you again: Gemini free-tier quota

The Gemini API key used during testing hit `429 RESOURCE_EXHAUSTED` at just
**20 requests/day** (confirmed via https://aistudio.google.com/rate-limit),
far below the ~1,500/day a normal verified free-tier account gets. Cause
suspected to be a brand-new/unverified Google Cloud project. If default
replies start happening for no reason, check quota first before debugging
code. Fixes: wait for daily reset, use a different Google account's key
(quota is per-project), or enable billing (pay-as-you-go; ballpark cost
~0.04 THB/conversation per pricing checked this session — verify current
pricing at ai.google.dev/pricing before relying on that number).

## FAQ content — known gaps as of this session

The live Google Sheet only has ~12 rows and is missing pricing entirely, plus
several services the bot's own system prompt claims to support (SSL,
Google Service, Microsoft Service/SQL Server, Imunify360, Dedicated Server
pricing, Email Service, domain registration/transfer). `faq-draft.csv` in
this repo's root is a ~25-row replacement draft (placeholder prices clearly
marked in the answer text — need real numbers from Hostatom's sales team
before going live). Import it into the Google Sheet via File → Import →
Upload → Replace current sheet, then re-publish if the publish link changed.
When writing more FAQ rows yourself, follow `lib/gemini.ts`'s prompt rules:
one question per row, prices/timelines spelled out in full or the bot will
default instead of guessing (which is correct behavior — don't "fix" that).

## Tested and confirmed working (via live LINE + direct API calls)

Matched FAQ questions, typo/synonym matching, out-of-scope questions
(correctly default instead of hallucinating), price questions with no FAQ
match (correctly default), prompt-injection/jailbreak attempts (bot doesn't
comply), stickers (silently ignored, no Gemini call), webhook signature
rejection for unsigned requests, and the full error-fallback chain (timeout,
API error, MAX_TOKENS, empty response, no FAQ available) all landing on
`DEFAULT_REPLY` while still returning HTTP 200 to LINE.

## Not built yet (intentionally, per original scope)

Spam/abuse protection, human handoff when the bot defaults too often,
cross-message memory, rich menu / quick replies. These were explicitly
deferred to a later phase, not overlooked.
