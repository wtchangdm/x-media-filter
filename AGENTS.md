# X Media Filter

Chrome extension for x.com that blocks post images and videos before download and replaces them with per-item click-to-load placeholders.

## Project guidance

- Use `specs.md` for product behavior, discovery evidence, acceptance criteria, and implementation gates. It distinguishes confirmed requirements from working defaults and unverified designs; do not describe proposals as proven capabilities.
- The unpacked MV3 extension is in `extension/`; no dependency installation or build step is needed. Run `node --test tests/*.test.cjs` and `node tests/check.mjs` (Node.js 22+). Installation and existing-Chrome browser commands are in `README.md`; measured coverage and gaps are in `docs/validation.md`.
- Prefer a small Chrome Manifest V3 extension using native browser APIs. Add a framework, dependency, backend, or build step only when an identified requirement needs it.
- Keep the implementation and `specs.md` aligned when behavior or verified limitations change.

## Correctness boundaries

- "Filter" means prevent unauthorized media downloads, not hide already-loaded content. CSS, MutationObserver callbacks, `preload="none"`, and post-load URL removal are not network barriers.
- Establish the pre-request blocking and per-item loading proof in `specs.md` before building the full UI. Do not substitute a broad CDN/tab allow rule for a single-media grant.
- X video playback can use XHR playlists and audio/video segments behind a `blob:` URL. Blocking only `image` and `media` request types is insufficient.
- Resolve the focused post by the current status ID, not the first article, URL handle alone, display name, or quoted author. Unknown classification must not accidentally authorize filtered media.
- Keep page-origin messages untrusted. A privileged media loader must validate its sender, current page context, grant, and media URL; never expose an arbitrary-URL fetch proxy.

## Browser validation

- Use `agent-browser` for live browser work. The user supplied CDP at `<dedicated-loopback-endpoint>` and authorized browser testing. Check availability; do not assume it is always running.
- Follow the installed browser skill, use a named session and `--pin-tab` with shared CDP, and reacquire tab IDs/element refs. Do not reuse transient IDs from earlier sessions.
- The three public regression URLs are in `specs.md`. Navigation, scrolling, media clicks, reloads, and local extension testing are in scope. Do not publish posts or change account/security settings as part of testing.
- For media/network changes, validate both network behavior and visible placeholders in real Chrome. DOM assertions, mocked requests, and zero Resource Timing sizes alone do not prove zero downloads.
- Keep captured data local and minimal. Do not commit cookies, authorization/CSRF headers, raw authenticated API bodies, HARs, or unrelated browsing content. Do not clear the user's profile or site storage to obtain a cold-cache test; use an isolated test environment or reversible debugging controls.

## Verification and handoff

- Follow the relevant acceptance cases in `specs.md`; include startup, SPA navigation, duplicate assets, and video segments when affected.
- Report the browser version, tested routes/settings, network evidence, and remaining gaps. Do not claim untested surfaces or CDN families work.
- Documentation-only changes need consistency/link checks, not an invented application test suite.
