# PRD: Multi-Digest Generalisation

## Introduction

Newshound currently hardcodes a single AI-tooling digest pipeline. This change makes adding a new digest type a **config-only operation** — no code modifications required. The immediate use case is a daily job postings digest that filters listings against a user-supplied profile, running alongside the existing AI Digest.

All hardcoded content (sources, filter criteria, tag vocabulary, output paths, digest name) is removed from TypeScript source and moved into the config file.

---

## Goals

- A new digest type requires only a new entry in `~/.ai-digest-config.json` — zero code changes
- All existing AI Digest behaviour is preserved without regression
- Per-digest filter criteria and tag vocabulary are fully configurable
- An optional `profile` field in `FilterCriteria` enables persona-aware filtering (e.g. job matching)
- `config.example.json` ships with two working entries (AI tools + jobs) as copy-paste templates

---

## User Stories

### US-001: Add `FilterCriteria` and `DigestConfig` types to `src/config.ts`

**Description:** As a developer, I want typed config shapes that fully describe a digest so that TypeScript catches missing fields at compile time.

**Acceptance Criteria:**
- [ ] `FilterCriteria` type exported with fields: `purpose: string`, `highSignal: string[]`, `lowSignal: string[]`, `worthKnowing?: string[]`, `profile?: string`
- [ ] `DigestConfig` type exported with fields: `id`, `name`, `outputDir`, `stateFilePath`, `lookbackDays`, `sources`, `filterCriteria`, `tags`, `summarisationContext?`
- [ ] `Config` type updated to `{ vaultPath: string; digests: DigestConfig[] }`
- [ ] `DEFAULT_SOURCES` export deleted from `config.ts`
- [ ] `npm run typecheck` passes

---

### US-002: Generalise `src/filter.ts` to accept `FilterCriteria`

**Description:** As a developer, I want `filterItems` to build its prompt from a `FilterCriteria` object so that different digest types apply different filtering rules without code changes.

**Acceptance Criteria:**
- [ ] Failing test written first for new `filterItems(items, criteria: FilterCriteria, claude)` signature
- [ ] `buildFilterPrompt(items, criteria: FilterCriteria)` builds HIGH/WORTH/LOW sections from `criteria.highSignal`, `criteria.worthKnowing`, `criteria.lowSignal` arrays
- [ ] Prompt opens with: `"You are evaluating content items for a daily {criteria.purpose} digest…"`
- [ ] When `criteria.profile` is set, prompt appends: `"USER PROFILE (filter for fit against this):\n{profile}"`
- [ ] All existing filter tests updated and passing with new signatures
- [ ] `npm run typecheck` passes

---

### US-003: Generalise `src/summarise.ts` to accept `DigestConfig`

**Description:** As a developer, I want `summariseItems` to derive its prompt, tag vocabulary, and opener from `DigestConfig` so different digest types produce correctly-titled, correctly-tagged output.

**Acceptance Criteria:**
- [ ] Failing test written first for new `summariseItems(filterResult, totalScanned, recentDigests, digestConfig: DigestConfig, claude)` signature
- [ ] Hardcoded `TAG_VOCABULARY` constant removed
- [ ] `buildSummarisePrompt` opens with: `"You are writing a daily ${digestConfig.name}…"`
- [ ] Tag list in prompt sourced from `digestConfig.tags.join(', ')`
- [ ] `digestConfig.summarisationContext` appended to prompt when present
- [ ] `digestConfig.filterCriteria.profile` injected as context when present
- [ ] Tag guard uses `digestConfig.tags.includes(t)` (not hardcoded list)
- [ ] All existing summarise tests updated and passing
- [ ] `npm run typecheck` passes

---

### US-004: Generalise `src/vault.ts` to accept `outputDir`, `digestName`, `rootTag`

**Description:** As a developer, I want vault functions to accept output path and branding parameters so each digest type writes to its own subdirectory with its own heading.

**Acceptance Criteria:**
- [ ] Failing tests written first for parameterised vault functions
- [ ] `digestDir(vaultPath, outputDir: string)` — no hardcoded `'AI-Digest'`
- [ ] `readRecentDigests(vaultPath, outputDir: string, days: number)`
- [ ] `renderDigest(content, date, digestName: string, rootTag: string, catchUpSince?)` — replaces hardcoded `'ai-digest'` and `'# AI Digest —'`
- [ ] `writeDigest(vaultPath, outputDir: string, date, content)`
- [ ] All existing vault tests updated and passing
- [ ] `npm run typecheck` passes

---

### US-005: Update `src/index.ts` to loop over `config.digests`

**Description:** As a user, I want one CLI invocation to run every configured digest in sequence so I don't need separate processes per digest.

**Acceptance Criteria:**
- [ ] Failing integration test written first for multi-digest loop
- [ ] `DEFAULT_SOURCES` import removed
- [ ] Config loaded as `{ vaultPath, digests }` (new shape)
- [ ] `for (const digest of config.digests)` loop replaces the single pipeline call
- [ ] Per digest: `~` in `digest.stateFilePath` resolved, full pipeline run with that digest's own config
- [ ] Log lines prefixed with `[newshound:${digest.id}]`
- [ ] `npm run typecheck` passes

---

### US-006: Update `config.example.json` with two digest entries

**Description:** As a new user, I want the example config to show both digest types fully configured so I can adapt it without reading source code.

**Acceptance Criteria:**
- [ ] Top-level shape: `{ vaultPath, digests: [...] }`
- [ ] First entry: `id: "ai-tools"` — contains all sources previously in `DEFAULT_SOURCES` plus the AI-tools filter criteria and tags
- [ ] Second entry: `id: "jobs"` — sample job RSS source, `profile` placeholder text, job-appropriate filter criteria and tags (as shown in spec 002)
- [ ] Old flat-shape fields (`stateFilePath`, `lookbackDays` at root) removed

---

## Functional Requirements

- FR-1: `Config` must be `{ vaultPath: string; digests: DigestConfig[] }` — old flat shape is unsupported
- FR-2: Each `DigestConfig` independently specifies sources, filter criteria, tag vocabulary, output directory, state file path, and lookback window
- FR-3: `filterItems` accepts `FilterCriteria`; prompt content varies by `criteria.purpose`, signal arrays, and optional `profile`
- FR-4: `summariseItems` accepts `DigestConfig`; tag validation uses `digestConfig.tags`, not a hardcoded list
- FR-5: `vault.ts` functions accept `outputDir`, `digestName`, `rootTag` as parameters — no hardcoded values remain
- FR-6: `index.ts` iterates `config.digests` and runs the full pipeline independently for each entry
- FR-7: State files are per-digest; `~` in `stateFilePath` is expanded at runtime
- FR-8: All log lines are prefixed `[newshound:${digest.id}]`

---

## Non-Goals

- No migration shim for the existing flat config format — users update their config manually
- No parallel digest execution (sequential loop is sufficient)
- No changes to `src/claude.ts` (subprocess adapter)
- No changes to `src/state.ts` (state file format stays `{ lastRun: ISO }`)
- No changes to fetcher logic
- No UI or web interface

---

## Technical Considerations

- Follow red-green-refactor TDD as required by CLAUDE.md: failing test → minimal implementation → green
- Implementation order: `config.ts` → `filter.ts` → `summarise.ts` → `vault.ts` → `index.ts` → `config.example.json`
- `src/types.ts` shapes (`FeedItem`, `FilterResult`, `DigestContent`, `SummaryItem`) are unchanged
- `~` expansion already present in `index.ts` — reuse same pattern inside the per-digest loop
- Test files live in `src/__tests__/`; update existing tests when function signatures change

---

## Success Metrics

- `npm run typecheck` — zero errors
- `npm run test` — all tests green
- `npm run build` — `dist/index.js` compiles cleanly
- Manual: update `~/.ai-digest-config.json` to new format, run `node dist/index.js`, confirm both digests execute and write vault output

---

## Open Questions

None — spec 002 fully specifies the required behaviour.
