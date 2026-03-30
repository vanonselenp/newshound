# PRD: AI Digest

## Introduction

A scheduled TypeScript CLI script (`newshound`) that aggregates AI tooling content from curated RSS/Atom feeds and community sources (Hacker News, Reddit), filters it through Claude for practical signal, and writes a daily markdown digest to an Obsidian vault synced via Dropbox.

The script runs via macOS launchd. It tracks its last successful run in a local state file and fetches all content published since then — handling catch-up automatically when the laptop was asleep.

---

## Goals

- Produce a daily digest of high-signal AI tooling content without manual curation
- Filter out noise (hype, benchmarks, company drama) and surface only actionable content
- Write output directly to an Obsidian vault as a markdown file with consistent frontmatter
- Handle missed runs gracefully by catching up with a single combined digest
- Keep sources configurable via a single array — no code changes beyond config to add/remove a source

---

## User Stories

### US-001: Project scaffold and tooling
**Description:** As a developer, I need the project scaffolded with TypeScript, Vitest, and pnpm so I can begin TDD development.

**Acceptance Criteria:**
- [ ] `package.json` with pnpm, TypeScript, Vitest, ESLint configured
- [ ] `tsconfig.json` targeting Node.js with strict mode enabled
- [ ] `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all pass on empty project
- [ ] `src/` and `src/__tests__/` directories exist

---

### US-002: Source configuration
**Description:** As a developer, I want a single typed config array defining all sources so that adding or removing a source requires editing only that array.

**Acceptance Criteria:**
- [ ] `src/config.ts` exports a `SOURCES` array and a `Config` type
- [ ] Each source has: `name`, `type` (`rss` | `atom` | `reddit` | `hn`), `url` or `subreddit` or `hnQuery`, `minScore` (optional), `tier` (`curated` | `community`)
- [ ] Config includes all 11 sources from the spec (6 curated, 5 community)
- [ ] Config includes `vaultPath` (string), `stateFilePath` (string, default `~/.ai-digest-state.json`), `lookbackDays` (number, default 3)
- [ ] Typecheck passes

---

### US-003: State file — read last run
**Description:** As the script, I need to know when I last ran successfully so I can fetch only new content.

**Acceptance Criteria:**
- [ ] `readLastRun(stateFilePath: string): Promise<Date>` returns the stored ISO timestamp as a `Date`
- [ ] If the file does not exist, returns `Date.now() - lookbackDays * 86400000` (configurable, default 3 days)
- [ ] If the file exists but is malformed, throws a descriptive error
- [ ] Unit tested with temp files and missing-file case

---

### US-004: State file — write last run
**Description:** As the script, I need to persist the current run time after a successful digest so catch-up works correctly next time.

**Acceptance Criteria:**
- [ ] `writeLastRun(stateFilePath: string, date: Date): Promise<void>` writes `{ "lastRun": "<ISO string>" }`
- [ ] Overwrites any existing file
- [ ] Unit tested: written value can be read back by `readLastRun`

---

### US-005: RSS/Atom feed fetcher
**Description:** As the pipeline, I need to fetch and parse RSS and Atom feeds into a normalised `FeedItem` shape.

**Acceptance Criteria:**
- [ ] `fetchFeed(url: string): Promise<FeedItem[]>` handles both RSS 2.0 and Atom 1.0
- [ ] `FeedItem` has: `title: string`, `url: string`, `publishedAt: Date`, `description: string`, `sourceName: string`
- [ ] Items older than `since: Date` parameter are filtered out
- [ ] Uses built-in `fetch` and string XML parsing (no `xml2js` or heavy parser)
- [ ] Unit tested with fixture XML strings (no network calls in tests)

---

### US-006: Reddit community fetcher
**Description:** As the pipeline, I need to fetch top posts from Reddit subreddits using the public JSON feed, filtered by minimum score.

**Acceptance Criteria:**
- [ ] `fetchReddit(subreddit: string, minScore: number, since: Date): Promise<FeedItem[]>` fetches `https://www.reddit.com/r/{subreddit}/top.json?t=day&limit=25`
- [ ] Filters posts below `minScore`
- [ ] Filters posts older than `since`
- [ ] Maps to `FeedItem` (uses `selftext` or empty string for description)
- [ ] Unit tested with fixture JSON (no network calls in tests)

---

### US-007: Hacker News fetcher
**Description:** As the pipeline, I need to search HN via the Algolia API for AI-relevant posts with a minimum score.

**Acceptance Criteria:**
- [ ] `fetchHN(minScore: number, since: Date): Promise<FeedItem[]>` queries Algolia HN search API with relevant keywords (e.g. `AI`, `LLM`, `Claude`, `cursor`, `copilot`)
- [ ] Filters hits below `minScore` (50 per spec)
- [ ] Filters items older than `since`
- [ ] Maps to `FeedItem`
- [ ] Unit tested with fixture JSON (no network calls in tests)

---

### US-008: Source orchestrator
**Description:** As the pipeline, I need a single function that fetches all configured sources and returns a unified list of items.

**Acceptance Criteria:**
- [ ] `fetchAllSources(sources: Source[], since: Date): Promise<FeedItem[]>` iterates sources and dispatches to the correct fetcher by type
- [ ] Sources that fail (network error) are retried once; on second failure, the source is skipped and a warning is collected
- [ ] Returns `{ items: FeedItem[], warnings: string[] }`
- [ ] Each `FeedItem` carries its `tier` (`curated` | `community`) from the source config
- [ ] Unit tested with mocked fetchers

---

### US-009: Claude adapter
**Description:** As the pipeline, I need a thin adapter over `claude --print` so the LLM calls are mockable in tests.

**Acceptance Criteria:**
- [ ] `claudePrompt(prompt: string): Promise<string>` shells out to `claude --print -` passing the prompt via stdin
- [ ] Throws with a descriptive error if the process exits non-zero
- [ ] The adapter is a single injectable function (`(prompt: string) => Promise<string>`) — all consumers accept it as a parameter
- [ ] Unit tests for the pipeline use a mock/stub in place of the real adapter

---

### US-010: Filter pass — signal scoring via Claude
**Description:** As the pipeline, I need to send all fetched items to Claude in one prompt and get back which ones are high signal.

**Acceptance Criteria:**
- [ ] `filterItems(items: FeedItem[], claude: ClaudeAdapter): Promise<FilterResult>` sends all items in one structured prompt
- [ ] Prompt instructs Claude to: skip the relevance check for `curated` items; apply two-pass (relevance then signal) for `community` items; use the high/low signal criteria from the spec
- [ ] Claude returns a JSON array of `{ index: number, signal: 'high' | 'worth_knowing' | 'low', reason: string }`
- [ ] `FilterResult` contains `highSignal: FeedItem[]`, `worthKnowing: FeedItem[]`, `filtered: FeedItem[]`
- [ ] Unit tested with a mock Claude adapter returning known JSON

---

### US-011: Summarise pass — digest content via Claude
**Description:** As the pipeline, I need to send only high-signal items to Claude and get back structured summaries for the digest body.

**Acceptance Criteria:**
- [ ] `summariseItems(items: FilterResult, recentDigests: string[], claude: ClaudeAdapter): Promise<DigestContent>` sends high-signal and worth-knowing items in one prompt
- [ ] Prompt includes recent digest summaries (last 7–14 days) as context for related-link detection
- [ ] Claude returns structured JSON: `{ readInFull: SummaryItem[], highSignal: SummaryItem[], worthKnowing: SummaryItem[], tags: string[], related: string[] }`
- [ ] `SummaryItem` has `title`, `url`, `source`, `summary`, `takeaway` (optional for worthKnowing)
- [ ] Tags are constrained to the spec's fixed vocabulary (enforced in the prompt)
- [ ] Unit tested with mock adapter

---

### US-012: Read recent digests from vault
**Description:** As the summarise pass, I need to read recent digest files from the vault to provide Claude with context for related-link detection.

**Acceptance Criteria:**
- [ ] `readRecentDigests(vaultPath: string, days: number): Promise<string[]>` reads digest files from the last N days
- [ ] Returns array of strings (each file's content, or a short summary of title + tags)
- [ ] Handles missing vault directory or missing digest files gracefully (returns empty array)
- [ ] Unit tested with temp directory fixtures

---

### US-013: Digest renderer
**Description:** As the pipeline, I need to render a `DigestContent` object into the final markdown string with correct frontmatter.

**Acceptance Criteria:**
- [ ] `renderDigest(content: DigestContent, meta: DigestMeta): string` returns a valid markdown string
- [ ] Frontmatter includes: `date`, `period` (only if catch-up), `tags` (always includes `ai-digest`), `sources_scanned`, `items_surfaced`, `items_filtered`, `related` (only if non-empty)
- [ ] Body structure: `## Read in full`, `## High signal`, `## Worth knowing`, footer line `*N items filtered as low-signal.*`
- [ ] If `items_surfaced === 0`, renders the quiet-day stub instead
- [ ] Unit tested with snapshot or explicit string assertions

---

### US-014: Digest writer
**Description:** As the pipeline, I need to write the rendered digest to the correct path in the Obsidian vault.

**Acceptance Criteria:**
- [ ] `writeDigest(vaultPath: string, date: Date, content: string): Promise<string>` writes to `<vaultPath>/AI-Digest/YYYY-MM-DD.md`
- [ ] Creates `AI-Digest/` directory if it doesn't exist
- [ ] Returns the full path written
- [ ] Unit tested with a temp directory

---

### US-015: Main entrypoint — orchestration
**Description:** As a user, I need a single executable entry point that runs the full pipeline end-to-end.

**Acceptance Criteria:**
- [ ] `src/index.ts` is the CLI entry point, executable via `npx tsx src/index.ts` or compiled output
- [ ] Orchestrates: read state → fetch sources → filter → summarise → render → write → update state
- [ ] Logs progress to stderr (not stdout) so stdout is clean
- [ ] On any unrecoverable error, exits with code 1 and a clear message
- [ ] Source fetch warnings are noted in stderr but do not abort the run
- [ ] Integration test (with all adapters mocked) verifies the happy path and the catch-up path

---

### US-016: launchd plist
**Description:** As a user, I need a launchd plist so the script runs daily without manual invocation.

**Acceptance Criteria:**
- [ ] `install/com.newshound.daily.plist` is a valid macOS launchd plist
- [ ] Scheduled for a sensible daily time (e.g. 08:00)
- [ ] `README.md` includes copy-paste install instructions (`cp`, `launchctl load`)
- [ ] Plist uses the compiled output path, not `tsx` (i.e. `npm run build` first)

---

## Functional Requirements

- **FR-1:** All 11 sources from the spec must be present in the default config
- **FR-2:** Community sources apply two-pass filtering (relevance → signal); curated sources apply signal evaluation only
- **FR-3:** Failed source fetches are retried once; on second failure the source is skipped with a warning, run continues
- **FR-4:** Filtering and summarisation each use exactly one `claude --print` call
- **FR-5:** State is persisted only after a successful digest write; a failed run does not advance the state
- **FR-6:** Catch-up runs produce one digest file (not one per missed day), with `period:` frontmatter
- **FR-7:** Tags must be drawn from the fixed vocabulary; Claude is instructed not to invent new tags
- **FR-8:** Related digest links are Obsidian wikilinks (`[[YYYY-MM-DD]]`), added only when there is a direct thematic connection (not just overlapping tags)
- **FR-9:** Config lives at `~/.ai-digest-config.json`; if absent, the script prints a setup message and exits 1
- **FR-10:** RSS/Atom parsing uses only built-in `fetch` and string/regex parsing — no xml2js or equivalent

---

## Non-Goals

- Web UI, dashboard, or notifications
- Full-text article fetching (summaries are based on RSS descriptions and post content only)
- GitHub Trending or Google DeepMind blog sources (add later)
- Multi-user support
- Automated tag vocabulary expansion
- Windows or Linux scheduling (launchd is macOS-only)

---

## Technical Considerations

- **Language:** TypeScript, strict mode, targeting Node.js 20+
- **Package manager:** pnpm
- **Test framework:** Vitest
- **LLM:** `claude --print` via stdin — wrapped in a mockable adapter function
- **No heavy dependencies:** XML parsing via string/regex; HTTP via built-in `fetch`
- **Claude responses must be JSON:** Prompts instruct Claude to return only valid JSON; the adapter should handle parse errors gracefully
- **Config location:** `~/.ai-digest-config.json` (user-local, not in repo). A `config.example.json` is committed.

---

## Success Metrics

Per the spec, after one week of use:
1. A digest exists for each day the laptop was on (or a combined catch-up)
2. ≥70% of "high signal" items feel genuinely useful
3. "Read in full" picks are consistently worth clicking
4. Tags are stable enough for a Dataview query (`show me all tooling items from last 30 days`)
5. Total setup time under 30 minutes

---

## Open Questions

- Should `readInFull` picks come from Claude's judgement alone, or should there be a heuristic pre-filter (e.g. only items above a certain HN score)?
- Should the config support per-source keyword overrides for the HN Algolia query, or is a global keyword list sufficient?
