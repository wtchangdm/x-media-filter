# Implementation evidence — 0.1.0

Validation date: **2026-10-17**.

Runtime: the user's existing **Chrome 155.0.8059.85**, attached through `agent-browser` with a named, pinned session. The reduced page user-agent reports 155.0.0.0. No independent logged-out browser was used for these acceptance results.

## Mechanism proved

The packaged static rules remain enabled for every X page media request, including XHR/fetch. There are **no URL, tab-wide, CDN-wide or `allowAllRequests` grants**. Authorized items instead receive a single-use ticket for an extension-origin renderer. Images use anonymous CORS; videos use native progressive MP4 with range requests. No Blob messaging, base64 video buffering, backend or runtime CDP dependency is involved.

The worker checks the internal sender, current tab URL, exact top-document challenge, route generation, ticket, media destination and video/poster identity (or the explicit media-entry ID for custom `/media/` covers). A response-header DNR guard rejects loader redirects, installed before any ticket can load. This is separate from the static **pre-request** page barrier; a response-header rule is not being misrepresented as prevention of an initial request.

Metadata and bounded renderer-key discovery use a document-start, nonce-bound MessagePort handoff, followed by shape/URL validation. Window-broadcast metadata and replacement handoffs are not accepted. A synthetic page `.click()` is not a user grant. The identity adapter reads only bounded keyed-entry identifiers, never React props/post bodies, to retain one occurrence through X virtualization. Unknown or colliding renderer identity falls back to an independent document-local occurrence, not a URL-based authorization.

## Local store-release preparation

Public-store preparation preserves executable runtime behavior, manifest version and permissions. The manifest description now uses the user's 83-character tagline; it is a copy change, not a media-behavior change. The [release checklist](store/README.md) links listing text, privacy/permission drafts, reviewer instructions and store artwork. No Chrome Web Store upload/submission/publication, developer-account registration, payment or Trader self-classification was performed by the assistant. The user subsequently reported contact-email verification complete; other account prerequisites were not inspected. The user confirmed free/public distribution in all available store regions, GitHub policy hosting and ChatGPT-generated supplied artwork, then authorized the same-name public GitHub repo and MIT license. Publisher/repository/date fields are now filled; final store publisher confirmation, privacy/support review and account readiness remain pending.

- `node --test tests/*.test.cjs`: **82 passed** after preparation.
- `node tests/check.mjs`: passed manifest/resources, store-image dimensions, syntax, JSON, Markdown links and whitespace. It now checks the 440×280 promo, one 1400×560 marquee, 1280×800 screenshot and 1472×920 capture source. The earlier custom compositions were replaced with direct crop/resize files at the user's request. This is a static packaging/consistency check, not browser network proof.
- Current tagline/MIT package: `python3 scripts/package.py` passes **17 runtime files plus LICENSE** (18 files), root manifest, CRC/inventory/per-file source-hash readback. ZIP size **57,014 bytes**, SHA-256 `870cc20e01a87190196747b7eb582bcb91d1b8d8af96c0b0ecfcfad813828236`. `shasum -a 256 -c SHA256SUMS` passes. Only the manifest description changes from the preceding package; executable runtime files remain unchanged. LICENSE is read from the single root source. Generated `_metadata/`, source artwork, store assets, tests and docs are excluded. Earlier hashes in Git history are superseded. No store upload/installation of this ZIP has been tested.
- Screenshot source: actual extension 0.1.0 popup document in existing **Chrome 155.0.8059.85**, named/pinned `agent-browser` session `xmf-store`; all three saved settings ON. No preference changes. Retained capture contains only the extension UI, no account/post/browser chrome or CDP URL. The newly created tab was closed. At the user's subsequent request, the exported screenshot horizontally centers the intact 720×920 popup between two 376-pixel strips of blank background from that same capture, then resizes to 1280×800. The source capture and runtime UI remain unchanged; no overlays or generated background are added. Saved all-ON settings are an example, not fresh defaults; it is not a filtering screenshot from X or native-toolbar-popup evidence.
- The initial custom Swift/AppKit compositions were rejected by the user and removed along with that exporter. Current `scripts/store-assets.sh` uses ffmpeg to crop/resize supplied artwork and center the screenshot using existing capture pixels. The cat's 1254×798 crop supplies the small promo; the wide illustration's 1980×792 crop supplies the marquee. The actual original viewport supplies a 1472×920 screenshot source, resized to 1280×800. Originals remain unchanged. No new browser interaction occurred for the crop revision, and no store acceptance is claimed.
- README and release/disclosure documentation are English. Root `PRIVACY.md` now uses GitHub owner `wtchangdm`, `https://github.com/wtchangdm/x-media-filter`, the SUPPORT.md documentation/email support route and effective date 2026-10-17; no policy placeholders remain. These public values do not verify the Chrome Web Store account or complete its final certifications. Developer registration instructions are in the release checklist.
- Before public source upload, local scans found no private-key, GitHub-token, bearer-value or browser-capability patterns in intended text files, and no user-specific absolute paths. Fourteen aggregate JSON reports parse successfully; these checks are not a universal secret-detection guarantee. The retained visual reference contains only a toggle; popup captures contain only extension UI. Generated metadata and release artifacts are ignored. Local Git author email uses GitHub noreply, not a personal email.

The tagline/documentation revision passes all 82 existing unit/protocol tests. README is user-facing; AGENTS routes tasks to the specification, development guide, validation and release documents. Developer procedures were moved rather than removed; critical network/security and browser-safety boundaries remain. Static checks cover manifest resources, document links and packaging. No media/network behavior was changed, so no new full browser/network regression is claimed. Earlier measured evidence and gaps remain. The conditional BFCache dead-coordinator hypothesis remains unmodified and unverified under native BFCache; it is neither reported as fixed nor as a demonstrated severe release blocker. No fresh Chrome 128 or full-browser-restart test was performed for this preparation.

## Documentation/email support revision

`SUPPORT.md` contains unpacked installation, filter semantics, troubleshooting, known limitations and developer-contact instructions using the verified email shown on the store listing when available. No personal email address, credentials or new diagnostics collection was added. Policy/listing/release docs now point to `/blob/main/SUPPORT.md` and describe voluntarily emailed support messages rather than public Issues records. Email verification is user-reported, not a dashboard inspection.

The store's own Item support visibility is a dashboard setting: it has not been inspected or changed; instructions tell the publisher how to turn it off if enabled. Public versus Unlisted was discussed, not changed. Both share store review/policy requirements, including meaningful support and valid contact information. User-facing support copy describes available help/contact rather than repository settings.

This is a documentation/repository-setting change only. Runtime, manifest, ZIP and browser behavior are unchanged. Verification is limited to static consistency/links, GitHub configuration/public document availability and the existing ZIP checksum, not a new application/browser regression.

## Player disconnect ownership fix

A rejected replay renderer could disconnect and delete the active renderer's entry from the worker's `players` map, preventing later worker-side `stop` delivery. Disconnect cleanup now removes an entry only if it belongs to that port. Three protocol regressions cover replay rejection/disconnection followed by settings, context or explicit revocation. All three failed before the fix and pass afterward. These are mocked-protocol results, not a real-browser replay/exploit demonstration. BFCache behavior was not changed.

A [normal-mode video regression](validation/disconnect-ownership-normal.json) after reloading the extension in the user's existing Chrome **155.0.8059.85** also passes both custom-cover and encoded-thumbnail videos: blocked placeholders and canceled page requests before selection, one authorized HTTP 206 MP4, playback/seeking to 40 seconds, duplicate-occurrence isolation, reload, filter-OFF automatic loading and filter-ON revocation. One X site-worker target was observed. This checks browser behavior without claiming an actual replay exploit was reproduced. Settings were restored and the test tab closed.

## Custom-cover video fix

The [GitHub video](https://x.com/github/status/2111225205309780009) was unavailable because its cover is `/media/...jpg`, not an ID-bearing video thumbnail. Discovery found three MP4 variants plus HLS; this was **not an MP4-only failure**. The media entry's numeric `id_str` matches the video URL's media ID and differs from the tweet ID.

The bridge now forwards that scalar ID, the isolated adapter validates it and selects a matching MP4, and the worker checks it again. A generic cover requires an explicit matching numeric ID; encoded thumbnails still require their original family/ID, and metadata cannot override a mismatch. Video occurrence identity includes the media ID. There are no new hosts, permissions, broad allows, HLS paths or dependencies.

Final existing-Chrome **155.0.8059.85** results:

- [Focused cold regression](validation/videos-cold.json) and [focused normal regression](validation/videos-normal.json) both pass for GitHub's custom cover and the original encoded-thumbnail video. Both show accessible blocked placeholders, canceled page requests and zero successful pre-click media responses; one trusted click loads exactly one canonical MP4 with HTTP **206**, playback advances beyond one second, and seeking to **40 seconds** succeeds. Duplicate DOM occurrences use real metadata/requests and remain blocked; synthetic clicks do not authorize them.
- Reload with all filters ON clears the manual grant and produces no successful media response. Turning only A OFF then loads a video without a manual grant; turning A ON revokes it. Tests restore the original settings. Cold mode disables HTTP cache and bypasses the site worker only on test targets; normal mode observes one X site-worker target. Neither clears profile/site storage.
- [Earlier post-fix broad cold regression](validation/custom-cover-integration-cold.json) passes images, quotes, all eight filter combinations, cross-tab isolation, forged inputs, worker stop/reconnect and SPA/Back, as well as both videos. Its original automatic-eligibility assertion retained a manual selection; the report marks that limitation, and the final focused runs prove independent automatic loading after reload.

Some retries were interrupted by unavailable targets/CDP connections. A later broad run reached Chrome but timed out on its focused-post/both-conversation-category discovery prerequisite; it did not complete and is not presented as another broad pass. The focused video harness avoids relying on unrelated replies. An initial focused-harness wait also required whole authorized range streams to finish; native video may keep a range open while paused. It now waits for page-request cancellation outcomes and asserts authorized HTTP responses plus actual playback/seek, not full-video download completion. No application safeguards were weakened for those harness corrections.

## Current three-filter and grouped-image results

The same existing Chrome **155.0.8059.85** was used on 2026-10-17, with no new profile or storage clearing. Fresh-install defaults are A OFF / C OFF / B ON; complete legacy `{a,b}` preferences initialize C from A. Existing saved ON preferences were preserved, and test settings were restored to all three ON.

- [Three-filter normal-mode regression](validation/three-filters-normal.json): all eight A/C/B combinations, cross-tab propagation/isolation, duplicate occurrences, synthetic clicks and forged metadata, images, quoted image, video playback/seeking to 40 seconds, worker stop/reconnect and SPA/Back pass. Normal capture observed the X site worker and a service-worker-controlled document. Matrix/duplicate isolation includes DOM fixtures, not mocked network responses.
- [Native album, cold](validation/groups-cold.json) and [normal](validation/groups-normal.json): the [supplied OpenAIDevs post](https://x.com/OpenAIDevs/status/2110855382444704190) has **three** native still images. Before click, no captured media response succeeds; page requests fail with `net::ERR_BLOCKED_BY_CLIENT`. A trusted click on one accessible placeholder creates three individually validated players and all three images decode. Exactly three canonical assets succeed from extension documents (HTTP 200); eight cold / eleven normal page requests remain canceled. A duplicate article and quoted attachment (controlled DOM fixtures using real asset URLs), other posts including a video, and a second native X tab remain blocked. Category reblocking and reload revoke the group. Normal mode observes one X site-worker target; cold mode bypasses it without deleting storage.
- [Current virtualization regression](validation/three-filters-virtualization.json): a real category-C reply detaches/remounts as a new article, restoring only its selected canonical image; eleven page requests remain blocked.
- [Current popup](validation/three-filters-popup.json): exact three labels, no footer, no horizontal overflow, Tab reaches A, and emulated light/dark OS preferences both retain `color-scheme: dark` and the same dark background. axe-core 4.12.1 reports **30 passes, zero violations/incomplete**. This is the popup document opened as an extension page, not every native-toolbar/forced-color combination. Static barrier and redirect guard remain enabled.
- The manifest and toolbar declare the new user-supplied cat icon at 16/32/48/128 px. Packaging checks validate each PNG's dimensions. Icon and two marquee source copies are byte-identical to their Downloads originals; no originals were edited and no store publication occurred. See [artwork notes](../assets/README.md).

Fresh defaults, legacy migration, independent revocation and storage-read races have offline coverage, not a claim of real fresh-install or full-browser-restart validation. These runs did not repeat every earlier surface test. An initial album-harness attempt expected X to retain a blocked `<img>`; X had removed it. The harness now uses an already captured native image URL for its controlled quote fixture; production code was not changed to expose URLs or weaken grants.

## Earlier two-filter baseline (historical)

The following reports predate the three-filter/grouped-image changes; A then included same-author replies, and image clicks selected one attachment. They document prior coverage, not current eight-combination or album evidence.

See the minimal aggregate reports:

- [Cold HTTP cache, site worker bypassed](validation/cold.json)
- [Normal cache and active site worker](validation/normal.json)
- [Real X virtualization/remount](validation/virtualization.json)
- [Additional surfaces](validation/surfaces.json)
- [Popup keyboard/a11y and extension error state](validation/popup.json)

The three regression routes are the public image thread, video post and quoted-image post linked in [specs.md](../specs.md). Both A/B mixed states and both-OFF were exercised, with settings propagated to a second fresh X tab. Synthetic duplicate DOM occurrences included the same post/asset and an identical image URL under another author; these are controlled DOM fixtures, **not a claim of native multi-image/mixed-media X coverage**. No network responses were mocked.

| Case | Evidence |
| --- | --- |
| Both ON, fresh navigation | Media attempts are canceled with `net::ERR_BLOCKED_BY_CLIENT`; no successful unauthorized media response in the selected page/renderer capture. The normal run also observes the active X site-worker target. |
| One image / quoted image | Exactly one canonical asset succeeds from an extension target; decoded image width is positive and the image is visibly rendered. Siblings and duplicate occurrences remain placeholders. |
| Video | Poster is blocked before click. After click, only the selected MP4 succeeds with HTTP 206. Native playback advances beyond one second; a seek to 40 seconds completes. No forced autoplay in the extension. |
| Mixed A/B settings | DOM classification and loaded occurrences match each setting; all page-origin media attempts remain blocked. Identical URLs in the opposite category are not broadly released. |
| Tab isolation | The second X tab remains blocked after a manual click in the first; later global setting changes affect both tabs. |
| Lifecycle | Extension reload before navigation, forced shutdown of this extension's worker, reconnect, same-document SPA navigation and Back are exercised. Old grants are revoked on route changes. |
| Virtualization | A real same-author reply's old article becomes detached. On scrolling back, a different DOM article with the same keyed timeline occurrence restores only that asset's grant. |
| Page-origin forgery | Programmatic placeholder clicks, forged window metadata and a replacement MessagePort handoff do not grant media or change eligibility. |
| Other surfaces | Home, the public author's profile, media grid and search show local placeholders with canceled media requests. Native image viewer has its own selectable placeholder. Avatars continue to load. |
| Popup | Saved switches are both ON, Tab reaches the first switch, and axe-core 4.12.1 reports 30 passes, zero violations and zero incomplete checks on the popup document. Chrome reports no current manifest/runtime errors after the final regression suite. |

Capture starts before navigation. It enables Network observation for the selected tab and extension iframe targets before those frames run, and additionally attaches to the active `https://x.com/sw.js` worker in normal mode (one worker target observed). Worker observation does not alter its cache/bypass settings or stop it; DevTools attachment can keep it alive, so this is not a test of natural site-worker idle shutdown. The recorder retains outcomes/encoded bytes and only credential-header **presence booleans**, never cookies, authorization values, API bodies or HARs. Reversible CDP cache/service-worker controls are restored afterward; the user's storage/profile is not cleared.

A zero byte count on a successful warm-cache image is **not** being treated as prevention. Blocking evidence is the canceled page request; decoded pixels and extension-owned successful responses are separate evidence of authorized loading. Byte totals describe the captured interval, not the complete video's size or an end-to-end performance benchmark.

## Offline checks

```sh
node --test tests/*.test.cjs
node tests/check.mjs
```

82 current unit/protocol tests cover OFF/OFF/ON defaults, legacy migration, all eight toggle combinations, independent A/C/B revocation, focus/relationship policy, URL normalization and rejection, video/poster and custom-cover media-ID binding (including missing/malformed/wrong IDs and encoded-thumbnail mismatches), single redemption, rejected-replay disconnect isolation, sender/tab/document/epoch boundaries, asynchronous revocation, settings-read races and redirect-guard installation failure. Packaging checks also verify the manifest's new icon resources and PNG dimensions. These mocks do not prove Chrome network behavior; the browser runs above do that for the exercised deliveries. The integration harness waits for media request outcomes, distinguishes canonical image assets from URL/format variants, and uses browser request timestamps rather than treating event delivery time as transmission time.

## Remaining gaps and ceilings

- **No full Chrome restart** was performed on the user's active profile. Persistence is implemented with `chrome.storage.local`; worker restart and extension reload are exercised, not substituted for a full-browser restart claim.
- Bookmarks and notifications were visited, but had no post media in the available account state. Lists/Communities and deliberately selected promoted/recommended examples remain unverified.
- The supplied native three-image post is verified. Other album layouts, mixed-media posts, animated GIFs, quoted videos and additional video/CDN families need dedicated live fixtures. Controlled quote/duplicate tests are not a substitute for native multi-image quotes or mixed-media coverage.
- Playback is fixed-rendition progressive MP4, not adaptive HLS. HLS-only, live, paid or third-party media can remain unavailable. Original X-origin video requests are still blocked by the packaged `video.twimg.com` rule.
- No redirect response occurred in the live regression assets. Guard installation/failure handling is tested; rejecting an actual redirecting CDN response is not yet a positive browser test.
- A future X renderer without the inspected stable entry keys may require a new click after full DOM replacement. Ambiguous keys revoke rather than guess. Manual history is bounded to 1,000 grants; post metadata to 2,000 entries; live worker items and pending identity work are bounded.
- The guarantee applies to the listed delivery families and recognized post UI. New hosts/paths, inline media in required API/HTML, and out-of-scope X features require renewed discovery. Install/update cannot undo earlier transfers, and existing X documents must be refreshed to install the new UI scripts.

## Short manual regression

1. Refresh each supplied status URL with all three filters ON; expect one placeholder per recognized attachment and readable post text/actions.
2. Click/keyboard-load an image; all still images in the same attachment-post/occurrence group load. Other posts, separate quote groups, videos and another X tab must remain blocked. A video click loads only that video.
3. Exercise all eight A/C/B combinations. On the quote example, confirm focus is the second article, not the ancestor or quoted author.
4. Play and seek the selected video; turn its category ON and confirm playback/loading stops.
5. Navigate within X, Back/Forward, reload, and revisit a virtualized reply. No grant may transfer to another post/item.
6. After a user-authorized full Chrome restart, confirm saved switches and the no-download startup baseline. This last case remains outstanding in this session.
