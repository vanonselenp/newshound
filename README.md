# newshound

Daily AI tooling digest. Aggregates content from curated blogs, Hacker News, and Reddit, filters for practical signal via Claude, and writes a markdown digest to your Obsidian vault.

## Setup

**1. Install dependencies**
```bash
pnpm install
```

**2. Build**
```bash
npm run build
```

**3. Configure**
```bash
cp config.example.json ~/.ai-digest-config.json
```
Edit `~/.ai-digest-config.json` and set your vault path:
```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "stateFilePath": "~/.ai-digest-state.json",
  "lookbackDays": 3
}
```

**4. Test run**
```bash
npm run start
```

## Install as daily job (macOS)

Edit `install/com.newshound.daily.plist` and replace `REPLACE_WITH_YOUR_USERNAME` with your macOS username, and update the path to match your install location.

```bash
cp install/com.newshound.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.newshound.daily.plist
```

The job runs at 08:00 daily. If your Mac was asleep at that time, launchd runs it on next wake.

Logs: `/tmp/newshound.log` and `/tmp/newshound.error.log`

To unload: `launchctl unload ~/Library/LaunchAgents/com.newshound.daily.plist`
