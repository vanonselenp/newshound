# PRD: Hybrid Discovery, Ranking, and Digest Quality

## Introduction

Upgrade `newshound` from a configurable digest runner into a bounded discovery and ranking system that brings the most relevant AI tooling information to the user without requiring manual searching.

The current system already fetches content from configured sources, filters it with Claude, and writes a digest. Its main limitations are that it often evaluates snippets instead of full article substance, does not rank or deduplicate strongly across sources, has limited discovery beyond known feeds, and has weak validation when runs are incomplete or Claude returns malformed output.

This feature introduces a phased improvement plan that prioritises digest quality first. It keeps the existing monitored-source backbone and adds a bounded hybrid discovery model using time-limited, capped discovery sources. Initial discovery scope is limited to YouTube recent search and GitHub releases. Feedback-driven personalisation is explicitly deferred from the initial implementation scope.

## Goals

- Improve digest relevance by evaluating full article content when available instead of relying only on snippets.
- Deduplicate repeated stories across feeds, Hacker News, Reddit, and discovery sources before summarisation.
- Rank candidates so the digest consistently surfaces the most relevant unique stories first.
- Expand coverage with bounded discovery sources without turning the system into unbounded web search.
- Make incomplete or degraded runs visible through strict validation, warnings, and run reporting.
- Preserve the existing configurable multi-digest architecture.
- Keep the implementation bounded by explicit per-run budgets for candidate collection and full-text fetching.

## User Stories

### US-001: Enrich candidates with full article content
**Description:** As a digest reader, I want the system to evaluate article substance instead of teaser text so that the digest reflects what is actually useful.

**Acceptance Criteria:**
- [ ] Add a richer candidate model that supports both lightweight snippet text and optional full extracted article text.
- [ ] The pipeline performs a second-stage enrichment step after initial candidate collection.
- [ ] All curated items are eligible for enrichment, subject to per-run fetch limits.
- [ ] Community and discovery items are enriched only after a lightweight first-pass gate.
- [ ] If enrichment fails, the candidate remains usable with snippet fallback and a recorded extraction failure reason.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-002: Extract primary article text with safe fallback behaviour
**Description:** As a developer, I want article extraction to fail safely so that a single bad page does not break the digest run.

**Acceptance Criteria:**
- [ ] Add an enrichment module that fetches article HTML or source API content for selected candidates.
- [ ] The system records extraction method for each enriched candidate, such as `feed`, `html`, `api`, or `fallback`.
- [ ] The system records extraction errors without aborting the entire run unless configured thresholds are exceeded.
- [ ] The summarisation and ranking steps prefer full text when present and fall back to snippet text otherwise.
- [ ] Add tests covering successful extraction, empty extraction, and network failure fallback behaviour.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-003: Deduplicate repeated stories across sources
**Description:** As a digest reader, I want repeated coverage of the same story grouped together so that the digest does not waste space on duplicates.

**Acceptance Criteria:**
- [ ] Add URL canonicalisation before ranking.
- [ ] Exact duplicates across sources are collapsed into a single story cluster.
- [ ] Near-duplicate items with materially similar titles can be grouped into the same cluster when they refer to the same story.
- [ ] A clustered story retains alternate source links for later use in summaries or debugging.
- [ ] Add tests covering exact URL duplicates, URL canonicalisation cases, and title-based near duplicates.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-004: Rank candidates before summarisation
**Description:** As a digest reader, I want the digest to surface the highest-value stories first so that I spend less time sorting signal from noise.

**Acceptance Criteria:**
- [ ] Replace the current bucket-only filtering step with a bounded ranking step that assigns structured scores.
- [ ] Ranking output includes `relevance`, `signal`, `novelty`, `fit`, `final`, `bucket`, and `reason` for each candidate.
- [ ] Ranking combines deterministic priors, such as freshness and source trust, with Claude-generated scoring.
- [ ] The summariser receives only the top-ranked unique stories, within an explicit per-run cap.
- [ ] Add tests proving that ranking results are parsed and validated correctly.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-005: Validate Claude responses strictly
**Description:** As an operator, I want invalid Claude output to be detected immediately so that the digest does not silently drop or mis-rank items.

**Acceptance Criteria:**
- [ ] Ranking and summarisation responses are validated against explicit response rules.
- [ ] Every candidate sent to Claude must be accounted for exactly once when the response contract requires it.
- [ ] Duplicate indexes, missing indexes, out-of-range scores, and invalid buckets are rejected.
- [ ] Malformed Claude responses produce a clear error or degraded-run warning, depending on configured fallback mode.
- [ ] Add tests covering invalid JSON, duplicate indexes, missing candidates, and invalid score values.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-006: Emit run reports and degraded-run warnings
**Description:** As an operator, I want structured run health information so that I can trust the digest and quickly diagnose missing coverage.

**Acceptance Criteria:**
- [ ] Each digest run emits a machine-readable run report with source-level and total-level counts.
- [ ] The run report includes raw candidates, enriched candidates, deduped candidates, filtered items, surfaced items, and extraction failure counts.
- [ ] The pipeline marks a run as degraded when configured failure thresholds are exceeded.
- [ ] The digest output or logs clearly indicate when a run was degraded.
- [ ] Add tests covering degraded-run thresholds and report generation.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-007: Add bounded YouTube discovery
**Description:** As a digest reader, I want the system to discover recent relevant videos from a constrained search surface so that useful information outside feeds can reach me.

**Acceptance Criteria:**
- [ ] Add a discovery source type for YouTube recent search.
- [ ] YouTube discovery requires explicit `lookbackHours`, query list or trusted channels, and per-query result limits.
- [ ] The system does not search YouTube without configured bounds.
- [ ] YouTube results enter the same enrichment, dedupe, and ranking pipeline as monitored-source candidates.
- [ ] Add tests covering config parsing and enforcement of query/result caps.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-008: Add bounded GitHub release discovery
**Description:** As a digest reader, I want the system to discover recent releases from tracked repos and organisations so that product and tooling updates are surfaced quickly.

**Acceptance Criteria:**
- [ ] Add a discovery source type for GitHub release or changelog discovery.
- [ ] GitHub discovery requires explicit repo or organisation configuration plus a bounded time window and per-run result cap.
- [ ] GitHub results enter the same enrichment, dedupe, and ranking pipeline as other candidates.
- [ ] Add tests covering config parsing, source bounds, and result cap enforcement.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

### US-009: Keep the feature phased and bounded
**Description:** As a maintainer, I want this improvement work delivered in phases so that the system improves safely without uncontrolled scope growth.

**Acceptance Criteria:**
- [ ] The implementation plan is divided into explicit milestones: extraction, ranking/dedupe, observability, and bounded discovery.
- [ ] Personalisation is documented as future work and not required for initial completion.
- [ ] The config model includes explicit digest-level candidate budgets.
- [ ] Add tests covering default budget handling and config loading for the new source model.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.

## Functional Requirements

- FR-1: The system must support a richer candidate type that stores snippet text, optional full extracted text, canonical URL, source metadata, and ranking metadata.
- FR-2: After lightweight candidate collection, the system must run a second-stage content enrichment step for bounded candidates.
- FR-3: The system must prefer full extracted text during ranking and summarisation when it is available.
- FR-4: The system must preserve snippet fallback behaviour when full extraction fails.
- FR-5: The system must canonicalise URLs before deduplication and ranking.
- FR-6: The system must deduplicate exact and near-duplicate stories across all source types before final selection.
- FR-7: The system must rank candidates using both deterministic signals and Claude scoring.
- FR-8: The system must validate Claude ranking output strictly, including score ranges, bucket values, and candidate coverage.
- FR-9: The system must summarise only the top-ranked unique stories within a configured cap.
- FR-10: The system must emit a machine-readable run report for each digest run.
- FR-11: The system must mark runs as degraded when configured source failure, extraction failure, or validation failure thresholds are exceeded.
- FR-12: The system must support two source modes: `monitored` and `discovery`.
- FR-13: Every discovery source must define explicit bounds including a time window and result cap.
- FR-14: The initial discovery implementation must support YouTube recent search.
- FR-15: The initial discovery implementation must support GitHub releases or changelog discovery.
- FR-16: The system must enforce digest-level candidate budgets, including maximum raw candidates, maximum full-text fetches, and maximum ranked candidates for Claude.
- FR-17: The system must remain compatible with the existing multi-digest config model.

## Non-Goals

- No unbounded web crawling or general-purpose internet search.
- No hosted service, web dashboard, or remote monitoring system.
- No embeddings, vector store, or semantic retrieval database in the initial implementation.
- No browser automation requirement for content extraction in the first version.
- No user-facing UI for recording feedback in the initial scope.
- No feedback-driven personalisation in the first implementation phase.
- No attempt to fetch and process every linked page from every low-quality candidate.

## Design Considerations

- Preserve the current mental model that monitored sources are the trusted backbone and discovery sources are bounded supplements.
- Keep source configuration readable in YAML and explicit enough that a maintainer can understand why a discovery source is bounded.
- Prefer clear naming such as `mode`, `lookbackHours`, `maxResultsPerQuery`, and `candidateBudgets` over ambiguous generic fields.
- If degraded-run information is shown in the markdown digest, it should be short and factual rather than noisy.

## Technical Considerations

- The current pipeline lives in `src/index.ts` and should evolve from `fetch -> filter -> summarise -> write` into `fetch -> enrich -> dedupe -> rank -> summarise -> report -> write`.
- Existing fetchers in `src/fetchers/` should remain lightweight candidate collectors rather than turning into full crawlers.
- New modules are likely needed for enrichment, dedupe, ranking, run reporting, and later feedback storage.
- HN keyword search should become configurable rather than being hardcoded only in source code.
- Claude integration already exists through a CLI adapter; stricter response validation should be added around this boundary.
- Article extraction should fail safely and record fallback reasons rather than terminating the entire digest by default.
- The implementation should continue following the repository's TDD requirement: failing test first, minimum implementation, then refactor.

## Success Metrics

- Balanced quality scorecard: duplicate stories in a digest are reduced compared with the current implementation.
- Balanced quality scorecard: a higher proportion of surfaced items are judged practically useful after one week of use.
- Balanced quality scorecard: monitored plus discovery coverage surfaces useful items that were not present in the monitored-source-only run.
- Balanced quality scorecard: degraded runs are clearly identifiable from logs and run reports, with no silent item loss from malformed Claude output.
- At least one bounded YouTube discovery source and one bounded GitHub discovery source can be configured and run successfully.
- Per-run candidate and enrichment caps are enforced consistently in tests and manual verification.

## Open Questions

- What exact thresholds should mark a run as degraded, such as percentage of monitored-source failures or extraction failure rate?
- How aggressive should near-duplicate title matching be before it risks collapsing distinct stories?
- Should GitHub discovery cover only releases at first, or also issue announcements and changelog pages when easily available?
- Should degraded-run status appear only in logs and run reports, or also inside digest frontmatter/body by default?
- When personalisation is later introduced, should it live in a simple JSON feedback file, CLI workflow, or both?
