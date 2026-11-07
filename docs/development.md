# Development

Maintainer workflows for the native MV3 extension in `extension/`. Product semantics, trust boundaries and acceptance gates are in [specs.md](../specs.md); measured coverage belongs in [validation](validation.md).

## Local checks and reload

Requires **Node.js 22+**. No dependency installation, lockfile or build step is needed.

```sh
node --test tests/*.test.cjs
node tests/check.mjs
```

After runtime changes, reload the unpacked extension at `chrome://extensions`, then refresh test X tabs. Documentation-only changes need consistency/link checks, not a new application test run.

## Dedicated-browser validation

Use the installed browser skill, but **attach only to official Google Chrome with a separate persistent user-data directory**. Agents may launch the bound dedicated Chrome directly without additional user approval when browser testing is in scope. The browser is not owned or launched by agent-browser. Never use everyday Chrome, port 9222, automatic discovery, a copied personal profile or an agent-browser-managed replacement browser. Keep the dedicated profile outside the repository and preserve its login, extension installation and settings.

### Browser binding and attachment

1. Reuse the bound dedicated Chrome if running. If it is not running, the agent or user may launch the bound official Chrome executable with the dedicated `--user-data-dir`, bound `--profile-directory` and `--remote-debugging-port=0`, enabling loopback debugging on an ephemeral port. Do not terminate a running browser to repair an unavailable endpoint. Load `extension/` through **Load unpacked** at `chrome://extensions`; launch-time extension flags and CDP extension-loading helpers are not this workflow. Let the user sign in to X if needed.
2. Use the machine-local binding at `~/.agent-browser/x-media-filter-browser.json` to identify that profile and the consistent attach-only session. Resolve the endpoint from that profile's **current `DevToolsActivePort`**; validate the bound browser before acting. A saved port or old WebSocket URL is not authoritative. Missing or conflicting executable/profile/session binding information is a blocker, not permission to discover or create another profile. An unavailable endpoint permits launching the same bound Chrome only after confirming that its dedicated profile is not running; then reread `DevToolsActivePort` and validate the new endpoint.
3. Keep the resolved browser WebSocket URL only in process memory. Never print, log, persist or commit it, including in command diagnostics. Do not use `get cdp-url` to expose it, shell tracing or literal endpoints in shell history. In the commands below, `WS` is the privately resolved value, `SESSION` is the bound attach-only session, and `TARGET` is an agent-created test tab's current target ID.
4. Use that same session with **explicit `--cdp "$WS" --pin-tab` on every agent-browser call**. Never switch a browser-owning session into attached mode or use `--auto-connect`. Actions and scoped CDP network capture must target the same bound browser and tab.

```sh
agent-browser --session "$SESSION" --cdp "$WS" --pin-tab tab new about:blank
agent-browser --session "$SESSION" --cdp "$WS" --pin-tab tab list --json
```

Confirm the unpacked extension ID in `chrome://extensions` and set `XMF_EXTENSION_ID` for the harness. Recheck it if the source path changes. Reacquire tab IDs and element references after navigation or reconnection. Keep Chrome visible for placeholder, focus, keyboard and playback checks; headless/DOM results are not headed-browser evidence.

### Regression entry point

Use only `tests/browser.mjs` as the browser regression command entry point. `tests/cdp.mjs` and `tests/media-capture.mjs` are supporting capture utilities, not alternative browser workflows.

```sh
node tests/browser.mjs "$WS" "$TARGET" "$SESSION" /tmp/xmf-cold.json cold
node tests/browser.mjs "$WS" "$TARGET" "$SESSION" /tmp/xmf-normal.json normal
```

Select affected acceptance cases from [specs.md §8](../specs.md#8-implementation-gates-and-acceptance-tests). The harness is a focused regression, not proof of every surface or setting. Browser interaction must use trusted input and current hit targets; the gallery is extension-owned, not X's native viewer. Capture the X page and extension renderer requests before navigation, including startup, SPA transitions, duplicate occurrences and video-segment attempts relevant to the change. Check visible placeholders and decoded/playable output separately from network outcomes.

**Before any preference changes**, save the original A/C/B booleans in a machine-local JSON file as `{"filters":{"a":false,"c":false,"b":true}}`, using the actual saved values rather than copying these example defaults. Pass its path through `XMF_ORIGINAL_FILTERS_FILE`. Without that variable the harness creates `<report>.original.json` exclusively before mutation and refuses to overwrite an existing record. Retain the original snapshot through retries and interruptions; never overwrite it with temporary test settings. Cleanup in `finally` is not enough for a killed process. After completion or interruption, explicitly verify and restore the saved original filters. Restore temporary target-level cache/site-worker controls and remove only test-created fixtures/helper tabs. Do not close the browser, the attach-only session or unrelated tabs, and do not use `agent-browser close`. Preserve the profile and original-settings snapshot until restoration is confirmed.

### Safety and evidence

Navigation, scrolling, media clicks, reloads and local extension testing are in scope. Do not publish posts, modify account/security settings, bypass browser consent or change security controls to overcome a denial. Connection failures remain failures; do not silently switch browser backends or retry against another profile.

Cold mode disables HTTP cache and bypasses the site worker on test targets only, then restores those controls. Normal mode retains cache/site-worker delivery; when the current X document has a dormant registered worker, the capture helper wakes it before navigation to attach network observation. A controlled page without an observed worker fails the harness rather than being reported as complete network coverage. Do not clear cookies, accounts, site storage, CacheStorage or the profile. Zero Resource Timing sizes, cached responses and DOM mocks alone do not prove zero downloads.

Keep captures local, minimal and outside tracked source. Do not retain cookies, authorization/CSRF headers, raw authenticated response bodies, HARs, unrelated account content or browser-control URLs. Record only the route/settings and network/visible outcomes needed to evaluate the change; private fixture URLs stay local. Public validation documentation summarizes current coverage and material gaps, not per-run reports or browser-version inventories. Historical native-viewer or retired-harness results do not validate the current adapter/gallery.

## Release and artwork work

Use the [store preparation guide](store/README.md) for packaging and publisher approval gates, and [assets/README.md](../assets/README.md) for artwork. Store submission/publication and account/legal actions require separate authorization.
