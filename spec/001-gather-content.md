# AI Digest — PRD

## Problem

Keeping up with practical, actionable AI tooling developments is hard. The signal-to-noise ratio across blogs, Reddit, and Hacker News is low. Most content is hype, speculation, or benchmarks without practical implications. The useful stuff — "here's how to actually use this" — gets buried.

## Solution

A scheduled local script that aggregates AI content from curated and community sources, uses Claude to filter for practical signal, and writes a markdown digest into an Obsidian vault. The digest accumulates as searchable, taggable knowledge — not ephemeral notifications.

## User

Staff engineer at The Economist, working on a TypeScript/frontend-oriented team that also owns backend services (AWS Lambda, CloudFront, ECS, serverless). Background in platform migrations, caching architecture, and system reliability. Currently investing in AI-assisted development methodology — not just using the tools, but developing repeatable processes for how engineers collaborate with AI effectively (spec-driven workflows, encoding vs autocomplete, agents.md conventions). Publicly documenting this learning journey and building educational material for other engineers.

Wants to stay current on practical AI tooling developments without manually scanning sources. "Practical" here means three things specifically:

1. **Things to apply to daily engineering work** — new tool capabilities, workflow patterns, IDE integrations, prompt techniques
2. **Things to inform how the team works with AI** — methodology insights, collaboration patterns, case studies of real teams using AI tools
3. **Things relevant to the stack** — TypeScript, AWS serverless, frontend architecture, Node.js ecosystem

---

## Sources

### Curated blogs (summarise directly)

| Source | Feed type |
|---|---|
| Anthropic Blog | RSS |
| OpenAI Blog | RSS |
| Cursor Changelog | RSS |
| Vercel Blog | RSS/Atom |
| Simon Willison's Blog | Atom |
| Latent Space | RSS |

### Community sources (filter first, then summarise)

| Source | Method | Minimum score |
|---|---|---|
| Hacker News | Algolia API, keyword search | 50 |
| r/ClaudeAI | Reddit JSON feed, top/day | 20 |
| r/cursor | Reddit JSON feed, top/day | 20 |
| r/LocalLLaMA | Reddit JSON feed, top/day | 30 |
| r/ChatGPT | Reddit JSON feed, top/day | 50 |

Sources should be configurable — adding or removing a source should mean editing a single config array and rebuilding.

---

## Signal filter

All content is evaluated by Claude against two categories:

### High signal (include and summarise)

- New tool releases, features, or APIs with concrete capabilities (especially Claude Code, Cursor, Copilot, Codex)
- "I built X with Y" posts showing real workflows or architectures
- Practical tutorials, patterns, or techniques for AI-assisted development
- AI collaboration methodology — how teams/individuals structure their work with AI tools (spec-driven development, context management, agent configuration)
- Meaningful performance improvements or cost reductions in AI tooling
- Changes to pricing, rate limits, or availability that affect daily work
- Workflow tips: prompt engineering, agent configuration, IDE integration
- Infrastructure/platform content relevant to TypeScript, AWS serverless, or frontend architecture when AI-related
- Case studies of engineering teams adopting AI tools at scale

### Low signal (discard)

- Hype, speculation about AGI timelines, or "AI will replace X" takes
- Fundraising announcements or company drama
- Benchmark comparisons without practical implications
- Philosophical debates about AI safety/alignment (unless actionable)
- Listicles, ragebait, or engagement-farming posts
- Vague product announcements without concrete details
- Content focused purely on ML/AI model training (unless it directly affects tool usage)
- Enterprise sales pitches disguised as blog posts

Community sources (HN, Reddit) get a two-pass filter: first check relevance, then evaluate signal quality. Curated blogs are assumed relevant and go straight to signal evaluation.

---

## Output format

### File structure

One markdown file per run, written to a configurable Obsidian vault folder (synced via Dropbox):

```
<vault>/AI-Digest/2026-03-29.md
```

When catching up after missed days, a single combined digest is produced for the entire period, dated to the current day.

### Frontmatter

```yaml
---
date: 2026-03-29
period: 2026-03-27 to 2026-03-29    # only present if covering multiple days
tags:
  - ai-digest
  - tooling
  - models
  - workflows
sources_scanned: 47
items_surfaced: 6
items_filtered: 41
related:
  - "[[2026-03-26]]"                 # only present if strong thematic connection
---
```

**Tags** are drawn from a flat, consistent list. Suggested starter set:

`tooling`, `models`, `workflows`, `pricing`, `apis`, `coding-agents`, `prompting`, `infrastructure`, `open-source`, `releases`, `ai-methodology`, `team-practices`

Claude should select from this list rather than inventing new tags, to keep Dataview queries stable. New tags can be added to the list manually over time.

### Body structure

```markdown
# AI Digest — 2026-03-29

## Read in full

2-3 articles worth reading beyond the summary. Each entry includes:
- Link and source
- One sentence on WHY this is worth reading in full (what you'll get from the original that the summary can't capture)

## High signal

For each item:
- Linked title
- Source name
- 2-3 sentence summary of what it is and why it matters practically
- One-line actionable takeaway (what could you do with this)

## Worth knowing

Shorter entries — one line each with linked title, source, and a single sentence.

---

*N items filtered as low-signal.*
```

### Quiet days

If no items clear the signal threshold, a stub file is still written:

```markdown
---
date: 2026-03-29
tags:
  - ai-digest
sources_scanned: 34
items_surfaced: 0
items_filtered: 34
---

# AI Digest — 2026-03-29

*Nothing cleared the signal threshold today.*
```

This confirms the script ran and sources were checked.

---

## Related digest linking

Each digest should be aware of recent past digests (last 7-14 days). When today's content has a strong thematic connection to a previous digest — e.g. a follow-up release, a contrasting take on the same topic, or an evolution of something previously flagged — the related digest should be linked in frontmatter as an Obsidian wikilink.

"Strong connection" means a direct relationship, not just overlapping tags. Two digests both tagged `tooling` is not enough; a Cursor update following up on a Cursor update flagged three days ago is.

This requires the script to read recent digest files from the vault before generating the new one, and pass their titles/tags/summaries to Claude as context.

---

## Scheduling and catch-up

- **Trigger**: macOS launchd, scheduled daily
- **Missed runs**: launchd runs the job on next wake if the laptop was asleep at the scheduled time
- **Lookback**: On each run, the script checks the date of its last successful run (persisted in a local state file). It fetches all content published since that date — no fixed lookback window
- **Catch-up output**: One combined digest covering the full missed period, not separate files per day
- **State**: A simple JSON file (e.g. `~/.ai-digest-state.json`) storing `{ "lastRun": "ISO timestamp" }`
- **First run**: If no state file exists, look back 3 days as a sensible default

---

## Technical decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Matches existing skill set and team context |
| LLM invocation | Claude Code CLI (`claude --print`) | No API key management, uses existing auth |
| Scheduling | macOS launchd | Handles missed runs on wake, no server needed |
| Delivery | Direct file write to Dropbox-synced vault folder | Zero infrastructure, Obsidian picks it up automatically |
| RSS parsing | Lightweight, no heavy dependencies | Standard XML string parsing covers most feeds |
| Reddit access | Public JSON feeds (no auth) | Simpler setup, sufficient for top/day queries |
| HN access | Algolia API | Free, fast, supports score filtering |

---

## What's out of scope for MVP

- GitHub Trending as a source (add later)
- Google DeepMind blog (add later)
- Any web UI or dashboard
- Notification/alerting for high-priority items
- Full-text fetching of linked articles (just work from RSS descriptions and post content)
- Multi-user support
- Automated tag list expansion

---

## Success criteria

After one week of use:

1. Opening the vault shows a digest for each day the laptop was on (or a combined catch-up digest)
2. At least 70% of "high signal" items feel genuinely useful — not noise
3. The "read in full" picks consistently surface things worth clicking through to
4. Tags are consistent enough to write a Dataview query like "show me all tooling items from the last 30 days"
5. Total setup time under 30 minutes
