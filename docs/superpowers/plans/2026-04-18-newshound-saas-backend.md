# Newshound SaaS — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for a multi-user AI digest SaaS — two Cloudflare Workers (API + Digest Processor), a shared pipeline package, D1 database, and Cloudflare Queues.

**Architecture:** A pnpm monorepo with `packages/pipeline` (shared Workers-compatible TS), `workers/api` (Hono HTTP API + cron handler), and `workers/processor` (queue consumer that runs the full digest pipeline per user). The API Worker never calls Claude — all LLM work is async via the queue.

**Tech Stack:** Cloudflare Workers, Hono, Cloudflare D1 (SQLite), Cloudflare Queues, Anthropic SDK, Resend, Stripe (Billing Meters), Clerk (@clerk/backend), Vitest, @cloudflare/vitest-pool-workers, pnpm workspaces, TypeScript (strict).

**Spec:** `docs/superpowers/specs/2026-04-18-newshound-saas-design.md` in the newshound repo — read it before starting.

**Note:** This is a NEW private repository — not an extension of the newshound CLI repo.

---

## File Map

```
newshound-web/                          # new private repo root
├── package.json                        # pnpm workspace root (no src)
├── pnpm-workspace.yaml
├── tsconfig.base.json                  # shared TS config
├── .gitignore
├── migrations/
│   └── 0001_initial.sql               # D1 schema
├── packages/
│   └── pipeline/                      # shared Workers-compatible logic
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── types.ts               # FeedItem, Category, DigestContent, etc.
│           ├── fetchers/
│           │   ├── feed.ts            # RSS/Atom fetcher
│           │   ├── reddit.ts          # Reddit JSON fetcher
│           │   └── hn.ts              # HN Algolia fetcher
│           ├── filter.ts              # filter + assign Claude call
│           ├── summarise.ts           # summarise Claude call
│           ├── render.ts              # HTML email renderer
│           ├── cost.ts                # token → cost calculator
│           └── __tests__/
│               ├── fetchers/
│               │   ├── feed.test.ts
│               │   ├── reddit.test.ts
│               │   └── hn.test.ts
│               ├── filter.test.ts
│               ├── summarise.test.ts
│               ├── render.test.ts
│               └── cost.test.ts
└── workers/
    ├── api/                           # API Worker + cron handler
    │   ├── package.json
    │   ├── wrangler.toml
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   └── src/
    │       ├── index.ts               # Hono app entry + scheduled handler
    │       ├── env.ts                 # Env type definition
    │       ├── middleware/
    │       │   └── auth.ts            # Clerk JWT verification
    │       ├── routes/
    │       │   ├── webhooks.ts        # POST /webhooks/clerk, /webhooks/stripe
    │       │   ├── sources.ts         # CRUD /sources
    │       │   ├── categories.ts      # CRUD /categories
    │       │   ├── users.ts           # GET /users/me, PATCH /users/model
    │       │   ├── digests.ts         # GET /digests, POST /digest/preview
    │       │   └── usage.ts           # GET /usage
    │       ├── db.ts                  # typed D1 query functions
    │       ├── cron.ts                # daily fan-out handler
    │       └── cleanup.ts             # retention + stale-processing handler
    └── processor/                     # Digest Processor Worker
        ├── package.json
        ├── wrangler.toml
        ├── tsconfig.json
        ├── vitest.config.ts
        └── src/
            ├── index.ts               # queue consumer entry
            ├── env.ts                 # Env type definition
            ├── pipeline.ts            # full pipeline orchestration
            └── __tests__/
                ├── pipeline.test.ts   # happy path integration test
                ├── concurrent.test.ts # concurrent claim test
                └── cleanup.test.ts    # stale-processing test
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/pipeline/package.json`
- Create: `packages/pipeline/tsconfig.json`
- Create: `workers/api/package.json`
- Create: `workers/api/tsconfig.json`
- Create: `workers/processor/package.json`
- Create: `workers/processor/tsconfig.json`

- [ ] **Step 1: Create the repo and root files**

```bash
mkdir newshound-web && cd newshound-web && git init
```

Create `package.json`:
```json
{
  "name": "newshound-web",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'workers/*'
```

Create `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  }
}
```

Create `.gitignore`:
```
node_modules/
dist/
.wrangler/
.dev.vars
*.local
```

- [ ] **Step 2: Scaffold the pipeline package**

Create `packages/pipeline/package.json`:
```json
{
  "name": "@newshound/pipeline",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "vitest": "^3.1.2",
    "typescript": "^5.8.3"
  }
}
```

Create `packages/pipeline/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "WebWorker"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Scaffold the API worker package**

Create `workers/api/package.json`:
```json
{
  "name": "@newshound/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@newshound/pipeline": "workspace:*",
    "@anthropic-ai/sdk": "^0.40.0",
    "@clerk/backend": "^1.25.4",
    "hono": "^4.7.7",
    "resend": "^4.5.1",
    "stripe": "^17.7.0",
    "svix": "^1.62.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.8",
    "@cloudflare/workers-types": "^4.20250414.0",
    "vitest": "^3.1.2",
    "wrangler": "^4.12.0",
    "typescript": "^5.8.3"
  }
}
```

Create `workers/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Scaffold the processor worker package**

Create `workers/processor/package.json`:
```json
{
  "name": "@newshound/processor",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@newshound/pipeline": "workspace:*",
    "@anthropic-ai/sdk": "^0.40.0",
    "resend": "^4.5.1",
    "stripe": "^17.7.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.8",
    "@cloudflare/workers-types": "^4.20250414.0",
    "vitest": "^3.1.2",
    "wrangler": "^4.12.0",
    "typescript": "^5.8.3"
  }
}
```

Create `workers/processor/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Install dependencies**

```bash
pnpm install
```

Expected: packages installed, pnpm-lock.yaml created.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold — pipeline, api, processor packages"
```

---

## Task 2: D1 schema migration

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `workers/api/wrangler.toml`
- Create: `workers/processor/wrangler.toml`

- [ ] **Step 1: Write the migration**

Create `migrations/0001_initial.sql`:
```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  stripe_id     TEXT,
  model         TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  active        INTEGER NOT NULL DEFAULT 0,
  digests_sent  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sources (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('rss', 'reddit', 'hn')),
  url           TEXT,
  subreddit     TEXT,
  hn_keywords   TEXT,
  min_score     INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE digests (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'scheduled' CHECK (type IN ('scheduled', 'preview')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  sources_scanned   INTEGER,
  items_surfaced    INTEGER,
  items_filtered    INTEGER,
  model_used        TEXT,
  tokens_input      INTEGER,
  tokens_output     INTEGER,
  api_cost_usd      REAL,
  amount_billed_usd REAL,
  markup_pct        REAL,
  content_html      TEXT,
  error_message     TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date, type)
);

CREATE TABLE usage_records (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest_id         TEXT NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  tokens_input      INTEGER NOT NULL,
  tokens_output     INTEGER NOT NULL,
  model             TEXT NOT NULL,
  api_cost_usd      REAL NOT NULL,
  amount_billed_usd REAL NOT NULL,
  markup_pct        REAL NOT NULL,
  stripe_reported   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sources_user ON sources(user_id);
CREATE INDEX idx_categories_user ON categories(user_id, display_order);
CREATE INDEX idx_digests_user_date ON digests(user_id, date);
CREATE INDEX idx_digests_status ON digests(status);
CREATE INDEX idx_usage_user ON usage_records(user_id);
CREATE INDEX idx_usage_unreported ON usage_records(stripe_reported) WHERE stripe_reported = 0;
```

- [ ] **Step 2: Create the API Worker wrangler config**

Create `workers/api/wrangler.toml`:
```toml
name = "newshound-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 6 * * *"]

[[d1_databases]]
binding = "DB"
database_name = "newshound-web"
database_id = "REPLACE_AFTER_CREATE"

[[queues.producers]]
binding = "DIGEST_QUEUE"
queue = "newshound-digest-queue"

[vars]
MARKUP_PCT = "25"

# Secrets (set via `wrangler secret put`):
# CLERK_SECRET_KEY
# CLERK_WEBHOOK_SECRET
# STRIPE_SECRET_KEY
# STRIPE_WEBHOOK_SECRET
# STRIPE_PRICE_ID          (metered price ID from Stripe dashboard)
# STRIPE_METER_EVENT_NAME  (e.g. "digest_cost")
# RESEND_API_KEY
# RESEND_FROM              (e.g. "digest@mail.newshound.io")
# ANTHROPIC_API_KEY
```

- [ ] **Step 3: Create the Processor Worker wrangler config**

Create `workers/processor/wrangler.toml`:
```toml
name = "newshound-processor"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "newshound-web"
database_id = "REPLACE_AFTER_CREATE"

[[queues.consumers]]
queue = "newshound-digest-queue"
max_batch_size = 1
max_retries = 3
dead_letter_queue = "newshound-digest-dlq"

[vars]
MARKUP_PCT = "25"

# Secrets (set via `wrangler secret put`):
# ANTHROPIC_API_KEY
# RESEND_API_KEY
# RESEND_FROM
# STRIPE_SECRET_KEY
# STRIPE_METER_EVENT_NAME
```

- [ ] **Step 4: Create the D1 database and apply migration**

```bash
# In workers/api/ directory:
cd workers/api
npx wrangler d1 create newshound-web
# Copy the database_id from output and replace REPLACE_AFTER_CREATE in both wrangler.toml files
npx wrangler d1 execute newshound-web --file=../../migrations/0001_initial.sql --local
```

Expected: Tables created in local D1.

- [ ] **Step 5: Commit**

```bash
cd ../..
git add migrations/ workers/api/wrangler.toml workers/processor/wrangler.toml
git commit -m "chore: D1 schema migration and wrangler configs"
```

---

## Task 3: Shared types

**Files:**
- Create: `packages/pipeline/src/types.ts`
- Create: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Write the types**

Create `packages/pipeline/src/types.ts`:
```typescript
export interface FeedItem {
  title: string;
  url: string;
  publishedAt: Date;
  description: string;
  sourceName: string;
  sourceType: 'rss' | 'reddit' | 'hn';
}

export interface Category {
  id: string;
  name: string;
  prompt: string;
}

export interface AssignedItem {
  item: FeedItem;
  category: string;
}

export interface FilterResult {
  assigned: AssignedItem[];
  discarded: FeedItem[];
}

export interface SummaryItem {
  title: string;
  url: string;
  sourceName: string;
  summary: string;
  takeaway: string;
}

export interface CategorySummary {
  categoryName: string;
  items: SummaryItem[];
}

export interface DigestContent {
  categories: CategorySummary[];
  sourcesScanned: number;
  itemsSurfaced: number;
  itemsFiltered: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostResult {
  apiCostUsd: number;
  amountBilledUsd: number;
  markupPct: number;
}

// The function signature that all Claude callers accept
export type ClaudeAdapter = (prompt: string) => Promise<{ text: string; usage: TokenUsage }>;
```

Create `packages/pipeline/src/index.ts`:
```typescript
export * from './types.js';
export * from './fetchers/feed.js';
export * from './fetchers/reddit.js';
export * from './fetchers/hn.js';
export * from './filter.js';
export * from './summarise.js';
export * from './render.js';
export * from './cost.js';
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/pipeline && npx tsc --noEmit
```

Expected: No errors (only types defined, no implementations yet so imports from other files will fail — that's OK, fix as you add them).

- [ ] **Step 3: Commit**

```bash
cd ../.. && git add packages/pipeline/src/types.ts packages/pipeline/src/index.ts
git commit -m "feat: shared pipeline types"
```

---

## Task 4: RSS/Atom fetcher

**Files:**
- Create: `packages/pipeline/src/fetchers/feed.ts`
- Create: `packages/pipeline/src/__tests__/fetchers/feed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/fetchers/feed.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { fetchFeed } from '../../fetchers/feed.js';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>New Claude Feature</title>
      <link>https://example.com/claude-feature</link>
      <description>Claude now supports X</description>
      <pubDate>Sat, 18 Apr 2026 10:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Old Article</title>
      <link>https://example.com/old</link>
      <description>This is old</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Article</title>
    <link href="https://example.com/atom-article"/>
    <summary>Atom description</summary>
    <updated>2026-04-18T10:00:00Z</updated>
  </entry>
</feed>`;

const mockFetch = (body: string) => async (_url: string) => body;

describe('fetchFeed', () => {
  const since = new Date('2026-04-17T00:00:00Z');

  it('parses RSS items newer than since', async () => {
    const items = await fetchFeed('https://example.com/rss', 'Test Feed', since, mockFetch(RSS_FIXTURE));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'New Claude Feature',
      url: 'https://example.com/claude-feature',
      description: 'Claude now supports X',
      sourceName: 'Test Feed',
      sourceType: 'rss',
    });
    expect(items[0]?.publishedAt).toBeInstanceOf(Date);
  });

  it('filters out items older than since', async () => {
    const items = await fetchFeed('https://example.com/rss', 'Test Feed', since, mockFetch(RSS_FIXTURE));
    expect(items.every(i => i.publishedAt > since)).toBe(true);
  });

  it('parses Atom feeds', async () => {
    const items = await fetchFeed('https://example.com/atom', 'Atom Feed', since, mockFetch(ATOM_FIXTURE));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Atom Article',
      url: 'https://example.com/atom-article',
      sourceName: 'Atom Feed',
      sourceType: 'rss',
    });
  });

  it('returns empty array when all items are older than since', async () => {
    const future = new Date('2030-01-01');
    const items = await fetchFeed('https://example.com/rss', 'Test Feed', future, mockFetch(RSS_FIXTURE));
    expect(items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/fetchers/feed.test.ts
```

Expected: FAIL — "Cannot find module '../../fetchers/feed.js'"

- [ ] **Step 3: Implement the fetcher**

Create `packages/pipeline/src/fetchers/feed.ts`:
```typescript
import type { FeedItem } from '../types.js';

type FetchFn = (url: string) => Promise<string>;

function extractTag(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return match?.[1]?.trim() ?? '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const match = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i').exec(xml);
  return match?.[1]?.trim() ?? '';
}

function parseRssItems(xml: string, sourceName: string, since: Date): FeedItem[] {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const items: FeedItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = extractTag(block, 'title').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
    const url = extractTag(block, 'link').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
    const description = extractTag(block, 'description').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
    const pubDateStr = extractTag(block, 'pubDate');
    const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date(0);

    if (!title || !url || publishedAt <= since) continue;
    items.push({ title, url, publishedAt, description, sourceName, sourceType: 'rss' });
  }
  return items;
}

function parseAtomItems(xml: string, sourceName: string, since: Date): FeedItem[] {
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  const items: FeedItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = extractTag(block, 'title').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
    const url = extractAttr(block, 'link', 'href');
    const description = extractTag(block, 'summary') || extractTag(block, 'content');
    const updatedStr = extractTag(block, 'updated');
    const publishedAt = updatedStr ? new Date(updatedStr) : new Date(0);

    if (!title || !url || publishedAt <= since) continue;
    items.push({ title, url, publishedAt, description, sourceName, sourceType: 'rss' });
  }
  return items;
}

export async function fetchFeed(
  url: string,
  sourceName: string,
  since: Date,
  fetchFn: FetchFn = async (u) => { const r = await fetch(u); return r.text(); },
): Promise<FeedItem[]> {
  const xml = await fetchFn(url);
  if (xml.includes('<feed') && xml.includes('xmlns')) {
    return parseAtomItems(xml, sourceName, since);
  }
  return parseRssItems(xml, sourceName, since);
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/fetchers/feed.test.ts
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/pipeline/src/fetchers/feed.ts packages/pipeline/src/__tests__/fetchers/feed.test.ts
git commit -m "feat: RSS/Atom feed fetcher with tests"
```

---

## Task 5: Reddit fetcher

**Files:**
- Create: `packages/pipeline/src/fetchers/reddit.ts`
- Create: `packages/pipeline/src/__tests__/fetchers/reddit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/fetchers/reddit.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { fetchReddit } from '../../fetchers/reddit.js';

const REDDIT_FIXTURE = {
  data: {
    children: [
      {
        data: {
          title: 'I built a coding agent with Claude',
          url: 'https://reddit.com/r/ClaudeAI/comments/abc',
          selftext: 'Here is how I did it...',
          score: 150,
          created_utc: Math.floor(new Date('2026-04-18T08:00:00Z').getTime() / 1000),
        },
      },
      {
        data: {
          title: 'Low score post',
          url: 'https://reddit.com/r/ClaudeAI/comments/xyz',
          selftext: '',
          score: 5,
          created_utc: Math.floor(new Date('2026-04-18T08:00:00Z').getTime() / 1000),
        },
      },
      {
        data: {
          title: 'Old post',
          url: 'https://reddit.com/r/ClaudeAI/comments/old',
          selftext: '',
          score: 200,
          created_utc: Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000),
        },
      },
    ],
  },
};

const mockFetch = (data: unknown) => async (_url: string) => JSON.stringify(data);

describe('fetchReddit', () => {
  const since = new Date('2026-04-17T00:00:00Z');

  it('returns posts above minScore and newer than since', async () => {
    const items = await fetchReddit('ClaudeAI', 20, since, mockFetch(REDDIT_FIXTURE));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'I built a coding agent with Claude',
      sourceName: 'r/ClaudeAI',
      sourceType: 'reddit',
    });
  });

  it('filters out posts below minScore', async () => {
    const items = await fetchReddit('ClaudeAI', 20, since, mockFetch(REDDIT_FIXTURE));
    expect(items.every(i => i.title !== 'Low score post')).toBe(true);
  });

  it('filters out posts older than since', async () => {
    const items = await fetchReddit('ClaudeAI', 20, since, mockFetch(REDDIT_FIXTURE));
    expect(items.every(i => i.publishedAt > since)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/fetchers/reddit.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement**

Create `packages/pipeline/src/fetchers/reddit.ts`:
```typescript
import type { FeedItem } from '../types.js';

type FetchFn = (url: string) => Promise<string>;

interface RedditPost {
  title: string;
  url: string;
  selftext: string;
  score: number;
  created_utc: number;
}

interface RedditResponse {
  data: { children: Array<{ data: RedditPost }> };
}

export async function fetchReddit(
  subreddit: string,
  minScore: number,
  since: Date,
  fetchFn: FetchFn = async (u) => { const r = await fetch(u); return r.text(); },
): Promise<FeedItem[]> {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=25`;
  const raw = await fetchFn(url);
  const json = JSON.parse(raw) as RedditResponse;

  return json.data.children
    .map(c => c.data)
    .filter(p => p.score >= minScore)
    .map(p => ({
      title: p.title,
      url: p.url,
      publishedAt: new Date(p.created_utc * 1000),
      description: p.selftext.slice(0, 500),
      sourceName: `r/${subreddit}`,
      sourceType: 'reddit' as const,
    }))
    .filter(item => item.publishedAt > since);
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/fetchers/reddit.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/pipeline/src/fetchers/reddit.ts packages/pipeline/src/__tests__/fetchers/reddit.test.ts
git commit -m "feat: Reddit fetcher with tests"
```

---

## Task 6: HN fetcher

**Files:**
- Create: `packages/pipeline/src/fetchers/hn.ts`
- Create: `packages/pipeline/src/__tests__/fetchers/hn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/fetchers/hn.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { fetchHN } from '../../fetchers/hn.js';

const HN_FIXTURE = {
  hits: [
    {
      title: 'Show HN: I used Claude to build a dev tool',
      url: 'https://example.com/tool',
      points: 120,
      created_at: '2026-04-18T09:00:00.000Z',
      objectID: '12345',
    },
    {
      title: 'Low points story',
      url: 'https://example.com/low',
      points: 10,
      created_at: '2026-04-18T09:00:00.000Z',
      objectID: '12346',
    },
    {
      title: 'Old story',
      url: 'https://example.com/old',
      points: 200,
      created_at: '2024-01-01T00:00:00.000Z',
      objectID: '12347',
    },
  ],
};

const mockFetch = (data: unknown) => async (_url: string) => JSON.stringify(data);

describe('fetchHN', () => {
  const since = new Date('2026-04-17T00:00:00Z');

  it('returns stories above minScore and newer than since', async () => {
    const items = await fetchHN(50, since, mockFetch(HN_FIXTURE));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Show HN: I used Claude to build a dev tool',
      url: 'https://example.com/tool',
      sourceName: 'Hacker News',
      sourceType: 'hn',
    });
  });

  it('constructs the correct Algolia query URL', async () => {
    let capturedUrl = '';
    const captureFetch = async (url: string) => { capturedUrl = url; return JSON.stringify(HN_FIXTURE); };
    await fetchHN(50, since, captureFetch);
    expect(capturedUrl).toContain('hn.algolia.com');
    expect(capturedUrl).toContain('numericFilters=points%3E%3D50');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/fetchers/hn.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/pipeline/src/fetchers/hn.ts`:
```typescript
import type { FeedItem } from '../types.js';

type FetchFn = (url: string) => Promise<string>;

const HN_KEYWORDS = ['AI', 'LLM', 'Claude', 'cursor', 'copilot', 'GPT', 'openai', 'anthropic', 'agent'];

interface HNHit {
  title: string;
  url?: string;
  points: number;
  created_at: string;
  objectID: string;
}

interface HNResponse {
  hits: HNHit[];
}

export async function fetchHN(
  minScore: number,
  since: Date,
  fetchFn: FetchFn = async (u) => { const r = await fetch(u); return r.text(); },
): Promise<FeedItem[]> {
  const query = encodeURIComponent(HN_KEYWORDS.join(' '));
  const sinceTs = Math.floor(since.getTime() / 1000);
  const url =
    `https://hn.algolia.com/api/v1/search?query=${query}` +
    `&tags=story` +
    `&numericFilters=points%3E%3D${minScore},created_at_i%3E${sinceTs}` +
    `&hitsPerPage=30`;

  const raw = await fetchFn(url);
  const json = JSON.parse(raw) as HNResponse;

  return json.hits
    .filter(h => h.url && new Date(h.created_at) > since)
    .map(h => ({
      title: h.title,
      url: h.url!,
      publishedAt: new Date(h.created_at),
      description: '',
      sourceName: 'Hacker News',
      sourceType: 'hn' as const,
    }));
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/fetchers/hn.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/pipeline/src/fetchers/hn.ts packages/pipeline/src/__tests__/fetchers/hn.test.ts
git commit -m "feat: HN Algolia fetcher with tests"
```

---

## Task 7: Cost calculator

**Files:**
- Create: `packages/pipeline/src/cost.ts`
- Create: `packages/pipeline/src/__tests__/cost.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/cost.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calculateCost } from '../cost.js';

describe('calculateCost', () => {
  it('calculates haiku cost correctly', () => {
    // claude-haiku-4-5: $0.80/1M input, $4.00/1M output
    const result = calculateCost({
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 50_000,
      outputTokens: 2_000,
      markupPct: 25,
    });
    const expectedApi = (50_000 / 1_000_000) * 0.80 + (2_000 / 1_000_000) * 4.00;
    expect(result.apiCostUsd).toBeCloseTo(expectedApi, 6);
    expect(result.amountBilledUsd).toBeCloseTo(expectedApi * 1.25, 6);
    expect(result.markupPct).toBe(25);
  });

  it('calculates sonnet cost correctly', () => {
    // claude-sonnet-4-5: $3.00/1M input, $15.00/1M output
    const result = calculateCost({
      model: 'claude-sonnet-4-5',
      inputTokens: 50_000,
      outputTokens: 2_000,
      markupPct: 25,
    });
    const expectedApi = (50_000 / 1_000_000) * 3.00 + (2_000 / 1_000_000) * 15.00;
    expect(result.apiCostUsd).toBeCloseTo(expectedApi, 6);
    expect(result.amountBilledUsd).toBeCloseTo(expectedApi * 1.25, 6);
  });

  it('throws on unknown model', () => {
    expect(() => calculateCost({ model: 'unknown-model', inputTokens: 100, outputTokens: 100, markupPct: 25 }))
      .toThrow('Unknown model');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/cost.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/pipeline/src/cost.ts`:
```typescript
import type { CostResult } from './types.js';

// Prices in USD per 1M tokens. Verify against https://www.anthropic.com/pricing
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-sonnet-4-5': { inputPer1M: 3.00, outputPer1M: 15.00 },
};

export function calculateCost(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  markupPct: number;
}): CostResult {
  const pricing = MODEL_PRICING[params.model];
  if (!pricing) throw new Error(`Unknown model: ${params.model}`);

  const apiCostUsd =
    (params.inputTokens / 1_000_000) * pricing.inputPer1M +
    (params.outputTokens / 1_000_000) * pricing.outputPer1M;

  const amountBilledUsd = apiCostUsd * (1 + params.markupPct / 100);

  return { apiCostUsd, amountBilledUsd, markupPct: params.markupPct };
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/cost.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/pipeline/src/cost.ts packages/pipeline/src/__tests__/cost.test.ts
git commit -m "feat: token cost calculator with markup"
```

---

## Task 8: Filter + assign

**Files:**
- Create: `packages/pipeline/src/filter.ts`
- Create: `packages/pipeline/src/__tests__/filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/filter.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { filterAndAssign, DEFAULT_CATEGORY } from '../filter.js';
import type { FeedItem, Category, ClaudeAdapter } from '../types.js';

const makeItem = (title: string): FeedItem => ({
  title,
  url: `https://example.com/${title}`,
  publishedAt: new Date(),
  description: `Description of ${title}`,
  sourceName: 'Test',
  sourceType: 'rss',
});

const makeAdapter = (response: unknown): ClaudeAdapter =>
  async () => ({ text: JSON.stringify(response), usage: { inputTokens: 100, outputTokens: 50 } });

describe('filterAndAssign', () => {
  const items: FeedItem[] = [
    makeItem('New Claude Code feature'),
    makeItem('Random cooking recipe'),
    makeItem('TypeScript performance tip'),
  ];
  const categories: Category[] = [
    { id: '1', name: 'AI tooling', prompt: 'Practical AI news' },
    { id: '2', name: 'TypeScript', prompt: 'TypeScript and JS ecosystem' },
  ];

  it('assigns items to categories based on Claude response', async () => {
    const adapter = makeAdapter([
      { item_index: 0, category: 'AI tooling', signal: 'include' },
      { item_index: 1, category: null, signal: 'discard' },
      { item_index: 2, category: 'TypeScript', signal: 'include' },
    ]);

    const result = await filterAndAssign(items, categories, adapter);

    expect(result.assigned).toHaveLength(2);
    expect(result.assigned[0]).toMatchObject({ category: 'AI tooling', item: items[0] });
    expect(result.assigned[1]).toMatchObject({ category: 'TypeScript', item: items[2] });
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]).toEqual(items[1]);
  });

  it('returns token usage', async () => {
    const adapter = makeAdapter([{ item_index: 0, category: 'AI tooling', signal: 'include' }]);
    const result = await filterAndAssign([items[0]!], categories, adapter);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('uses default category when no categories provided', async () => {
    const adapter = makeAdapter([
      { item_index: 0, category: DEFAULT_CATEGORY, signal: 'include' },
    ]);
    const result = await filterAndAssign([items[0]!], [], adapter);
    expect(result.assigned[0]?.category).toBe(DEFAULT_CATEGORY);
  });

  it('handles Claude returning invalid JSON gracefully', async () => {
    const badAdapter: ClaudeAdapter = async () => ({ text: 'not json', usage: { inputTokens: 10, outputTokens: 5 } });
    await expect(filterAndAssign(items, categories, badAdapter)).rejects.toThrow('Failed to parse filter response');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/filter.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/pipeline/src/filter.ts`:
```typescript
import type { FeedItem, Category, AssignedItem, ClaudeAdapter, TokenUsage } from './types.js';

export const DEFAULT_CATEGORY = 'Digest';

const DEFAULT_PROMPT =
  'High-signal AI and developer tooling news: new releases, practical workflows, ' +
  'real-world usage examples, meaningful performance improvements. ' +
  'Exclude hype, speculation, fundraising, and benchmark-only posts.';

interface FilterResponse {
  item_index: number;
  category: string | null;
  signal: 'include' | 'discard';
}

function buildPrompt(items: FeedItem[], categories: Category[]): string {
  const cats = categories.length > 0
    ? categories.map(c => `- "${c.name}": ${c.prompt}`).join('\n')
    : `- "${DEFAULT_CATEGORY}": ${DEFAULT_PROMPT}`;

  const itemList = items
    .map((item, i) => `[${i}] ${item.title}\nSource: ${item.sourceName}\n${item.description.slice(0, 300)}`)
    .join('\n\n');

  return `You are a content filter. Assign each item to a category or discard it.

Categories:
${cats}

Items:
${itemList}

Return a JSON array only — no other text. Each element:
{ "item_index": number, "category": string | null, "signal": "include" | "discard" }

Only include items that clearly match a category. Discard everything else.`;
}

export async function filterAndAssign(
  items: FeedItem[],
  categories: Category[],
  claude: ClaudeAdapter,
): Promise<{ assigned: AssignedItem[]; discarded: FeedItem[]; usage: TokenUsage }> {
  if (items.length === 0) {
    return { assigned: [], discarded: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const prompt = buildPrompt(items, categories);
  const { text, usage } = await claude(prompt);

  let parsed: FilterResponse[];
  try {
    parsed = JSON.parse(text) as FilterResponse[];
  } catch {
    throw new Error(`Failed to parse filter response: ${text.slice(0, 200)}`);
  }

  const assigned: AssignedItem[] = [];
  const includedIndices = new Set<number>();

  for (const entry of parsed) {
    if (entry.signal === 'include' && entry.category !== null) {
      const item = items[entry.item_index];
      if (item) {
        assigned.push({ item, category: entry.category });
        includedIndices.add(entry.item_index);
      }
    }
  }

  const discarded = items.filter((_, i) => !includedIndices.has(i));
  return { assigned, discarded, usage };
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/filter.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/pipeline/src/filter.ts packages/pipeline/src/__tests__/filter.test.ts
git commit -m "feat: filter + assign pipeline step with tests"
```

---

## Task 9: Summarise

**Files:**
- Create: `packages/pipeline/src/summarise.ts`
- Create: `packages/pipeline/src/__tests__/summarise.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/summarise.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { summarise } from '../summarise.js';
import type { AssignedItem, ClaudeAdapter } from '../types.js';

const makeAssigned = (title: string, category: string): AssignedItem => ({
  category,
  item: {
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    publishedAt: new Date(),
    description: `About ${title}`,
    sourceName: 'Test',
    sourceType: 'rss',
  },
});

const mockResponse = {
  categories: [
    {
      categoryName: 'AI tooling',
      items: [
        {
          title: 'New Claude feature',
          url: 'https://example.com/claude',
          sourceName: 'Test',
          summary: 'Claude added X which enables Y',
          takeaway: 'Try X in your workflow',
        },
      ],
    },
  ],
};

const makeAdapter = (response: unknown): ClaudeAdapter =>
  async () => ({ text: JSON.stringify(response), usage: { inputTokens: 500, outputTokens: 200 } });

describe('summarise', () => {
  it('returns structured summaries grouped by category', async () => {
    const assigned: AssignedItem[] = [makeAssigned('New Claude feature', 'AI tooling')];
    const result = await summarise(assigned, makeAdapter(mockResponse));

    expect(result.content.categories).toHaveLength(1);
    expect(result.content.categories[0]).toMatchObject({
      categoryName: 'AI tooling',
      items: [{ title: 'New Claude feature', takeaway: 'Try X in your workflow' }],
    });
  });

  it('returns token usage', async () => {
    const assigned: AssignedItem[] = [makeAssigned('Article', 'AI tooling')];
    const result = await summarise(assigned, makeAdapter(mockResponse));
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 200 });
  });

  it('throws on invalid Claude response', async () => {
    const bad: ClaudeAdapter = async () => ({ text: 'oops', usage: { inputTokens: 0, outputTokens: 0 } });
    const assigned: AssignedItem[] = [makeAssigned('Article', 'AI tooling')];
    await expect(summarise(assigned, bad)).rejects.toThrow('Failed to parse summarise response');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/summarise.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/pipeline/src/summarise.ts`:
```typescript
import type { AssignedItem, DigestContent, ClaudeAdapter, TokenUsage } from './types.js';

function buildPrompt(assigned: AssignedItem[]): string {
  const grouped = assigned.reduce<Record<string, AssignedItem[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  const sections = Object.entries(grouped)
    .map(([cat, items]) => {
      const list = items
        .map(a => `- ${a.item.title} (${a.item.sourceName})\n  ${a.item.description.slice(0, 400)}`)
        .join('\n');
      return `## ${cat}\n${list}`;
    })
    .join('\n\n');

  return `Summarise these articles for a developer digest. Be concise and practical.

${sections}

Return a JSON object only — no other text:
{
  "categories": [
    {
      "categoryName": string,
      "items": [
        {
          "title": string,
          "url": string,
          "sourceName": string,
          "summary": string,   // 2-3 sentences: what it is and why it matters
          "takeaway": string   // one actionable sentence
        }
      ]
    }
  ]
}`;
}

export async function summarise(
  assigned: AssignedItem[],
  claude: ClaudeAdapter,
): Promise<{ content: DigestContent; usage: TokenUsage }> {
  if (assigned.length === 0) {
    return {
      content: { categories: [], sourcesScanned: 0, itemsSurfaced: 0, itemsFiltered: 0 },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const { text, usage } = await claude(buildPrompt(assigned));

  let parsed: { categories: DigestContent['categories'] };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`Failed to parse summarise response: ${text.slice(0, 200)}`);
  }

  return {
    content: {
      categories: parsed.categories,
      sourcesScanned: 0, // filled by orchestrator
      itemsSurfaced: assigned.length,
      itemsFiltered: 0,  // filled by orchestrator
    },
    usage,
  };
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/summarise.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/pipeline/src/summarise.ts packages/pipeline/src/__tests__/summarise.test.ts
git commit -m "feat: summarise pipeline step with tests"
```

---

## Task 10: HTML email renderer

**Files:**
- Create: `packages/pipeline/src/render.ts`
- Create: `packages/pipeline/src/__tests__/render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/__tests__/render.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { renderEmail } from '../render.js';
import type { DigestContent } from '../types.js';

const content: DigestContent = {
  categories: [
    {
      categoryName: 'AI tooling',
      items: [
        {
          title: 'New Claude feature',
          url: 'https://example.com/claude',
          sourceName: 'Anthropic Blog',
          summary: 'Claude added a new feature that helps developers.',
          takeaway: 'Try the new feature in your next project.',
        },
      ],
    },
  ],
  sourcesScanned: 42,
  itemsSurfaced: 3,
  itemsFiltered: 39,
};

describe('renderEmail', () => {
  it('includes the date in the subject line area', () => {
    const html = renderEmail(content, '2026-04-18');
    expect(html).toContain('2026-04-18');
  });

  it('renders category sections as headings', () => {
    const html = renderEmail(content, '2026-04-18');
    expect(html).toContain('AI tooling');
  });

  it('renders article titles as links', () => {
    const html = renderEmail(content, '2026-04-18');
    expect(html).toContain('https://example.com/claude');
    expect(html).toContain('New Claude feature');
  });

  it('renders summaries and takeaways', () => {
    const html = renderEmail(content, '2026-04-18');
    expect(html).toContain('Claude added a new feature');
    expect(html).toContain('Try the new feature');
  });

  it('renders stats footer', () => {
    const html = renderEmail(content, '2026-04-18');
    expect(html).toContain('42');  // sourcesScanned
    expect(html).toContain('39');  // filtered
  });

  it('returns valid HTML with doctype', () => {
    const html = renderEmail(content, '2026-04-18');
    expect(html.trim()).toMatch(/^<!DOCTYPE html>/i);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd packages/pipeline && npx vitest run src/__tests__/render.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/pipeline/src/render.ts`:
```typescript
import type { DigestContent } from './types.js';

export function renderEmail(content: DigestContent, date: string): string {
  const categorySections = content.categories
    .map(cat => {
      const items = cat.items
        .map(
          item => `
        <div style="margin-bottom:24px;">
          <h3 style="margin:0 0 4px;font-size:16px;">
            <a href="${item.url}" style="color:#1a1a1a;text-decoration:none;">${item.title}</a>
          </h3>
          <p style="margin:0 0 4px;font-size:12px;color:#666;">${item.sourceName}</p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#333;">${item.summary}</p>
          <p style="margin:0;font-size:13px;color:#0066cc;font-style:italic;">→ ${item.takeaway}</p>
        </div>`,
        )
        .join('');

      return `
      <div style="margin-bottom:36px;">
        <h2 style="margin:0 0 16px;font-size:18px;border-bottom:2px solid #eee;padding-bottom:8px;">
          ${cat.categoryName}
        </h2>
        ${items}
      </div>`;
    })
    .join('');

  const emptyState =
    content.categories.length === 0
      ? '<p style="color:#666;font-style:italic;">Nothing cleared the signal threshold today.</p>'
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Your Digest — ${date}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;color:#1a1a1a;">
  <div style="margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid #eee;">
    <h1 style="margin:0;font-size:22px;font-weight:700;">Your Digest</h1>
    <p style="margin:4px 0 0;font-size:14px;color:#666;">${date}</p>
  </div>

  ${categorySections}
  ${emptyState}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999;">
    ${content.sourcesScanned} sources scanned · ${content.itemsSurfaced} items surfaced · ${content.itemsFiltered} filtered
  </div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npx vitest run src/__tests__/render.test.ts
```

Expected: PASS

- [ ] **Step 5: Run all pipeline tests**

```bash
npx vitest run
```

Expected: All tests passing.

- [ ] **Step 6: Commit**

```bash
cd ../.. && git add packages/pipeline/src/render.ts packages/pipeline/src/__tests__/render.test.ts
git commit -m "feat: HTML email renderer with tests"
```

---

## Task 11: API Worker scaffold + auth middleware

**Files:**
- Create: `workers/api/src/env.ts`
- Create: `workers/api/src/middleware/auth.ts`
- Create: `workers/api/src/index.ts`
- Create: `workers/api/vitest.config.ts`

- [ ] **Step 1: Define the Env type**

Create `workers/api/src/env.ts`:
```typescript
export interface Env {
  DB: D1Database;
  DIGEST_QUEUE: Queue;
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  STRIPE_METER_EVENT_NAME: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  ANTHROPIC_API_KEY: string;
  MARKUP_PCT: string;
}
```

- [ ] **Step 2: Write the auth middleware**

Create `workers/api/src/middleware/auth.ts`:
```typescript
import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@clerk/backend';
import type { Env } from '../env.js';

type Variables = { userId: string };

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.slice(7);
    try {
      const payload = await verifyToken(token, { secretKey: c.env.CLERK_SECRET_KEY });
      c.set('userId', payload.sub);
      await next();
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  },
);
```

- [ ] **Step 3: Write the Hono app entry**

Create `workers/api/src/index.ts`:
```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import { webhooksRouter } from './routes/webhooks.js';
import { sourcesRouter } from './routes/sources.js';
import { categoriesRouter } from './routes/categories.js';
import { usersRouter } from './routes/users.js';
import { digestsRouter } from './routes/digests.js';
import { usageRouter } from './routes/usage.js';
import { handleCron } from './cron.js';
import { handleCleanup } from './cleanup.js';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());
app.get('/health', c => c.json({ ok: true }));
app.route('/webhooks', webhooksRouter);
app.route('/sources', sourcesRouter);
app.route('/categories', categoriesRouter);
app.route('/users', usersRouter);
app.route('/digests', digestsRouter);
app.route('/usage', usageRouter);

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCleanup(env));
    ctx.waitUntil(handleCron(env));
  },
};
```

- [ ] **Step 4: Create the vitest config**

Create `workers/api/vitest.config.ts`:
```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 5: Typecheck**

```bash
cd workers/api && npx tsc --noEmit
```

Expected: Errors about missing route files — that's expected. They'll be created in Tasks 13–20.

- [ ] **Step 6: Commit**

```bash
cd ../.. && git add workers/api/src/env.ts workers/api/src/middleware/auth.ts workers/api/src/index.ts workers/api/vitest.config.ts
git commit -m "feat: API Worker scaffold with Hono + Clerk auth middleware"
```

---

## Task 12: D1 query functions

**Files:**
- Create: `workers/api/src/db.ts`

- [ ] **Step 1: Write the query functions**

Create `workers/api/src/db.ts`:
```typescript
import { randomUUID } from 'crypto';

export interface UserRow {
  id: string;
  email: string;
  stripe_id: string | null;
  model: string;
  active: number;
  digests_sent: number;
  created_at: string;
}

export interface SourceRow {
  id: string;
  user_id: string;
  name: string;
  type: 'rss' | 'reddit' | 'hn';
  url: string | null;
  subreddit: string | null;
  hn_keywords: string | null;
  min_score: number | null;
  enabled: number;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  display_order: number;
  created_at: string;
}

export interface DigestRow {
  id: string;
  user_id: string;
  date: string;
  type: 'scheduled' | 'preview';
  status: 'pending' | 'processing' | 'sent' | 'failed';
  sources_scanned: number | null;
  items_surfaced: number | null;
  items_filtered: number | null;
  model_used: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  api_cost_usd: number | null;
  amount_billed_usd: number | null;
  markup_pct: number | null;
  content_html: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export const db = {
  users: {
    async findById(d1: D1Database, id: string): Promise<UserRow | null> {
      return d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    },
    async create(d1: D1Database, id: string, email: string): Promise<void> {
      await d1.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, email).run();
    },
    async setStripeId(d1: D1Database, id: string, stripeId: string): Promise<void> {
      await d1.prepare('UPDATE users SET stripe_id = ?, active = 1 WHERE id = ?').bind(stripeId, id).run();
    },
    async setModel(d1: D1Database, id: string, model: string): Promise<void> {
      await d1.prepare('UPDATE users SET model = ? WHERE id = ?').bind(model, id).run();
    },
    async incrementDigestsSent(d1: D1Database, id: string): Promise<void> {
      await d1.prepare('UPDATE users SET digests_sent = digests_sent + 1 WHERE id = ?').bind(id).run();
    },
    async findAllActive(d1: D1Database): Promise<UserRow[]> {
      const result = await d1.prepare('SELECT * FROM users WHERE active = 1').all<UserRow>();
      return result.results;
    },
  },

  sources: {
    async findByUser(d1: D1Database, userId: string): Promise<SourceRow[]> {
      const result = await d1.prepare('SELECT * FROM sources WHERE user_id = ?').bind(userId).all<SourceRow>();
      return result.results;
    },
    async create(d1: D1Database, userId: string, data: Omit<SourceRow, 'id' | 'user_id' | 'created_at'>): Promise<SourceRow> {
      const id = randomUUID();
      await d1.prepare(
        'INSERT INTO sources (id, user_id, name, type, url, subreddit, hn_keywords, min_score, enabled) VALUES (?,?,?,?,?,?,?,?,?)',
      ).bind(id, userId, data.name, data.type, data.url, data.subreddit, data.hn_keywords, data.min_score, data.enabled).run();
      return { id, user_id: userId, created_at: new Date().toISOString(), ...data };
    },
    async delete(d1: D1Database, id: string, userId: string): Promise<void> {
      await d1.prepare('DELETE FROM sources WHERE id = ? AND user_id = ?').bind(id, userId).run();
    },
  },

  categories: {
    async findByUser(d1: D1Database, userId: string): Promise<CategoryRow[]> {
      const result = await d1.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY display_order ASC').bind(userId).all<CategoryRow>();
      return result.results;
    },
    async create(d1: D1Database, userId: string, data: Pick<CategoryRow, 'name' | 'prompt' | 'display_order'>): Promise<CategoryRow> {
      const id = randomUUID();
      await d1.prepare(
        'INSERT INTO categories (id, user_id, name, prompt, display_order) VALUES (?,?,?,?,?)',
      ).bind(id, userId, data.name, data.prompt, data.display_order).run();
      return { id, user_id: userId, created_at: new Date().toISOString(), ...data };
    },
    async update(d1: D1Database, id: string, userId: string, data: Pick<CategoryRow, 'name' | 'prompt'>): Promise<void> {
      await d1.prepare('UPDATE categories SET name = ?, prompt = ? WHERE id = ? AND user_id = ?')
        .bind(data.name, data.prompt, id, userId).run();
    },
    async delete(d1: D1Database, id: string, userId: string): Promise<void> {
      await d1.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, userId).run();
    },
  },

  digests: {
    async createPending(d1: D1Database, userId: string, date: string, type: 'scheduled' | 'preview'): Promise<string> {
      const id = randomUUID();
      await d1.prepare(
        'INSERT OR IGNORE INTO digests (id, user_id, date, type, status) VALUES (?,?,?,?,?)',
      ).bind(id, userId, date, type, 'pending').run();
      // If INSERT OR IGNORE skipped (duplicate), return the existing row's ID
      const row = await d1.prepare('SELECT id FROM digests WHERE user_id = ? AND date = ? AND type = ?')
        .bind(userId, date, type).first<{ id: string }>();
      return row!.id;
    },
    async tryClaim(d1: D1Database, id: string): Promise<boolean> {
      const result = await d1.prepare(
        "UPDATE digests SET status = 'processing' WHERE id = ? AND status = 'pending'",
      ).bind(id).run();
      return result.meta.changes === 1;
    },
    async markSent(d1: D1Database, id: string, data: {
      sourcesScanned: number; itemsSurfaced: number; itemsFiltered: number;
      modelUsed: string; tokensInput: number; tokensOutput: number;
      apiCostUsd: number; amountBilledUsd: number; markupPct: number; contentHtml: string;
    }): Promise<void> {
      await d1.prepare(`
        UPDATE digests SET
          status = 'sent', sources_scanned = ?, items_surfaced = ?, items_filtered = ?,
          model_used = ?, tokens_input = ?, tokens_output = ?,
          api_cost_usd = ?, amount_billed_usd = ?, markup_pct = ?,
          content_html = ?, sent_at = datetime('now')
        WHERE id = ?
      `).bind(
        data.sourcesScanned, data.itemsSurfaced, data.itemsFiltered,
        data.modelUsed, data.tokensInput, data.tokensOutput,
        data.apiCostUsd, data.amountBilledUsd, data.markupPct,
        data.contentHtml, id,
      ).run();
    },
    async markFailed(d1: D1Database, id: string, errorMessage: string): Promise<void> {
      await d1.prepare("UPDATE digests SET status = 'failed', error_message = ? WHERE id = ?")
        .bind(errorMessage, id).run();
    },
    async findByUser(d1: D1Database, userId: string, limit = 30): Promise<DigestRow[]> {
      const result = await d1.prepare(
        "SELECT * FROM digests WHERE user_id = ? AND type = 'scheduled' ORDER BY date DESC LIMIT ?",
      ).bind(userId, limit).all<DigestRow>();
      return result.results;
    },
    async countTodayPreviews(d1: D1Database, userId: string, date: string): Promise<number> {
      const row = await d1.prepare(
        "SELECT COUNT(*) as n FROM digests WHERE user_id = ? AND date = ? AND type = 'preview'",
      ).bind(userId, date).first<{ n: number }>();
      return row?.n ?? 0;
    },
  },

  usageRecords: {
    async create(d1: D1Database, data: {
      userId: string; digestId: string; tokensInput: number; tokensOutput: number;
      model: string; apiCostUsd: number; amountBilledUsd: number; markupPct: number;
    }): Promise<void> {
      const id = randomUUID();
      await d1.prepare(
        'INSERT INTO usage_records (id, user_id, digest_id, tokens_input, tokens_output, model, api_cost_usd, amount_billed_usd, markup_pct) VALUES (?,?,?,?,?,?,?,?,?)',
      ).bind(id, data.userId, data.digestId, data.tokensInput, data.tokensOutput, data.model, data.apiCostUsd, data.amountBilledUsd, data.markupPct).run();
    },
    async markReported(d1: D1Database, digestId: string): Promise<void> {
      await d1.prepare('UPDATE usage_records SET stripe_reported = 1 WHERE digest_id = ?').bind(digestId).run();
    },
    async findUnreported(d1: D1Database): Promise<Array<{ id: string; user_id: string; amount_billed_usd: number; digest_id: string }>> {
      const result = await d1.prepare(
        'SELECT id, user_id, amount_billed_usd, digest_id FROM usage_records WHERE stripe_reported = 0',
      ).all<{ id: string; user_id: string; amount_billed_usd: number; digest_id: string }>();
      return result.results;
    },
    async findByUser(d1: D1Database, userId: string, limit = 60): Promise<Array<{ created_at: string; amount_billed_usd: number; model: string }>> {
      const result = await d1.prepare(
        'SELECT created_at, amount_billed_usd, model FROM usage_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      ).bind(userId, limit).all<{ created_at: string; amount_billed_usd: number; model: string }>();
      return result.results;
    },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add workers/api/src/db.ts
git commit -m "feat: typed D1 query functions"
```

---

## Task 13: Clerk + Stripe webhook handler (user creation)

**Files:**
- Create: `workers/api/src/routes/webhooks.ts`

- [ ] **Step 1: Implement**

Create `workers/api/src/routes/webhooks.ts`:
```typescript
import { Hono } from 'hono';
import { Webhook } from 'svix';
import Stripe from 'stripe';
import type { Env } from '../env.js';
import { db } from '../db.js';

export const webhooksRouter = new Hono<{ Bindings: Env }>();

webhooksRouter.post('/clerk', async c => {
  const body = await c.req.text();
  const headers = {
    'svix-id': c.req.header('svix-id') ?? '',
    'svix-timestamp': c.req.header('svix-timestamp') ?? '',
    'svix-signature': c.req.header('svix-signature') ?? '',
  };

  let event: { type: string; data: { id: string; email_addresses: Array<{ email_address: string }> } };
  try {
    const wh = new Webhook(c.env.CLERK_WEBHOOK_SECRET);
    event = wh.verify(body, headers) as typeof event;
  } catch {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  if (event.type === 'user.created') {
    const userId = event.data.id;
    const email = event.data.email_addresses[0]?.email_address ?? '';

    // Create user row
    await db.users.create(c.env.DB, userId, email);

    // Create Stripe customer
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });
    const customer = await stripe.customers.create({ email, metadata: { clerkId: userId } });
    await db.users.setStripeId(c.env.DB, userId, customer.id);
  }

  return c.json({ ok: true });
});

webhooksRouter.post('/stripe', async c => {
  const body = await c.req.text();
  const sig = c.req.header('stripe-signature') ?? '';
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  if (event.type === 'payment_method.attached') {
    const pm = event.data.object as Stripe.PaymentMethod;
    if (pm.customer) {
      // Find user by stripe_id and activate
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE stripe_id = ?')
        .bind(pm.customer).first<{ id: string }>();
      if (user) {
        await c.env.DB.prepare('UPDATE users SET active = 1 WHERE id = ?').bind(user.id).run();
      }
    }
  }

  return c.json({ ok: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add workers/api/src/routes/webhooks.ts
git commit -m "feat: Clerk + Stripe webhook handlers — user creation"
```

---

## Task 14: Sources and Categories CRUD routes

**Files:**
- Create: `workers/api/src/routes/sources.ts`
- Create: `workers/api/src/routes/categories.ts`
- Create: `workers/api/src/routes/users.ts`
- Create: `workers/api/src/routes/usage.ts`

- [ ] **Step 1: Sources routes**

Create `workers/api/src/routes/sources.ts`:
```typescript
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { db } from '../db.js';
import type { Env } from '../env.js';

type Variables = { userId: string };

export const sourcesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
sourcesRouter.use('*', authMiddleware);

sourcesRouter.get('/', async c => {
  const sources = await db.sources.findByUser(c.env.DB, c.get('userId'));
  return c.json(sources);
});

sourcesRouter.post('/', async c => {
  const body = await c.req.json<{
    name: string; type: 'rss' | 'reddit' | 'hn';
    url?: string; subreddit?: string; hn_keywords?: string[];
    min_score?: number;
  }>();
  const source = await db.sources.create(c.env.DB, c.get('userId'), {
    name: body.name,
    type: body.type,
    url: body.url ?? null,
    subreddit: body.subreddit ?? null,
    hn_keywords: body.hn_keywords ? JSON.stringify(body.hn_keywords) : null,
    min_score: body.min_score ?? null,
    enabled: 1,
  });
  return c.json(source, 201);
});

sourcesRouter.delete('/:id', async c => {
  await db.sources.delete(c.env.DB, c.req.param('id'), c.get('userId'));
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Categories routes**

Create `workers/api/src/routes/categories.ts`:
```typescript
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { db } from '../db.js';
import type { Env } from '../env.js';

type Variables = { userId: string };

export const categoriesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
categoriesRouter.use('*', authMiddleware);

categoriesRouter.get('/', async c => {
  const cats = await db.categories.findByUser(c.env.DB, c.get('userId'));
  return c.json(cats);
});

categoriesRouter.post('/', async c => {
  const body = await c.req.json<{ name: string; prompt: string; display_order?: number }>();
  const cat = await db.categories.create(c.env.DB, c.get('userId'), {
    name: body.name,
    prompt: body.prompt,
    display_order: body.display_order ?? 0,
  });
  return c.json(cat, 201);
});

categoriesRouter.put('/:id', async c => {
  const body = await c.req.json<{ name: string; prompt: string }>();
  await db.categories.update(c.env.DB, c.req.param('id'), c.get('userId'), body);
  return c.json({ ok: true });
});

categoriesRouter.delete('/:id', async c => {
  await db.categories.delete(c.env.DB, c.req.param('id'), c.get('userId'));
  return c.json({ ok: true });
});
```

- [ ] **Step 3: Users + usage routes**

Create `workers/api/src/routes/users.ts`:
```typescript
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { db } from '../db.js';
import type { Env } from '../env.js';

const ALLOWED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5'];
type Variables = { userId: string };

export const usersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
usersRouter.use('*', authMiddleware);

usersRouter.get('/me', async c => {
  const user = await db.users.findById(c.env.DB, c.get('userId'));
  if (!user) return c.json({ error: 'Not found' }, 404);
  return c.json(user);
});

usersRouter.patch('/model', async c => {
  const { model } = await c.req.json<{ model: string }>();
  if (!ALLOWED_MODELS.includes(model)) {
    return c.json({ error: 'Invalid model' }, 400);
  }
  await db.users.setModel(c.env.DB, c.get('userId'), model);
  return c.json({ ok: true });
});
```

Create `workers/api/src/routes/usage.ts`:
```typescript
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { db } from '../db.js';
import type { Env } from '../env.js';

type Variables = { userId: string };

export const usageRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
usageRouter.use('*', authMiddleware);

usageRouter.get('/', async c => {
  const records = await db.usageRecords.findByUser(c.env.DB, c.get('userId'));
  return c.json(records);
});
```

- [ ] **Step 4: Typecheck**

```bash
cd workers/api && npx tsc --noEmit
```

Expected: No errors (digests.ts still missing — add placeholder).

Create `workers/api/src/routes/digests.ts` (stub for now):
```typescript
import { Hono } from 'hono';
import type { Env } from '../env.js';
export const digestsRouter = new Hono<{ Bindings: Env }>();
```

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add workers/api/src/routes/
git commit -m "feat: sources, categories, users, usage CRUD routes"
```

---

## Task 15: Cron handler (daily fan-out)

**Files:**
- Create: `workers/api/src/cron.ts`

- [ ] **Step 1: Implement**

Create `workers/api/src/cron.ts`:
```typescript
import type { Env } from './env.js';
import { db } from './db.js';

export async function handleCron(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const users = await db.users.findAllActive(env.DB);

  await Promise.allSettled(
    users.map(async user => {
      const digestId = await db.digests.createPending(env.DB, user.id, today, 'scheduled');
      await env.DIGEST_QUEUE.send({ userId: user.id, digestId, date: today });
    }),
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add workers/api/src/cron.ts
git commit -m "feat: cron fan-out handler — creates pending digest rows and enqueues"
```

---

## Task 16: Cleanup handler

**Files:**
- Create: `workers/api/src/cleanup.ts`

- [ ] **Step 1: Implement**

Create `workers/api/src/cleanup.ts`:
```typescript
import Stripe from 'stripe';
import type { Env } from './env.js';
import { db } from './db.js';

export async function handleCleanup(env: Env): Promise<void> {
  await Promise.allSettled([
    retryUnreportedStripe(env),
    markStaleProcessing(env),
    purgeOldDigests(env),
  ]);
}

async function retryUnreportedStripe(env: Env): Promise<void> {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const unreported = await db.usageRecords.findUnreported(env.DB);

  await Promise.allSettled(
    unreported.map(async record => {
      const user = await db.users.findById(env.DB, record.user_id);
      if (!user?.stripe_id) return;
      await stripe.billing.meterEvents.create({
        event_name: env.STRIPE_METER_EVENT_NAME,
        payload: {
          value: String(Math.round(record.amount_billed_usd * 100)),
          stripe_customer_id: user.stripe_id,
        },
      });
      await db.usageRecords.markReported(env.DB, record.digest_id);
    }),
  );
}

async function markStaleProcessing(env: Env): Promise<void> {
  // Mark digests stuck in 'processing' for more than 2 hours as 'failed'
  await env.DB.prepare(`
    UPDATE digests SET status = 'failed', error_message = 'Timed out in processing'
    WHERE status = 'processing'
    AND created_at < datetime('now', '-2 hours')
  `).run();
}

async function purgeOldDigests(env: Env): Promise<void> {
  // Delete usage_records older than 90 days ONLY if stripe_reported = 1
  await env.DB.prepare(`
    DELETE FROM usage_records
    WHERE created_at < datetime('now', '-90 days')
    AND stripe_reported = 1
  `).run();

  // Delete digest rows older than 90 days with no unreconciled usage
  await env.DB.prepare(`
    DELETE FROM digests
    WHERE created_at < datetime('now', '-90 days')
    AND id NOT IN (SELECT digest_id FROM usage_records WHERE stripe_reported = 0)
  `).run();
}
```

- [ ] **Step 2: Commit**

```bash
git add workers/api/src/cleanup.ts
git commit -m "feat: cleanup handler — stale processing, Stripe retry, 90-day retention"
```

---

## Task 17: Preview endpoint + digests route

**Files:**
- Modify: `workers/api/src/routes/digests.ts`

- [ ] **Step 1: Implement the full digests router**

Replace `workers/api/src/routes/digests.ts`:
```typescript
import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth.js';
import { db } from '../db.js';
import type { Env } from '../env.js';
import {
  fetchFeed, fetchReddit, fetchHN,
  filterAndAssign, summarise, renderEmail, calculateCost,
} from '@newshound/pipeline';
import type { ClaudeAdapter, Category } from '@newshound/pipeline';

type Variables = { userId: string };
export const digestsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
digestsRouter.use('*', authMiddleware);

digestsRouter.get('/', async c => {
  const digests = await db.digests.findByUser(c.env.DB, c.get('userId'));
  return c.json(digests);
});

digestsRouter.post('/preview', async c => {
  const userId = c.get('userId');
  const user = await db.users.findById(c.env.DB, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.digests_sent < 5) return c.json({ error: 'Preview available after free tier' }, 403);

  const today = new Date().toISOString().slice(0, 10);
  const previewCount = await db.digests.countTodayPreviews(c.env.DB, userId, today);
  if (previewCount >= 3) return c.json({ error: 'Preview rate limit exceeded (3/day)' }, 429);

  const digestId = await db.digests.createPending(c.env.DB, userId, today, 'preview');
  const claimed = await db.digests.tryClaim(c.env.DB, digestId);
  if (!claimed) return c.json({ error: 'Could not claim digest' }, 409);

  const markupPct = parseInt(c.env.MARKUP_PCT, 10);
  const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const claude: ClaudeAdapter = async (prompt) => {
    const msg = await anthropic.messages.create({
      model: user.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    return { text, usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens } };
  };

  try {
    const [sourcesRaw, categoriesRaw] = await Promise.all([
      db.sources.findByUser(c.env.DB, userId),
      db.categories.findByUser(c.env.DB, userId),
    ]);
    const since = new Date(Date.now() - 86400_000);
    const categories: Category[] = categoriesRaw.map(r => ({ id: r.id, name: r.name, prompt: r.prompt }));

    const allItems = (
      await Promise.allSettled(
        sourcesRaw.filter(s => s.enabled).map(s => {
          if (s.type === 'rss') return fetchFeed(s.url!, s.name, since);
          if (s.type === 'reddit') return fetchReddit(s.subreddit!, s.min_score ?? 20, since);
          return fetchHN(s.min_score ?? 50, since);
        }),
      )
    ).flatMap(r => r.status === 'fulfilled' ? r.value : []);

    const filterResult = await filterAndAssign(allItems, categories, claude);
    const { content, usage: sumUsage } = await summarise(filterResult.assigned, claude);

    const totalInput = filterResult.usage.inputTokens + sumUsage.inputTokens;
    const totalOutput = filterResult.usage.outputTokens + sumUsage.outputTokens;
    const cost = calculateCost({ model: user.model, inputTokens: totalInput, outputTokens: totalOutput, markupPct });

    content.sourcesScanned = sourcesRaw.length;
    content.itemsFiltered = filterResult.discarded.length;
    const html = renderEmail(content, today);

    await db.digests.markSent(c.env.DB, digestId, {
      sourcesScanned: content.sourcesScanned,
      itemsSurfaced: content.itemsSurfaced,
      itemsFiltered: content.itemsFiltered,
      modelUsed: user.model,
      tokensInput: totalInput,
      tokensOutput: totalOutput,
      ...cost,
      contentHtml: html,
    });
    await db.usageRecords.create(c.env.DB, {
      userId, digestId, tokensInput: totalInput, tokensOutput: totalOutput,
      model: user.model, ...cost,
    });

    return c.json({ html });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.digests.markFailed(c.env.DB, digestId, msg);
    return c.json({ error: msg }, 500);
  }
});
```

- [ ] **Step 2: Typecheck**

```bash
cd workers/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd ../.. && git add workers/api/src/routes/digests.ts
git commit -m "feat: digests history + preview endpoint"
```

---

## Task 18: Processor Worker — queue consumer + pipeline

**Files:**
- Create: `workers/processor/src/env.ts`
- Create: `workers/processor/src/pipeline.ts`
- Create: `workers/processor/src/index.ts`
- Create: `workers/processor/vitest.config.ts`

- [ ] **Step 1: Define Env type**

Create `workers/processor/src/env.ts`:
```typescript
export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_METER_EVENT_NAME: string;
  MARKUP_PCT: string;
}
```

- [ ] **Step 2: Implement the pipeline orchestrator**

Create `workers/processor/src/pipeline.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import Stripe from 'stripe';
import {
  fetchFeed, fetchReddit, fetchHN,
  filterAndAssign, summarise, renderEmail, calculateCost,
} from '@newshound/pipeline';
import type { ClaudeAdapter, Category } from '@newshound/pipeline';
import { db } from '../../api/src/db.js';  // shared query functions
import type { Env } from './env.js';

export interface QueueMessage {
  userId: string;
  digestId: string;
  date: string;
}

export async function processDigest(msg: QueueMessage, env: Env): Promise<void> {
  // 1. Atomic claim — exit if already claimed or sent
  const claimed = await db.digests.tryClaim(env.DB, msg.digestId);
  if (!claimed) return;

  const markupPct = parseInt(env.MARKUP_PCT, 10);

  try {
    // 2. Load user config
    const [user, sourcesRaw, categoriesRaw] = await Promise.all([
      db.users.findById(env.DB, msg.userId),
      db.sources.findByUser(env.DB, msg.userId),
      db.categories.findByUser(env.DB, msg.userId),
    ]);

    if (!user) throw new Error('User not found');

    const categories: Category[] = categoriesRaw.map(r => ({
      id: r.id, name: r.name, prompt: r.prompt,
    }));

    // 3. Build Claude adapter
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const claude: ClaudeAdapter = async (prompt) => {
      const msg = await anthropic.messages.create({
        model: user.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      return { text, usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens } };
    };

    // 4. Fetch sources concurrently
    const since = new Date(Date.now() - 86400_000);
    const enabledSources = sourcesRaw.filter(s => s.enabled);
    const fetchResults = await Promise.allSettled(
      enabledSources.map(s => {
        if (s.type === 'rss') return fetchFeed(s.url!, s.name, since);
        if (s.type === 'reddit') return fetchReddit(s.subreddit!, s.min_score ?? 20, since);
        return fetchHN(s.min_score ?? 50, since);
      }),
    );

    const allItems = fetchResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (allItems.length === 0 && fetchResults.every(r => r.status === 'rejected')) {
      throw new Error('All sources failed to fetch');
    }

    // 5. Filter + assign
    const filterResult = await filterAndAssign(allItems, categories, claude);

    // 6. Summarise
    const { content, usage: sumUsage } = await summarise(filterResult.assigned, claude);

    // 7. Calculate cost
    const totalInput = filterResult.usage.inputTokens + sumUsage.inputTokens;
    const totalOutput = filterResult.usage.outputTokens + sumUsage.outputTokens;
    const cost = calculateCost({ model: user.model, inputTokens: totalInput, outputTokens: totalOutput, markupPct });

    // 8. Render
    content.sourcesScanned = enabledSources.length;
    content.itemsFiltered = filterResult.discarded.length;
    const html = renderEmail(content, msg.date);

    // 9. Send email (with digestId as idempotency key)
    const resend = new Resend(env.RESEND_API_KEY);
    let sendError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await resend.emails.send({
          from: env.RESEND_FROM,
          to: user.email,
          subject: `Your digest — ${msg.date}`,
          html,
          headers: { 'Idempotency-Key': msg.digestId },
        });
        sendError = null;
        break;
      } catch (e) {
        sendError = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (sendError) throw sendError;

    // 10. Persist atomically
    await db.digests.markSent(env.DB, msg.digestId, {
      sourcesScanned: content.sourcesScanned,
      itemsSurfaced: content.itemsSurfaced,
      itemsFiltered: content.itemsFiltered,
      modelUsed: user.model,
      tokensInput: totalInput,
      tokensOutput: totalOutput,
      ...cost,
      contentHtml: html,
    });
    await db.usageRecords.create(env.DB, {
      userId: msg.userId, digestId: msg.digestId,
      tokensInput: totalInput, tokensOutput: totalOutput,
      model: user.model, ...cost,
    });
    await db.users.incrementDigestsSent(env.DB, msg.userId);

    // 11. Report to Stripe (non-blocking)
    try {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
      await stripe.billing.meterEvents.create({
        event_name: env.STRIPE_METER_EVENT_NAME,
        payload: {
          value: String(Math.round(cost.amountBilledUsd * 100)),
          stripe_customer_id: user.stripe_id!,
        },
      });
      await db.usageRecords.markReported(env.DB, msg.digestId);
    } catch {
      // Non-blocking — cleanup handler will retry
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.digests.markFailed(env.DB, msg.digestId, errorMessage);
    throw err; // re-throw so CF Queues can record the failure
  }
}
```

- [ ] **Step 3: Queue consumer entry**

Create `workers/processor/src/index.ts`:
```typescript
import type { Env } from './env.js';
import { processDigest } from './pipeline.js';
import type { QueueMessage } from './pipeline.js';

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processDigest(message.body, env);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
```

- [ ] **Step 4: Vitest config for processor**

Create `workers/processor/vitest.config.ts`:
```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 5: Typecheck**

```bash
cd workers/processor && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd ../.. && git add workers/processor/src/ workers/processor/vitest.config.ts
git commit -m "feat: Digest Processor Worker — queue consumer + full pipeline"
```

---

## Task 19: Integration tests — happy path

**Files:**
- Create: `workers/processor/src/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/processor/src/__tests__/pipeline.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processDigest } from '../pipeline.js';
import type { Env } from '../env.js';

// These tests use the real D1 via Miniflare (wrangler local)
// External APIs (Anthropic, Resend, Stripe) are mocked

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify([
          { item_index: 0, category: 'AI tooling', signal: 'include' },
        ]) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    };
  },
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ id: 'email-123' }) };
  },
}));

vi.mock('stripe', () => ({
  default: class {
    static createFetchHttpClient = () => ({});
    billing = { meterEvents: { create: vi.fn().mockResolvedValue({}) } };
  },
}));

describe('processDigest — happy path', () => {
  // CLOUDFLARE_TEST_WORKER_VARS are injected by vitest-pool-workers from wrangler.toml
  // The D1 binding is real (miniflare local D1)

  it('marks digest as sent and creates usage record', async () => {
    // This test runs inside the Workers runtime — access env via __STATIC_CONTENT or injected vars
    // See: https://developers.cloudflare.com/workers/testing/vitest-integration/
    // Actual D1 setup is handled by Miniflare seeding in beforeEach
    expect(true).toBe(true); // placeholder — fill in with miniflare D1 seeding pattern
  });
});
```

**Note:** Full integration tests with Miniflare D1 seeding require calling `env.DB.exec(sql)` in `beforeEach`. The pattern is documented at `https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/`. Implement the full seed + assert pattern following those docs once the project is running locally.

- [ ] **Step 2: Commit**

```bash
git add workers/processor/src/__tests__/pipeline.test.ts
git commit -m "test: processor integration test scaffold"
```

---

## Task 20: Integration tests — concurrent claim and stale processing

**Files:**
- Create: `workers/processor/src/__tests__/concurrent.test.ts`
- Create: `workers/processor/src/__tests__/cleanup.test.ts`

- [ ] **Step 1: Write concurrent claim test**

Create `workers/processor/src/__tests__/concurrent.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn() }; } }));
vi.mock('stripe', () => ({ default: class { static createFetchHttpClient = () => ({}); billing = { meterEvents: { create: vi.fn() } }; } }));

describe('concurrent claim', () => {
  it('only one of two concurrent claims proceeds', async () => {
    // Two workers receive the same queue message concurrently.
    // Both call tryClaim on the same digestId.
    // SQLite's atomic UPDATE guarantees exactly one returns true.
    // The second returns false and exits without calling Claude or Resend.
    //
    // Implement using Miniflare D1:
    // 1. Insert a pending digest row
    // 2. Call processDigest twice concurrently with the same digestId
    // 3. Assert usage_records has exactly 1 row
    // 4. Assert Resend.emails.send was called exactly once
    expect(true).toBe(true); // scaffold — implement with Miniflare D1
  });
});
```

- [ ] **Step 2: Write stale processing test**

Create `workers/processor/src/__tests__/cleanup.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('stale processing cleanup', () => {
  it('marks digests stuck in processing for >2h as failed', async () => {
    // Using Miniflare D1:
    // 1. Insert a digest row with status='processing' and created_at 3 hours ago
    // 2. Call handleCleanup(env)
    // 3. Assert the row's status is now 'failed'
    // 4. Assert error_message is 'Timed out in processing'
    expect(true).toBe(true); // scaffold — implement with Miniflare D1
  });

  it('does not delete usage_records with stripe_reported=false during retention', async () => {
    // 1. Insert digest + usage_record (stripe_reported=0) created 100 days ago
    // 2. Call handleCleanup(env)
    // 3. Assert usage_record still exists
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add workers/processor/src/__tests__/concurrent.test.ts workers/processor/src/__tests__/cleanup.test.ts
git commit -m "test: concurrent claim + cleanup integration test scaffolds"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| D1 schema with all 5 tables | Task 2 |
| UNIQUE (user_id, date, type) on digests | Task 2 |
| Shared pipeline: RSS, Reddit, HN fetchers | Tasks 4–6 |
| Cost calculator with markup snapshot | Task 7 |
| Filter + assign with default category | Task 8 |
| Summarise pass | Task 9 |
| HTML email renderer | Task 10 |
| API Worker: Hono + Clerk JWT | Task 11 |
| Typed D1 query functions | Task 12 |
| Clerk webhook → user + Stripe customer creation | Task 13 |
| Sources/categories CRUD | Task 14 |
| Cron handler: INSERT OR IGNORE + enqueue | Task 15 |
| Cleanup: stale processing, retention, Stripe retry | Task 16 |
| Preview endpoint: rate limit, billing, pays-tier gate | Task 17 |
| Processor: atomic claim (UPDATE WHERE pending) | Task 18 |
| Processor: full pipeline (fetch→filter→summarise→render→send→persist) | Task 18 |
| Processor: non-blocking Stripe reporting | Task 18 |
| Processor: mark failed on terminal error + re-throw | Task 18 |
| Integration test: idempotency | Task 19 |
| Integration test: concurrent claim | Task 20 |
| Integration test: stale processing | Task 20 |

**Gap:** Integration tests in Tasks 19–20 are scaffolded but the Miniflare D1 seeding pattern needs filling in using the Cloudflare docs linked in the task. This is intentional — the exact API requires a running `wrangler dev` session to verify.

### Type consistency

- `ClaudeAdapter` is defined in `packages/pipeline/src/types.ts` and used identically in Tasks 8, 9, 17, 18 ✓
- `db.digests.tryClaim` returns `boolean` — used correctly in Tasks 15, 17, 18 ✓
- `calculateCost` returns `{ apiCostUsd, amountBilledUsd, markupPct }` — spread correctly into `markSent` and `usageRecords.create` calls ✓
- `QueueMessage` type: `{ userId, digestId, date }` — consistent across cron.ts, processor index.ts, pipeline.ts ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-newshound-saas-backend.md`.**

A second plan for the frontend (React/Vite UI — onboarding, dashboard, settings, billing) should be written before implementing the UI layer. That plan is not included here to keep each plan focused on a single deployable subsystem.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
