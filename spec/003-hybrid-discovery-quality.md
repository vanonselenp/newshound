# Spec 003 — Hybrid Discovery, Ranking, and Personalisation

## Goal

Improve `newshound` from a configurable digest runner into a bounded discovery system that:

- fetches enough article substance to judge real usefulness
- ranks and deduplicates candidates before summarisation
- expands beyond hand-curated feeds with strictly bounded discovery sources
- validates runs strongly enough to trust the output
- learns from user feedback over time

This spec follows the agreed **hybrid approach**:

- **monitored sources** remain the backbone: known feeds, subreddits, changelogs, HN
- **discovery sources** add bounded search over broader surfaces, constrained by time window, query set, and per-run caps

This is explicitly **not** unbounded web search.

## Non-goals

- crawling the open web
- building a hosted service or dashboard
- introducing embeddings, vector search, or a database in the first iteration
- adding browser automation for every source

## Product changes

### 1. Full-article fetching and content extraction

The current pipeline filters mostly on snippets and feed descriptions. This causes false positives from good headlines and false negatives where the real value is only visible in the article body.

New behaviour:

1. Initial fetchers still gather lightweight candidates from feeds, Reddit, HN, and future discovery sources.
2. A second-stage content fetch enriches selected candidates with full article text.
3. Full-text fetching is bounded:
   - all curated items are eligible
   - community and discovery items are eligible only after a cheap first-pass gate
   - per-run fetch caps prevent runaway network work
4. Filtering and summarisation prompts use full text when available, otherwise fall back to snippet text.

### 2. Better ranking and dedupe

The current pipeline only classifies items into `high`, `worth_knowing`, or `low`. That is not enough to consistently surface the most relevant items.

New behaviour:

1. Candidates are deduplicated across sources before final ranking.
2. Ranking combines deterministic heuristics with Claude scoring.
3. The digest is selected from the top-ranked unique stories, not from an unordered list of survivors.

### 3. Broader and more dynamic source coverage

Curated feeds remain valuable, but the system should also discover recent relevant material from bounded search surfaces.

New behaviour:

1. Introduce a `discovery` source class.
2. Discovery sources must specify:
   - a time window
   - a fixed query set or trusted account/channel list
   - a max results cap
3. The first discovery adapters should be high-signal, bounded surfaces such as:
   - YouTube recent search
   - GitHub releases for selected orgs/repos
   - optional additional bounded adapters later

### 4. Stronger validation and observability

The digest must be trustworthy. If Claude returns malformed output or important sources fail, the run should clearly show that.

New behaviour:

1. Claude responses are validated strictly.
2. Every run emits structured stats and warnings.
3. Runs that are materially incomplete are marked degraded.

### 5. Feedback-driven personalisation

The digest should get sharper over time based on explicit user feedback.

New behaviour:

1. Feedback is stored locally.
2. Ranking weights adapt based on source, topic, author, and format preferences.
3. Personalisation is a soft ranking adjustment, not a hard exclusion engine.

## Architecture changes

Current:

```text
Fetch sources -> Filter via Claude -> Summarise via Claude -> Write digest
```

Target:

```text
Fetch lightweight candidates
-> Enrich selected candidates with article content
-> Canonicalise and dedupe
-> Relevance gate and ranking
-> Summarise top unique stories
-> Write digest + run report
-> Update state + feedback-informed weights
```

## Data model changes

### New candidate shape

`src/types.ts` should replace or extend `FeedItem` with a richer candidate type:

```typescript
type CandidateItem = {
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  publishedAt: Date;
  sourceName: string;
  sourceType: 'rss' | 'atom' | 'reddit' | 'hn' | 'youtube' | 'github';
  sourceMode: 'monitored' | 'discovery';
  tier: 'curated' | 'community';
  author?: string;
  snippet: string;
  fullText?: string;
  contentFetched: boolean;
  extractionMethod?: 'feed' | 'html' | 'api' | 'fallback';
  extractionError?: string;
  score?: {
    relevance: number;
    signal: number;
    novelty: number;
    fit: number;
    final: number;
    reason: string;
    bucket: 'high' | 'worth_knowing' | 'low';
  };
  duplicateOf?: string;
  alternates?: Array<{
    sourceName: string;
    url: string;
  }>;
};
```

### Run report shape

Add a machine-readable run artifact:

```typescript
type RunReport = {
  digestId: string;
  startedAt: string;
  completedAt: string;
  degraded: boolean;
  sourceStats: Array<{
    sourceName: string;
    sourceMode: 'monitored' | 'discovery';
    attempted: boolean;
    succeeded: boolean;
    warning?: string;
    rawCandidates: number;
    enrichedCandidates: number;
  }>;
  totals: {
    rawCandidates: number;
    enrichedCandidates: number;
    dedupedCandidates: number;
    filteredLow: number;
    surfaced: number;
    extractionFailures: number;
  };
  warnings: string[];
};
```

## Config changes

### Source model

Extend `src/config.ts` so sources can be either monitored or discovery sources.

Example shape:

```typescript
type BaseSource = {
  name: string;
  mode: 'monitored' | 'discovery';
  tier: 'curated' | 'community';
  maxCandidatesPerRun?: number;
};

type FeedSource = BaseSource & {
  type: 'rss' | 'atom';
  url: string;
};

type RedditSource = BaseSource & {
  type: 'reddit';
  subreddit: string;
  minScore?: number;
};

type HNSource = BaseSource & {
  type: 'hn';
  minScore?: number;
  queries?: string[];
};

type YouTubeDiscoverySource = BaseSource & {
  type: 'youtube';
  queries?: string[];
  trustedChannels?: string[];
  lookbackHours: number;
  maxResultsPerQuery: number;
};

type GitHubDiscoverySource = BaseSource & {
  type: 'github';
  orgs?: string[];
  repos?: string[];
  lookbackHours: number;
  maxResultsPerRun: number;
};
```

### Digest-level budgets

Add explicit caps so discovery stays bounded:

```typescript
type DigestConfig = {
  // existing fields...
  candidateBudgets?: {
    maxRawCandidatesPerRun: number;
    maxFullTextFetchesPerRun: number;
    maxRankedCandidatesForClaude: number;
  };
};
```

## File-by-file changes

### `src/types.ts`

- replace `FeedItem` with richer candidate type, or introduce `CandidateItem`
- add score metadata
- add run report types

### `src/config.ts`

- add source `mode`
- add discovery source variants
- add digest candidate budget config

### `src/config-loader.ts`

- validate new source shapes when loading YAML
- apply defaults for source caps and digest budgets

### `src/fetchers/*`

- keep existing fetchers as lightweight candidate collectors
- ensure each fetcher returns richer candidate metadata
- make HN query list configurable instead of hardcoded only in code

### New `src/enrich.ts`

- fetch full article HTML for selected candidates
- extract main text content with fallbacks
- record extraction method and failures
- respect per-run fetch caps

### New `src/dedupe.ts`

- canonicalise URLs
- detect exact duplicates
- detect near-duplicate titles
- cluster alternates across sources

### New `src/rank.ts`

- compute deterministic priors such as freshness and source trust
- call Claude for scored ranking on bounded candidates
- return ranked candidates with structured scores and reasons

### `src/filter.ts`

- evolve from simple bucket classifier to a relevance gate and score validator
- validate that every candidate sent to Claude is accounted for exactly once
- reject malformed or incomplete responses

### `src/summarise.ts`

- summarise top-ranked unique stories only
- include alternate-source context where useful
- prefer full text over snippet text in prompts

### `src/vault.ts`

- optionally include degraded-run note in output when relevant
- continue writing digest markdown
- add run report write helper if reports are stored in the vault or config dir

### `src/index.ts`

- orchestrate new stages: enrich, dedupe, rank, summarise, report
- determine whether run is degraded
- write structured run report

### New `src/feedback.ts`

- read and write local feedback store
- expose weight adjustments for ranking

## Prompt changes

### Ranking prompt

Claude should return structured scores, not just buckets.

Expected response shape:

```json
[
  {
    "index": 0,
    "relevance": 91,
    "signal": 88,
    "novelty": 70,
    "fit": 95,
    "final": 90,
    "bucket": "high",
    "reason": "Concrete release with practical developer impact"
  }
]
```

Validation rules:

- every item appears exactly once
- no duplicate indexes
- scores are integers from 0 to 100
- `bucket` is one of `high`, `worth_knowing`, `low`

### Summarisation prompt

Summarisation should receive:

- title
- canonical URL
- source name
- alternates where relevant
- snippet
- full text when present
- ranking reason and scores

This keeps the summary grounded in both content and ranking intent.

## Observability

### Degraded run rules

A run should be marked degraded if any of the following happen:

- more than a configured fraction of monitored sources fail
- full-text extraction fails above a configured threshold
- Claude ranking or summary validation fails and fallback mode is used
- surfaced items fall suspiciously low because most upstream work failed

### Reporting

Each run should emit:

- human-readable stderr logs
- a machine-readable `run-report.json`
- frontmatter counts already included in the digest

Optional future enhancement:

- append a short "run health" section to the markdown digest when degraded

## Personalisation

### Feedback store

Add a local JSON file keyed by digest id, for example under `~/.newshound/feedback/`:

```json
{
  "sources": {
    "Anthropic Blog": 2,
    "Hacker News": -1
  },
  "topics": {
    "coding-agents": 3,
    "benchmarks": -2
  },
  "authors": {
    "Simon Willison": 2
  },
  "domains": {
    "youtube.com": 1
  }
}
```

### Feedback semantics

Initial supported actions:

- `useful`
- `not_useful`
- `more_like_this`
- `less_like_this`
- `already_knew`

These should affect ranking weights softly, not suppress items completely.

## Phased delivery

### Milestone A — Better inputs

1. Add richer candidate model.
2. Add full-text enrichment for curated items and capped community candidates.
3. Update filter and summary prompts to use full text when available.

### Milestone B — Better selection

1. Add URL canonicalisation.
2. Add cross-source dedupe and alternate-link clustering.
3. Add ranked scoring with deterministic features plus Claude.

### Milestone C — Trustworthy runs

1. Add strict response validation.
2. Add run report artifact.
3. Add degraded-run detection and warnings.

### Milestone D — Hybrid discovery

1. Add discovery source config types.
2. Add first discovery adapter: YouTube recent search with explicit caps.
3. Add second discovery adapter: GitHub releases for tracked orgs/repos.

### Milestone E — Learning loop

1. Add feedback store.
2. Feed weights into ranking.
3. Add simple CLI or file-based workflow for recording feedback.

## TDD order

1. Add failing tests for richer candidate types and config parsing.
2. Add failing tests for full-text enrichment fallback behaviour.
3. Add failing tests for canonical URL handling and duplicate clustering.
4. Add failing tests for strict Claude ranking validation.
5. Add failing tests for degraded-run detection and run report output.
6. Add failing tests for discovery source config and adapter caps.
7. Add failing tests for feedback weight application.

## Verification

```bash
npm run test
npm run typecheck
npm run build
```

Manual verification:

1. Run a digest with a small monitored-only config and confirm full-text enrichment is reflected in summaries.
2. Run a digest containing the same story across feed, HN, and Reddit and confirm only one story is surfaced.
3. Run with a discovery source configured and confirm query/result caps are respected.
4. Force malformed Claude output in tests and confirm the run is marked degraded or fails clearly.
5. Record local feedback and confirm subsequent ranking changes are visible in run output.

## Recommended implementation order

1. Full-text extraction
2. Ranking and dedupe
3. Validation and observability
4. Hybrid discovery sources
5. Feedback-driven personalisation

This order gives the highest quality gain earliest while keeping the search problem bounded.
