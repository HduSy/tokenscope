# Tokenscope

**English** · [中文](README-zh.md)

A macOS menu-bar app that shows your Claude CLI **daily token usage, estimated cost, and per-model / MCP / Skill call breakdown**.

Stack: **Tauri 2 + React + TypeScript** (frontend) / **Rust** (data layer).

![Tokenscope panel (dark / light)](docs/screenshot.png)

## What it does

- Shows today's token count next to the menu-bar icon (e.g. `⬡ 14.00M`)
- Click to open the panel: Day / Week / Month toggle
- Metrics: total tokens (input/output), estimated cost, requests / sessions
- Three breakdowns: **by model** / **by MCP call** / **by Skill call**
- Cost donut (hover for a single model), year-long activity heatmap
- **Counts only the MCP servers / Skills you installed yourself** — all Claude built-in tools and Anthropic's bundled MCP servers are filtered out

## Data sources (zero-intrusion, read-only)

| Purpose | Path |
|---------|------|
| Session logs (tokens / model / tool calls) | `~/.claude/projects/**/*.jsonl` |
| User MCP whitelist | `~/.claude.json` → `mcpServers` + `projects[*].mcpServers` |
| User Skill whitelist | `~/.claude/skills/` directory |
| Model prices | **Primary**: [models.dev](https://models.dev/api.json) (bare model names, matching Claude CLI logs) → **Fallback**: [LiteLLM](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) → built-in snapshot. Cached in `~/Library/Caches/tokenscope/`, refreshed every 24h, with offline fallback |

### Key processing
- Deduplicated by `message.id` (streaming/retries repeat the same usage); when one message spans multiple lines, its tool calls are merged and the token usage is counted once
- Token split: `input` (uncached) / `cache` (creation+read) / `output`; the UI folds cache into "In" by default and shows a separate "cached %"
- Price matching: exact id → normalized id (strip vendor prefix + `.`↔`p`, e.g. `glm-5.1`⇄`glm-5p1`); models.dev's official bare-name price wins
- Cost is priced per the four token types; each model carries a `priced` flag — **models not found in either source still count tokens but are labelled "no price" in the UI**
- Logs contain only the bare model name (no vendor) → third-party models default to the official vendor price (an estimate)
- Tool classification: `mcp__<server>__*` where the server is in your config → MCP; a Skill call (the `Skill` tool's `input.skill`, or a `/skill` slash command) whose name is in your skills directory → Skill; everything else is ignored

> Cost is an **estimate** based on public prices; subscription users should read it as "equivalent spend value".

## Install

### Option 1: Homebrew (recommended)

```bash
brew install --cask hdusy/tokenscope/tokenscope
```

The cask's `postflight` strips the quarantine attribute (`xattr -cr`) automatically, so **it opens on first launch without the "Apple cannot verify" prompt**.

After you open it once it registers as a login item, then **launches in the menu bar automatically on every boot**.

Upgrade:

```bash
brew upgrade --cask tokenscope
```

### Option 2: Download the .dmg

1. Download the latest `Tokenscope_*_universal.dmg` from [Releases](https://github.com/HduSy/tokenscope/releases) (works on both Apple Silicon and Intel)
2. Drag it into Applications
3. Because the build is **unsigned / unnotarized**, Gatekeeper blocks the first launch — pick one:
   - Right-click the app → **Open** → confirm **Open** again, or
   - Run once in the terminal:
     ```bash
     xattr -cr /Applications/Tokenscope.app && open /Applications/Tokenscope.app
     ```

> Unsigned is a current known limitation. A true "double-click to open" experience requires Apple Developer ID signing + notarization — see `PRD.md` §6.4.

### After first launch

- An icon plus today's token count appears in the menu bar (e.g. `⬡ 12.40M`)
- Left-click the icon to toggle the panel; right-click for the menu (Open / Refresh / Quit)
- **Launch-at-login is set up automatically** — no manual configuration needed

## Develop

```bash
pnpm install
pnpm tauri dev         # launch the desktop app (requires the Rust toolchain)
```

Frontend-only preview (using the real-data snapshot `public/dev-dashboard.json`):

```bash
pnpm dev               # http://localhost:1420
# refresh the snapshot:
cd src-tauri && cargo run --example dump > ../public/dev-dashboard.json
```

## Build

```bash
pnpm tauri build       # outputs .app / .dmg to src-tauri/target/release/bundle/
```

For distribution see `PRD.md` §6.3 (Homebrew Cask recommended; direct `.dmg` downloads benefit from code signing + notarization).

## Structure

```
src/                  React frontend
  data.ts             types + Tauri bridge + theme + formatting
  charts.tsx          chart primitives (bars / donut / sparkline / heatmap / segmented control)
  App.tsx             main panel
src-tauri/src/
  store.rs            incremental JSONL ingest (dedup by message.id + multi-line merge)
  parser.rs           aggregation (Day/Week/Month + heatmap)
  pricing.rs          models.dev / LiteLLM price loading and costing
  config.rs           user MCP / Skill whitelist
  model.rs            data structures returned to the frontend
  lib.rs              Tauri commands + menu-bar tray
```

## Bug log

Notable bugs found during development — symptom, root cause, and fix — are
collected in [docs/BUGFIXES.md](docs/BUGFIXES.md).
