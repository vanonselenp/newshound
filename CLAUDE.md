# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**newshound** (internally "AI Digest") — a scheduled TypeScript CLI script that aggregates AI tooling content from RSS feeds, Reddit, and Hacker News, filters it through Claude, and writes daily markdown digests to an Obsidian vault.

## Development approach

All work must follow **red-green-refactor TDD**:
1. Write a failing test first
2. Write the minimum code to make it pass
3. Refactor

Use the latest stable package versions.

## Commands

```bash
npm run build          # compile TypeScript
npm run test           # run all tests
npm run test -- --testPathPattern=<file>  # run a single test file
npm run test:watch     # watch mode
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
```

> These commands assume a standard Node.js/TypeScript project setup. Adjust after `package.json` is created.

## Architecture

The system is a single CLI entrypoint (`src/index.ts`) that orchestrates a pipeline:

```
Fetch sources → Filter/score content → Summarise via Claude → Write digest
```

### Key domain concepts

- **Sources** — configured in a single array (curated blogs via RSS/Atom; community sources via Reddit JSON and HN Algolia API). Adding/removing a source means editing only the config array.
- **Two-pass filtering** — community sources (HN, Reddit) go through relevance check then signal quality evaluation; curated blogs skip to signal evaluation directly.
- **State file** — `~/.ai-digest-state.json` with `{ "lastRun": "ISO timestamp" }` tracks the last successful run. On first run, defaults to 3-day lookback.
- **Claude invocation** — uses `claude --print` CLI (no API key management). Wrap in a thin adapter so tests can mock it.
- **Digest output** — one markdown file per run written to `<vault>/AI-Digest/YYYY-MM-DD.md`. Catch-up runs produce a single combined file covering the missed period.
- **Related digest linking** — before generating, read recent digests (last 7–14 days) from the vault and pass their titles/tags/summaries to Claude to detect thematic connections for frontmatter `related:` links.

### Tag vocabulary

Tags are drawn from a fixed list — do not invent new tags in code:
`tooling`, `models`, `workflows`, `pricing`, `apis`, `coding-agents`, `prompting`, `infrastructure`, `open-source`, `releases`, `ai-methodology`, `team-practices`

### Scheduling

Triggered by macOS launchd (outside this codebase). The script itself only needs to handle the catch-up logic via the state file.

## Spec

Full requirements: `spec/001-gather-content.md`
