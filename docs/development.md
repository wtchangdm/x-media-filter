# Development

Maintainer workflows for the native MV3 extension in `extension/`. Read the section needed for the task. For implementation choices and security boundaries, use [specs.md §10](../specs.md#10-selected-implementation-and-verified-boundaries); product behavior and acceptance cases remain in that specification, not this guide.

## Local checks and reload

Requires **Node.js 22+**. No dependency installation, lockfile, backend or build step is needed.

```sh
node --test tests/*.test.cjs
node tests/check.mjs
```

After runtime changes, reload the extension at `chrome://extensions`, then refresh the test X tabs. Documentation-only changes need the static consistency/link check; do not invent application tests for copy edits.

## Existing-Chrome browser validation

Use the installed browser skill and `agent-browser`, attached only to the **user's already-running Chrome**. The authorized debug endpoint is `<dedicated-loopback-endpoint>`; check availability rather than assuming it is running. Never launch another clean/logged-out browser or alter browser security settings to bypass a denial. CDP is a development tool, not an extension runtime requirement.

Use a named session and `--pin-tab` with shared CDP. Create a fresh test tab:

```sh
agent-browser --session xmf-check --auto-connect --pin-tab tab new about:blank
agent-browser --session xmf-check get cdp-url
agent-browser --session xmf-check tab list --json
```

Use the current browser WebSocket URL and the **new test tab's `targetId`**. Reacquire IDs and element refs after navigation/reconnection; do not reuse stale values or select an unrelated user tab. Below, `<WS>` and `<TARGET>` stand for those fresh values.

```sh
node tests/load.mjs '<WS>'
node tests/browser.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-cold.json cold
node tests/browser.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-normal.json normal
node tests/groups.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-groups-cold.json cold
node tests/groups.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-groups-normal.json normal
node tests/videos.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-videos-cold.json cold
node tests/videos.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-videos-normal.json normal
node tests/virtualization.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-virtualization.json
node tests/surfaces.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-surfaces.json
node tests/scope.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-scope-cold.json cold
node tests/scope.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-scope-normal.json normal
node tests/layout.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-layout-cold.json cold
node tests/layout.mjs '<WS>' '<TARGET>' xmf-check /tmp/xmf-layout-normal.json normal
```

These are available harnesses, not a requirement to run every one for every change. Select affected acceptance cases from [specs.md §8](../specs.md#8-implementation-gates-and-acceptance-tests). Public regression routes and discovery provenance are in [§6](../specs.md#6-discovery-evidence). Measured results and gaps are in [validation evidence](validation.md).

`load.mjs` uses development-only `Extensions.loadUnpacked`. If Chrome denies it, use the manual installation/reload procedure instead; do not change security controls. If a different project path changes the unpacked extension ID, set `XMF_EXTENSION_ID` to the ID returned by `load.mjs` before running `browser.mjs`.

`browser.mjs` temporarily changes popup settings, creates test/helper tabs and adds removable duplicate-attachment DOM fixtures. It restores settings and closes its helper tabs afterward. It stops only **this extension's** worker to test recovery, not X's or another extension's worker. `scope.mjs` checks native avatar zoom, non-post selector fixtures, a post image viewer and post-to-profile SPA navigation; it temporarily enables all filters and restores preferences. `virtualization.mjs` and `surfaces.mjs` require all three filters ON, not fresh-install defaults. `layout.mjs` checks the supplied viewer sidebar after direct hard refresh (`ignoreCache`), native post-to-viewer SPA navigation and another hard refresh. It checks bounded, borderless placeholders, selected-image loading and duplicate isolation; it restores temporary all-ON settings and removes its duplicate fixture. Restore user settings and close only tabs created for the test.

### Safety and evidence

Navigation, scrolling, media clicks, reloads and local extension testing are in scope. Do not publish posts or change account/security settings while testing. Media/network changes need both visible-placeholder and real Chrome network evidence; DOM assertions, mocked requests and zero Resource Timing sizes alone do not establish zero downloads.

Cold mode temporarily disables HTTP cache and bypasses the site worker on test targets only, then restores those controls. Do not clear the user's profile, cookies, accounts, site storage or CacheStorage. Use reversible test-target controls for cold-cache work in the authorized existing Chrome; do not launch another browser/profile.

Keep captures local and minimal. Do not commit cookies, authorization/CSRF headers, raw authenticated API bodies, HARs, unrelated browsing content or browser-control URLs. Reports retain aggregate outcomes and credential-presence booleans, not credential values. CDP URLs grant browser control: do not commit or share them.

Report the tested Chrome version, exact routes/settings, network evidence and remaining gaps. Include affected startup, SPA, duplicate-occurrence and video-segment cases. Do not turn missing media fixtures or historical runs into current universal-support claims.

## Release and artwork work

Use the [store preparation guide](store/README.md) for packaging, listing fields and publisher actions. Artwork sources, crop coordinates and screenshot provenance are in [assets/README.md](../assets/README.md). Store submission/publication and account/legal actions require their own authorization; changing developer documentation does not imply it.
