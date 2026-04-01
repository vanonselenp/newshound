# newshound

Configurable daily digest runner. Aggregates content from RSS feeds, Hacker News, and Reddit, filters for signal via Claude, and writes markdown digests to your Obsidian vault. Each digest type is defined entirely in config — no code changes needed to add a new one.

## Prerequisites

- **Node.js 22** — install via [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use`
- **pnpm** — `npm install -g pnpm`
- **Claude Code CLI** — must be installed and authenticated (`claude` in your `PATH`)
- **Obsidian** — digests are written as markdown files to your vault

## Setup

**1. Install dependencies**
```bash
pnpm install
```

**2. Build**
```bash
pnpm run build
```

**3. Configure**
```bash
cp -r config.example ~/.newshound
```
Edit `~/.newshound/config.yaml` and set your vault path:
```yaml
vaultPath: /path/to/your/obsidian/vault
```

Each digest is a separate YAML file in `~/.newshound/digests/`. The filename becomes the digest id (e.g. `ai-tools.yaml` → id `ai-tools`). State files default to `~/.newshound/state/<id>.json` — no configuration needed.

`config.example/digests/` ships with two digests: an AI tooling digest and a job postings digest. For the job digest, fill in the `profile` field under `filterCriteria` with your background and preferences.

To add a new digest type, drop a new YAML file in `~/.newshound/digests/` — no code changes required.

**4. Test run**
```bash
pnpm run start
```

## Install as daily job (macOS)

Edit `install/com.newshound.daily.plist`, replace `REPLACE_WITH_YOUR_USERNAME` with your macOS username, and update the path to match your install location.

```bash
cp install/com.newshound.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.newshound.daily.plist
```

The job runs at 08:00 daily. If your Mac was asleep at that time, launchd runs it on next wake.

Logs: `/tmp/newshound.log` and `/tmp/newshound.error.log`

To unload: `launchctl unload ~/Library/LaunchAgents/com.newshound.daily.plist`
