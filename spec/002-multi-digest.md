# Spec 002 — Multi-digest generalisation

## Goal

Make adding a new digest type a **config-only change** — no code modifications required. The immediate use case is a daily job postings digest that filters against a user-provided profile, alongside the existing AI Digest.

## Config shape

### New types (`src/config.ts`)

```typescript
type FilterCriteria = {
  purpose: string;        // one-line description of what this digest is for
  highSignal: string[];   // bullet criteria for high signal classification
  lowSignal: string[];    // bullet criteria for low signal classification
  worthKnowing?: string[];
  profile?: string;       // optional free-form user profile (injected into prompts)
};

type DigestConfig = {
  id: string;             // e.g. "ai-tools" — becomes the root frontmatter tag
  name: string;           // e.g. "AI Digest" — used in H1 heading
  outputDir: string;      // vault subdirectory, e.g. "AI-Digest"
  stateFilePath: string;  // e.g. "~/.ai-digest-state.json"
  lookbackDays: number;
  sources: Source[];
  filterCriteria: FilterCriteria;
  tags: string[];         // valid tag vocabulary for this digest type
  summarisationContext?: string;  // optional extra context for summarise prompt
};

type Config = {
  vaultPath: string;
  digests: DigestConfig[];
};
```

`DEFAULT_SOURCES` is removed from code and moved into `config.example.json` under the `ai-tools` digest entry.

## File-by-file changes

### `src/config.ts`
- Add `FilterCriteria` and `DigestConfig` types
- Replace `Config = { vaultPath, stateFilePath, lookbackDays }` with `Config = { vaultPath, digests: DigestConfig[] }`
- Delete the `DEFAULT_SOURCES` export

### `src/filter.ts`
- `buildFilterPrompt(items, criteria: FilterCriteria)` — build HIGH/WORTH/LOW sections from arrays
- Open with: *"You are evaluating content items for a daily {criteria.purpose} digest…"*
- When `criteria.profile` is set, inject: *"USER PROFILE (filter for fit against this):\n{profile}"*
- `filterItems(items, criteria: FilterCriteria, claude)` — new signature

### `src/summarise.ts`
- Remove hardcoded `TAG_VOCABULARY` constant
- `buildSummarisePrompt(filterResult, totalScanned, recentDigests, digestConfig: DigestConfig)`
  - Opener: `"You are writing a daily ${digestConfig.name}…"`
  - Tag list: `digestConfig.tags.join(', ')`
  - Append `digestConfig.summarisationContext` when present
  - Inject `digestConfig.filterCriteria.profile` as context when present
- `summariseItems(filterResult, totalScanned, recentDigests, digestConfig: DigestConfig, claude)` — new signature
- Replace `TAG_VOCABULARY.includes(t)` guard with `digestConfig.tags.includes(t)`

### `src/vault.ts`
- `digestDir(vaultPath, outputDir: string)` — remove hardcoded `'AI-Digest'`
- `readRecentDigests(vaultPath, outputDir: string, days: number)`
- `renderDigest(content, date, digestName: string, rootTag: string, catchUpSince?)` — replace hardcoded `'ai-digest'` and `# AI Digest —`
- `writeDigest(vaultPath, outputDir: string, date, content)`

### `src/index.ts`
- Remove `DEFAULT_SOURCES` import
- Replace single pipeline run with `for (const digest of config.digests)` loop
- Per digest: resolve `~` in `digest.stateFilePath`, run full pipeline using digest's own config
- Log prefix: `[newshound:${digest.id}]`

### `config.example.json`
New structure with two entries:

```json
{
  "vaultPath": "/Users/yourname/Documents/ObsidianVault",
  "digests": [
    {
      "id": "ai-tools",
      "name": "AI Digest",
      "outputDir": "AI-Digest",
      "stateFilePath": "~/.ai-digest-state.json",
      "lookbackDays": 3,
      "sources": [
        { "name": "OpenAI Blog", "type": "rss", "url": "https://openai.com/news/rss.xml", "tier": "curated" },
        { "name": "Cursor Changelog", "type": "rss", "url": "https://changelog.cursor.sh/rss", "tier": "curated" },
        { "name": "Vercel Blog", "type": "atom", "url": "https://vercel.com/atom", "tier": "curated" },
        { "name": "Simon Willison's Blog", "type": "atom", "url": "https://simonwillison.net/atom/entries/", "tier": "curated" },
        { "name": "Latent Space", "type": "rss", "url": "https://www.latent.space/feed", "tier": "curated" },
        { "name": "Sourcegraph Blog", "type": "rss", "url": "https://sourcegraph.com/blog/rss.xml", "tier": "curated" },
        { "name": "GitHub Blog", "type": "rss", "url": "https://github.blog/feed/", "tier": "curated" },
        { "name": "Hugging Face Blog", "type": "rss", "url": "https://huggingface.co/blog/feed.xml", "tier": "curated" },
        { "name": "Eugene Yan", "type": "rss", "url": "https://eugeneyan.com/rss/", "tier": "curated" },
        { "name": "Hamel Husain", "type": "rss", "url": "https://hamel.dev/index.xml", "tier": "curated" },
        { "name": "Lilian Weng", "type": "rss", "url": "https://lilianweng.github.io/index.xml", "tier": "curated" },
        { "name": "Chip Huyen", "type": "rss", "url": "https://huyenchip.com/feed.xml", "tier": "curated" },
        { "name": "Jason Liu", "type": "rss", "url": "https://jxnl.co/feed_rss_created.xml", "tier": "curated" },
        { "name": "Cloudflare Blog", "type": "rss", "url": "https://blog.cloudflare.com/rss", "tier": "community" },
        { "name": "Hacker News", "type": "hn", "minScore": 50, "tier": "community" },
        { "name": "r/ClaudeAI", "type": "reddit", "subreddit": "ClaudeAI", "minScore": 20, "tier": "community" },
        { "name": "r/cursor", "type": "reddit", "subreddit": "cursor", "minScore": 20, "tier": "community" },
        { "name": "r/LocalLLaMA", "type": "reddit", "subreddit": "LocalLLaMA", "minScore": 30, "tier": "community" },
        { "name": "r/ChatGPT", "type": "reddit", "subreddit": "ChatGPT", "minScore": 50, "tier": "community" }
      ],
      "filterCriteria": {
        "purpose": "AI tooling and development content for software practitioners",
        "highSignal": [
          "New tool releases, features, or APIs with concrete capabilities (Claude Code, Cursor, Copilot, Codex, etc.)",
          "\"I built X with Y\" posts showing real workflows or architectures",
          "Practical tutorials, patterns, or techniques for AI-assisted development",
          "AI collaboration methodology — spec-driven development, context management, agent configuration",
          "Meaningful performance improvements or cost reductions in AI tooling",
          "Changes to pricing, rate limits, or availability that affect daily work",
          "Workflow tips: prompt engineering, agent configuration, IDE integration",
          "TypeScript, AWS serverless, or frontend architecture content that is AI-related",
          "Case studies of engineering teams adopting AI tools at scale"
        ],
        "worthKnowing": [
          "Minor updates or incremental improvements to tools",
          "Interesting observations about AI tooling trends that are less immediately actionable",
          "Early-stage or limited-availability releases worth tracking"
        ],
        "lowSignal": [
          "Hype, speculation about AGI timelines, or \"AI will replace X\" takes",
          "Fundraising announcements or company drama (unless pricing/availability changes)",
          "Benchmark comparisons without practical implications",
          "Philosophical debates about AI safety/alignment (unless actionable)",
          "Listicles, ragebait, or engagement-farming posts",
          "Vague product announcements without concrete details",
          "Content focused purely on ML model training (unless it directly affects tool usage)",
          "Enterprise sales pitches disguised as blog posts"
        ]
      },
      "tags": ["tooling","models","workflows","pricing","apis","coding-agents","prompting","infrastructure","open-source","releases","ai-methodology","team-practices"]
    },
    {
      "id": "jobs",
      "name": "Job Digest",
      "outputDir": "Job-Digest",
      "stateFilePath": "~/.jobs-digest-state.json",
      "lookbackDays": 1,
      "sources": [
        { "name": "Remote.co Engineering", "type": "rss", "url": "https://remote.co/remote-jobs/developer/feed/", "tier": "curated" }
      ],
      "filterCriteria": {
        "purpose": "software engineering job postings matching the user profile",
        "profile": "EDIT THIS: describe your experience level, technical skills, preferred stack, work arrangement (remote/hybrid), location constraints, company stage preferences, and any deal-breakers",
        "highSignal": [
          "Strong match on required technical skills listed in the user profile",
          "Appropriate seniority level for the user's experience",
          "Company type and stage align with user preferences",
          "Remote/location arrangement matches user requirement"
        ],
        "worthKnowing": [
          "Partial skill match with interesting other attributes",
          "Slightly off on level but otherwise compelling"
        ],
        "lowSignal": [
          "Wrong seniority level — over or under-qualified by more than one level",
          "Skills mismatch — missing more than half of required skills",
          "Location or work arrangement incompatible with user preferences",
          "Company type explicitly excluded in user profile"
        ]
      },
      "tags": ["frontend","backend","full-stack","remote","hybrid","senior","staff","startup","scale-up","enterprise","contract","full-time"]
    }
  ]
}
```

## TDD order

1. `src/config.ts` — add types, tests for type shapes
2. `src/filter.ts` — failing test with new `(items, criteria, claude)` signature → implement → green
3. `src/summarise.ts` — failing test with new `(filterResult, totalScanned, recentDigests, digestConfig, claude)` signature → implement → green
4. `src/vault.ts` — failing tests for new `outputDir`/`digestName`/`rootTag` params → implement → green
5. `src/index.ts` — update integration test for multi-digest loop → implement

## Verification

```bash
npm run typecheck    # zero errors
npm run test         # all green
npm run build        # dist/index.js compiles cleanly
```

Manual: update `~/.ai-digest-config.json` to the new format (copy from updated `config.example.json`) and run `node dist/index.js` to confirm both digests execute and produce vault output.
