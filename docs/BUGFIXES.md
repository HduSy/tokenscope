# Bug Log

A record of bugs hit during development, each with its symptom, root cause, and
fix. Newest first. Useful as a reference for similar issues.

---

## Data accuracy (call counting)

### 1. Skills invoked via slash command were not counted

- **Symptom**: Calling a skill with `/find-skills` never showed up in the panel;
  the count stayed on an unrelated skill (`summary-recorder`).
- **Cause**: A slash-command invocation is logged as a **`user` message** with a
  `<command-name>/find-skills</command-name>` tag — **not** as a `Skill`
  `tool_use` block. The parser only looked at `tool_use`, so slash-command
  skills were invisible. (`summary-recorder` was a real, older `Skill` call that
  happened to fall inside the visible time window.)
- **Fix**: Added `parse_user_command` in `store.rs` to extract the skill name
  from the `<command-name>` tag. These command events carry no model/tokens, so
  `Agg.add` in `parser.rs` guards request/model accounting with
  `!model.is_empty()` to avoid inflating request counts or creating an
  empty-named model. Bumped `STORE_VERSION` to force a one-time full rescan.

### 2. Tool calls dropped when one message spanned multiple log lines

- **Symptom**: A model-invoked skill (`skill-creator`) produced a real `Skill`
  `tool_use`, yet still wasn't counted.
- **Cause**: A single assistant message (same `message.id`) is split across
  several JSONL lines — e.g. `thinking` on one line, `tool_use` on the next,
  **both repeating the same `usage`**. The store deduped **by `message.id` and
  dropped whole duplicate lines**, so the line carrying the `tool_use` was
  discarded after the `thinking` line was ingested first. This also silently
  dropped MCP calls in the same shape.
- **Fix**: Replaced the drop-on-duplicate logic in `store.rs` with a
  merge: keep an `id → index` map, and when a line repeats a known id, **merge
  its `mcp`/`skills` into the existing event without re-counting tokens** (usage
  is identical across the split lines, so it's still counted once). Bumped
  `STORE_VERSION` for a full rescan.

### 3. Delta percentage was ~100× too small (and hidden)

- **Symptom**: The Day view showed no change percentage next to Total tokens.
- **Cause**: `pct_delta` computed `((cur-prev)/prev*100).round()/100`, which
  cancels the `×100` and returns a **fraction** (e.g. `0.2`) instead of a
  **percentage** (`20`). The UI rounds the value to an integer for display, so
  `0.2 → 0%`, and the "hide when 0" rule then hid it entirely.
- **Fix**: Changed `pct_delta` to `((cur-prev)/prev*10000).round()/100`, which
  returns a real percentage with 2 decimals (e.g. `20.47`).

---

## Release & distribution (CI)

### 4. Release CI failed: empty Apple signing env var

- **Symptom**: The `v0.1.1` build failed at the bundle step with
  `security: SecKeychainItemImport: ... parameters ... not valid` /
  `failed to import keychain certificate`.
- **Cause**: The workflow passed `APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}`,
  but the secret didn't exist, so it became an **empty string**. Tauri's bundler
  treats the env var's *presence* as "a certificate was provided" and tries to
  `security import` empty data, which fails. (Local builds were fine because the
  var was *unset*, not empty.)
- **Fix**: Commented out the Apple signing/notarization env in `release.yml`
  until the real secrets exist. The build now does ad-hoc signing, like local.

### 5. GitHub Release had no .dmg / .app — it was a draft

- **Symptom**: "The release has no artifacts."
- **Cause**: `releaseDraft: true` — the build *did* succeed and attach the
  `.dmg` + `.app.tar.gz`, but a **draft release is invisible in the public
  Releases list** and its asset URLs return 404, so Homebrew can't download it.
  (The artifacts were also not in the Actions "Artifacts" tab, because
  `tauri-action` uploads to Releases.)
- **Fix**: Set `releaseDraft: false` so each tag publishes immediately and the
  asset URL is live for the Homebrew step and `brew install`.

### 6. Homebrew Cask step would hash a 404 page

- **Symptom**: Latent — the cask `sha256` could be computed from an error page.
- **Cause**: The cask step fetched the asset with `curl -sL` (no `-f`), so a 404
  returned `0` and the GitHub error HTML got hashed into a bogus checksum,
  breaking `brew install` with a `sha256 mismatch`.
- **Fix**: Use `curl -fsSL` so a missing asset fails and retries; fail loudly
  (`exit 1`) if the asset never appears.

### 7. DMG name didn't match the tag

- **Symptom**: A `v0.1.1` tag would build `Tokenscope_0.1.0_universal.dmg`,
  which the cask step (computing the name from the tag) couldn't download → 404.
- **Cause**: Tauri names the artifact from the version in `tauri.conf.json`,
  which was still `0.1.0` while the tag was `v0.1.1`.
- **Fix**: Bump the version in `package.json`, `tauri.conf.json`, and
  `Cargo.toml` (+ `Cargo.lock`) so the built DMG name matches the tag the cask
  step expects.

---

## App behavior & packaging

### 8. Two menu-bar icons after reinstall

- **Symptom**: Reinstalling/relaunching left two Tokenscope icons in the menu
  bar.
- **Cause**: No single-instance guard — a second launch started a second
  process with its own tray icon.
- **Fix**: Added `tauri-plugin-single-instance` (registered first) so a second
  launch hands off to the running instance (showing the popover) and exits.

### 9. Unsigned app blocked by Gatekeeper on first open

- **Symptom**: "Apple cannot verify Tokenscope.app is free of malware."
- **Cause**: The build is unsigned/unnotarized, and Homebrew adds a quarantine
  attribute to installed apps.
- **Fix**: Added a `postflight` to the cask that runs `xattr -cr` on the
  installed app, so `brew install` opens cleanly. (The `.dmg` path still needs a
  manual right-click → Open or `xattr -cr`; a full fix needs Developer ID
  signing + notarization.)

### 10. App icon had opaque white corners

- **Symptom**: The rounded app icon showed white square corners in Launchpad.
- **Cause**: The icon PNGs had a white (opaque) background in the corners
  instead of transparent alpha.
- **Fix**: Regenerated the icon from a clean transparent source
  (`scripts/gen_icon.py`, 4× supersampled), then ran `pnpm tauri icon` to
  produce every size + `icon.icns` / `icon.ico` with transparent corners.

---

## Notes

- "Month" was also changed from a rolling 30-day window to the **current
  calendar month vs the previous calendar month** — a behavior change requested
  during testing, not a bug.
- Delta colors were swapped so usage/cost **up = red** (bad), **down = green**
  (good).
