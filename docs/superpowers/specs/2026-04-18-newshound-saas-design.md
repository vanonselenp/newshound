# Newshound SaaS — Design Spec

**Date:** 2026-04-18
**Status:** Approved for implementation planning

---

## Problem

Newshound is a personal CLI tool that aggregates content from RSS feeds, Reddit, and Hacker News, filters it through Claude, and writes a daily markdown digest to an Obsidian vault. It works well for a single technical user willing to set it up and maintain it locally.

The same value — personalised, LLM-filtered daily digest delivered without manual effort — is useful to a much wider audience: developers who don't want the maintenance burden, and non-technical users who can't set it up at all. No existing product fills this gap. The closest attempt (Mailbrew) shut down in 2024, pre-LLM, and without the AI-filtering angle that makes this product meaningfully different.

---

## Product

A web app where users configure their own sources and define what "signal" means to them via plain-English category prompts. Once a day, they receive an email digest filtered and summarised by Claude — one section per category, only items that match.

**Core differentiator:** user-defined categories with prompts. Not a fixed topic filter, not generic AI summarisation — each user defines the intelligence layer themselves.

**Business model:** usage-based billing via Stripe metered billing. Users choose their Claude model (Haiku or Sonnet); the platform charges at cost plus a small platform margin. First 5 digests free; card required at signup to prevent free-tier abuse. No monthly minimum.

---

## Scope

This spec covers the product built as a new private repository. The existing newshound CLI remains as-is. Core pipeline logic (fetchers, filter, summarise, render) will be ported to shared TypeScript source files within the new repo, imported by both the API Worker and the Digest Processor Worker. No Node.js-specific APIs (`fs`, `child_process`) — Workers-runtime compatible only.

**Out of scope for v1:**
- Per-user delivery timezone (all digests at 06:00 UTC)
- Digest history beyond 90 days
- Team/shared digests
- Source types beyond RSS, Reddit, and HN
- Web scraping / full-text article fetching
- Mobile app

---

## Architecture

### Four components

**1. UI — Cloudflare Pages + React + Vite**
The user-facing web app. Handles source configuration, category management, model selection, digest history, and account/billing. Communicates with the API Worker via `fetch()`. Auth via Clerk (JWT passed in request headers).

**2. API Worker — Cloudflare Workers + Hono**
The synchronous HTTP API. Validates Clerk JWTs, handles all CRUD operations on user data, enqueues digest jobs, serves usage data, and handles Stripe webhooks. Never calls Claude directly — all LLM work is async via the queue.

**3. Digest Processor Worker — Cloudflare Workers + Queue consumer**
Consumes one queue message per user per day. Runs the full pipeline: fetch sources → filter + assign via Claude → summarise via Claude → render HTML email → send via Resend → record usage → report to Stripe. Isolated from the API so a slow or failing digest for one user has no effect on others.

**4. Cron Handler — part of the API Worker**
A cron trigger attached to the API Worker (not a separate deployment). Fires at 06:00 UTC. Queries D1 for all active users. Enqueues one `{ userId, date }` message per user. Exits. No LLM calls, no email sending — fan-out only.

### Infrastructure

| Layer | Service |
|---|---|
| Frontend | Cloudflare Pages |
| API + Cron | Cloudflare Workers |
| Async processing | Cloudflare Queues |
| Database | Cloudflare D1 (SQLite) |
| Auth | Clerk |
| Email delivery | Resend |
| Payments | Stripe (metered billing) |
| LLM | Anthropic SDK (Claude Haiku / Sonnet) |

Platform cost at 0–50 users: ~£0/month. LLM costs are passed through to users.

---

## Data Model

```sql
users
  id            text PK   -- Clerk user ID
  email         text
  stripe_id     text      -- Stripe customer ID, set at signup
  model         text      -- 'claude-haiku-3' | 'claude-sonnet-4-5'
  active        boolean   -- false = paused, excluded from cron
  digests_sent  integer   -- lifetime count; free tier ends at 5
  created_at    text

sources
  id            text PK
  user_id       text FK → users
  name          text
  type          text      -- 'rss' | 'reddit' | 'hn'
  url           text      -- RSS/Atom feed URL
  subreddit     text      -- Reddit: subreddit name
  hn_keywords   text      -- HN: JSON array of keyword strings
  min_score     integer   -- Reddit/HN: minimum upvote threshold
  enabled       boolean
  created_at    text

categories
  id            text PK
  user_id       text FK → users
  name          text      -- display name, becomes section heading in email
  prompt        text      -- plain-English signal definition
  display_order integer
  created_at    text

digests
  id            text PK
  user_id       text FK → users
  date          text      -- YYYY-MM-DD
  status        text      -- pending | processing | sent | failed
  sources_scanned  integer
  items_surfaced   integer
  items_filtered   integer
  model_used    text
  tokens_input  integer
  tokens_output integer
  cost_usd      real
  content_html  text      -- stored for digest history view
  error_message text      -- set on failure
  sent_at       text
  created_at    text

usage_records
  id            text PK
  user_id       text FK → users
  digest_id     text FK → digests
  tokens_input  integer
  tokens_output integer
  model         text
  cost_usd      real
  stripe_reported  boolean
  created_at    text
```

---

## User-Defined Categories

Each category has a `name` (e.g. "AI tooling") and a `prompt` (plain-English description of what belongs in it, e.g. "Practical news about AI developer tools — new releases, workflows, and real-world usage. No hype or speculation.").

In the filter + assign Claude call, all fetched items and all of the user's category definitions are sent together in one prompt. Claude assigns each item to a category or discards it. Items assigned to no category are filtered out. Each category becomes a section in the email.

Users with no categories defined get a sensible default prompt equivalent to newshound's current hardcoded criteria.

Template prompts are offered during onboarding to lower the barrier for non-technical users.

---

## Digest Pipeline (per user)

1. Load user config (sources, categories, model) from D1
2. Mark digest row as `processing`
3. Fetch all sources concurrently — RSS/Atom, Reddit JSON, HN Algolia
4. Failed sources: skip, record warning, continue. If all sources fail: abort, mark `failed`, no charge.
5. **Filter + assign pass** — one Claude API call. Input: all items + user's category definitions. Output: `{ category, item_index, signal: 'include' | 'discard' }` per item.
6. **Summarise pass** — one Claude API call. Input: included items grouped by category. Output: structured summaries per category.
7. Render HTML email — one section per category, item count footer
8. Send via Resend. On failure: retry once. If still failing: abort, mark `failed`. Do not charge for undelivered digests.
9. Store `content_html` in D1
10. Write to `usage_records`
11. Report usage to Stripe metered billing (non-blocking — log and retry on failure, do not abort digest)
12. Mark digest `sent`

---

## Onboarding Flow

1. **Sign up** — Clerk (email or OAuth). User row created in D1. Stripe customer created.
2. **Add sources** — RSS URL, subreddit, or HN keywords. At least one required. Curated defaults offered.
3. **Add categories** — name + prompt per category. Template prompts offered. Default used if none added.
4. **Choose model** — Haiku (fast, cheap) or Sonnet (smarter). Shown with estimated cost per digest.
5. **Add card** — Stripe Checkout. Required before activation. First 5 digests free, then metered billing.

After step 5 the user is active. First digest arrives the next morning at 06:00 UTC. A Resend confirmation email is sent immediately confirming the schedule.

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Source fetch fails | Skip source, record warning. Digest continues. |
| All sources fail | Abort digest. Mark `failed`. No email, no charge. |
| Claude API fails | Retry once. On second failure: abort, mark `failed`, no charge. |
| Email delivery fails | Retry once. On second failure: abort, mark `failed`. Do not charge. |
| Queue message fails × 3 | CF Queues moves to dead-letter queue. Digest marked `failed`. No silent losses. |
| Stripe reporting fails | Log to `usage_records.stripe_reported = false`. Retry on next run. Non-blocking. |

**Invariant:** a user is never charged for a digest they did not receive.

---

## Testing Strategy

**Unit tests (Vitest):** Pure functions — fetchers, prompt builders, renderer, cost calculator. External dependencies (Claude SDK, Resend, Stripe) are mocked. Ported and extended from newshound's existing test suite.

**Integration tests:** Digest Processor Worker end-to-end using Cloudflare's local Miniflare environment with a real D1 instance. External API calls mocked. Verifies the full pipeline from queue message to digest row marked `sent`.

**Manual smoke test:** `POST /digest/preview` API endpoint. Runs the full pipeline for the authenticated user on demand — no email sent, returns rendered HTML. Used during local development and for manual QA.

---

## Open Questions

- Markup percentage on LLM costs (e.g. 20–30% over API cost)?
- Landing page / marketing site, or just a signup wall?
- Digest history UI: plain list of past digests, or searchable?
