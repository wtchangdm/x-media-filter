# X Media Filter — specification

The source targets **current X only**, with a semantic DOM adapter and fully extension-owned image gallery. Requirements below are not universal compatibility claims; see [measured coverage](docs/validation.md) and [release gates](docs/store/README.md#release-gates).

## Find the relevant detail

- Product semantics: §§1–5. Current integration contract: §6.
- Platform/security boundaries: §§7 and 10. Acceptance gates: §8.
- Commands and browser safety: [development guide](docs/development.md). Coverage: [validation](docs/validation.md).
- Store preparation: [release guide](docs/store/README.md). User installation/help: [README](README.md) and [SUPPORT](SUPPORT.md).

## 1. Goal and confirmed requirements

Filtering prevents unauthorized image/video downloads on X post surfaces; it does not merely hide downloaded content. Broad surface coverage is a product goal, not a claim that every current layout has passed validation.

| Requirement | Behavior |
| --- | --- |
| Tagline | **Browse X without needing to bleach your eyes.** Use this exact text in README and the store/manifest short description. It is branding, not automatic content classification. |
| Media | Post images and videos, with local click-to-load placeholders. |
| Control A (`a`) | **Filter media on post**: focused post and independent posts, including non-status surfaces. Default OFF. |
| Control C (`c`) | **Filter media on author replies**: conversation replies and ancestors by the focused author. Default OFF. |
| Control B (`b`) | **Filter media on non-author comments**: conversation replies and ancestors by other authors. Default ON. |
| Focus | The status ID in the current URL determines the focused post, not article position, URL handle alone or quoted author. |
| Popup | Exact labels above, in A/C/B order; dark-only, no footer, accessible switches and visible focus. |
| Manual loading | A still-image click authorizes its attachment-post group in one rendered occurrence. A video click authorizes only that video. Each renderer requires a separately validated ticket. |
| Enlargement | A fully extension-owned image gallery, not an overlay inside X's native viewer. |
| Persistence | Save only filter settings locally and propagate across X tabs. Preserve legacy `{a,b}` as `{a,c:a,b}`. No cross-device sync. |
| Startup | Keep automatic loading blocked until settings are read. The permanent network barrier is independent of settings reads. |

The [switch reference](docs/reference/toggle.webp) specifies a green rounded track and right-positioned white thumb when ON, a neutral track and left-positioned thumb when OFF. Do not rely on color alone.

## 2. Working defaults

- Quoted attachments inherit the enclosing post's A/C/B category, but remain a separate loading group. Reposts use the underlying post, not the reposter, for ownership.
- Include recognized GIF/animated-video attachments, posters and thumbnail/resolution variants. A video authorization covers its audio and necessary associated requests; playback support remains limited to the transport described in §10.
- Exclude avatars, profile banners, emoji/icons and ordinary external-link preview cards. Preserve post/quote text, navigation and unrelated X actions.
- Intended post surfaces include home timelines, profiles/media grids, search, bookmarks, Lists/Communities, post-bearing notifications, conversations and photo routes. Promoted/recommended posts follow the same policy. Missing live fixtures remain acceptance gaps.
- DMs, Spaces/live audio, embedded X posts on other sites and third-party video embeds are outside the initial scope.
- Target desktop Chrome MV3. No mobile/Firefox support, backend, telemetry, extension account or X API credentials are required.
- Click grants are temporary and occurrence-local. They do not survive a full reload, a different logical page, browser restart or another tab. A full DOM occurrence replacement also requires a new click; renderer-internal identity is not used to carry grants across replacements.
- Show video controls without forcing autoplay or sound. Describe grouped still-image loading versus single-video loading in the UI.

## 3. Classification and state semantics

### Page context

A status context comes from the current URL's status ID, including `/photo/...` and `/video/...` suffixes. Establish the corresponding author's identity from current metadata. DOM links and avatars are not an alternate author source; missing metadata remains unknown.

| Rendered item | Category |
| --- | --- |
| Focused status post | A |
| Conversation reply or ancestor by the focused author | C |
| Conversation reply or ancestor by another author | B |
| Quoted attachment | Enclosing post's category |
| Independent recommendation, feed item, repost or search result | A |
| Post on a non-status surface | A; C/B have no effect |

Use conversation/parent relationships, not visual ordering, to distinguish a conversation from independent recommendations. Opening a reply as its own status makes it the new focus and author reference. Unknown classification withholds automatic loading if any possible category is filtered. When all filters are OFF, author classification is unnecessary for recognized media. An explicit trusted click can authorize an identified occurrence without waiting for its category.

### Settings truth table

| A (`a`) | C (`c`) | B (`b`) | Category A | Category C | Category B |
| --- | --- | --- | --- | --- | --- |
| ON | ON | ON | Placeholder | Placeholder | Placeholder |
| ON | ON | OFF | Placeholder | Placeholder | Eligible |
| ON | OFF | ON | Placeholder | Eligible | Placeholder |
| ON | OFF | OFF | Placeholder | Eligible | Eligible |
| OFF | ON | ON | Eligible | Placeholder | Placeholder |
| OFF | ON | OFF | Eligible | Placeholder | Eligible |
| OFF | OFF | ON | Eligible | Eligible | Placeholder |
| OFF | OFF | OFF | Eligible | Eligible | Eligible |

Eligibility does not mean eagerly downloading every timeline attachment. Automatic inline loading is visibility-gated; while the gallery is open, no new inline automatic renderer is authorized.

### Changes and grants

- Store three booleans in `chrome.storage.local`. Missing/invalid values use fresh defaults; a valid legacy `{a,b}` without `c` initializes `c=a`. Do not reset valid saved preferences. Block automatic startup loading until the asynchronous read completes.
- Apply setting changes to existing and newly rendered content across X tabs without a reload. OFF makes eligible media load; ON revokes affected automatic/manual authorizations and restores placeholders. Already-transferred bytes cannot be undone; cancellation of an already-sent request is best effort.
- A still-image click authorizes still images in the same attachment post and rendered occurrence, not enclosing/quoted groups, neighbors, duplicate occurrences/tabs or videos. Grouping is not a URL/CDN/tab allowlist.
- Retain a grant only while the same occurrence and media identity remain. A recycled node changing owner/media loses its grant. Full element removal/replacement loses the grant even if the replacement shows the same post.
- Logical route changes reset grants and recompute context. URL changes dismiss the gallery. Inline enlargement leaves the URL unchanged and can carry only its clicked occurrence's still-image authorization into that gallery. Direct `/photo/N` entry does not inherit a grant merely from the URL.
- Gallery selection changes dispose the old renderer and authorize only the selected image, subject to settings or that gallery's explicit group grant. Closing discards gallery grants; inline occurrence grants remain unless another revocation boundary applies.

## 4. UI behavior

Each blocked attachment has a local placeholder. Use **“Image blocked — click to load”**, **“Video blocked — click to load”**, or the grouped still-image equivalent. Keep a placeholder per attachment, distinct loading/error states and separate validated tickets. Use existing native media dimensions where available, not remote probes or previews. Keep layout bounded, text legible, placeholders borderless and keyboard focus visible.

A trusted click or keyboard activation loads the group/video without also navigating the post, quote or gallery. Loading/error renderers retain their own retry input. Other post interactions must remain usable.

A decoded inline image's unmodified primary activation opens the extension gallery, suppressing X's photo-link action. This enlargement does **not** change the URL or create a native-viewer history entry. Modified/new-tab navigation does not inherit a manual grant.

The gallery is an `xmf-gallery` host with a **closed shadow root** containing a native modal `<dialog>`. The extension owns Close, Previous, Next, image count, Left/Right and Escape. The browser supplies modal focus containment; closing inline enlargement restores focus to its connected opener. Boundary navigation buttons are disabled. A focused image renderer becoming ready returns focus to the inline link or gallery Close control; background loads must not steal focus.

Direct `/photo/N` startup opens the same owned gallery and selects the metadata ordinal for that post. Missing or unsupported metadata leaves a non-loading placeholder rather than selecting a different image. Close/Escape from a direct photo route uses `location.replace` to return to the base status URL, not X's native viewer or a synthetic Back operation. Previous/Next changes the owned selection without changing the URL. Only one selected gallery renderer exists; it does not prefetch adjacent slides. Existing authorized inline renderers need not be unloaded merely because the gallery opens.

Native X viewer carousel stages, animations, controls and renderer internals are not integration contracts. Native swipe/drag, full-resolution zoom and image-save menus are not promised gallery features.

## 5. Meaning of “no downloading”

For recognized, filtered media, **no media request may reach its origin/CDN before a trusted still-image-group/video click or applicable filter-OFF authorization**. A request attempted by X but canceled by a pre-request browser rule is acceptable. Hiding a successful response is not.

Coverage includes images, thumbnails, alternate sizes/formats, posters, GIF payloads, MP4/range requests, manifests, initialization data and audio/video segments. HTML, JavaScript, fonts, post text and API metadata may load. Never download a media payload merely to determine its owner, type or dimensions.

The guarantee begins on a fresh page load with the extension already active. Installation/enabling cannot undo previous downloads. Cached pixels still need UI suppression; a warm cache or zero Resource Timing size does not prove network prevention.

This is a guarantee for supported delivery families, not an operating-system firewall. New hosts/paths or media bytes embedded in required HTML/API responses require renewed discovery and explicit disclosure of gaps.

## 6. Current-X integration contract

The page bridge observes `https://api.x.com/graphql/<hash>/<operation>` fetch/XHR responses and bounded inline JSON/bootstrap data already delivered to X; operation names do not determine whether metadata is usable. Current media records come from **`media_entities2`** and author handles from **`core.user_results.result.core.screen_name`**. Conversation and parent IDs use the `legacy` relationship fields; quote identity comes from **`quoted_tweet_results.rest_id`**, with no conflicting expanded result ID. Do not add alternate historical schemas, hard-coded GraphQL hashes or fixture IDs as compatibility fallbacks. Decode data only; never evaluate page script text.

The bridge transports sanitized updates; only the isolated coordinator merges them, in arrival order. The bridge's bounded bootstrap queue drops oldest updates on overflow, so affected media may remain unavailable until fresh metadata arrives or the page reloads.

Partial representations may omit established fields; only absence preserves prior same-post metadata. Explicit empty/invalid fields withdraw it. Video ID/variant reuse requires the same ordinal, canonical cover, attachment key and type, with no conflicting ID; changed or withdrawn sources revoke existing renderers.

The semantic adapter uses `article`, `IMG`/`VIDEO`, same-origin status/media anchors, quote boundaries and validated asset metadata. A canonical video cover can identify the enclosing native player by its direct `VIDEO` child, without classifying surrounding post text as controls. A metadata-matched player may contain one same-origin source-post credit in its controls, including profile avatars and their duplicated presentation; that credit does not determine the enclosing post's owner. Blob-only players without a recognizable cover/source remain unavailable. It does not use `data-testid`, X CSS classes, carousel positions, React props or renderer keys as identity. Ambiguous ownership/attachment associations remain unknown; unsupported markup must not broaden authorization.

## 7. Chrome constraints and design direction

- Ordinary MV3 extensions cannot rely on `webRequestBlocking`. Packaged [Declarative Net Request](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) rules provide the pre-request barrier; DOM callbacks and `document_start` script timing do not.
- DNR covers requests reaching the network stack, including HTTP cache and network fetches from site workers, but not responses synthesized by a worker or returned from CacheStorage. Cached display needs separate UI handling. [Service worker interactions](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#interactions-with-service-workers)
- Extension renderers use an extension origin and constrained host access. An initiator is not a media owner. A broad URL/CDN/tab allow rule would expose duplicate occurrences, even if quickly revoked.
- Extension workers can suspend. Grants, renderer messages and callbacks need current tab/document/route validation; worker memory is not durable preference storage. [Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Treat MAIN-world metadata and page messages as untrusted. Sanitize fields, validate again at privileged boundaries, restrict destinations and redirects, and never forward X authentication headers or expose an arbitrary-URL proxy.
- Use only required storage/DNR and X/media host permissions. Runtime does not require debugger, cookies, all-sites access, an offscreen document, backend or permanent CDP connection.

## 8. Implementation gates and acceptance tests

### Blocking and loading proof

Demonstrate these in real Chrome with the extension active, not a network mock:

1. Fresh navigation with all filters ON shows placeholders and no unauthorized transfer, including posters and XHR/fetch video traffic.
2. One image click loads its occurrence's still-image group with separate tickets; one video click loads that video. Other groups, duplicate occurrences/tabs and videos remain blocked.
3. Independent A/C/B automatic eligibility works across all eight combinations, including fresh defaults, without first downloading filtered categories.
4. Concurrent duplicate URLs across categories/quotes do not escape isolation.
5. Repeat affected cases after worker suspension, startup, reload, SPA transitions and settings changes. Reject delayed callbacks from prior contexts. Route events alone are not a network barrier.

If proof fails, report the limitation and revise the implementation rather than redefine blocking as hiding.

### Acceptance matrix

| Area | Required checks |
| --- | --- |
| Policy | Eight combinations; focused post versus author/other replies and ancestors; focused reply after an ancestor; quotes; unknown ownership; independent recommendations; A-only non-status policy. |
| Groups | Separate per-image tickets; mixed media/GIF where supported; duplicate URLs/sizes; no quote/enclosing, neighbor, other-occurrence/tab or video spillover. |
| Video | Blocked poster/manifests/segments before authorization; playback/audio/seeking; retry; future loading stops after revocation. Distinguish fixed MP4 from unimplemented adaptive HLS. |
| Surfaces | Home, profiles/media grids, search, bookmarks, Lists/Communities, notifications, conversations and photo routes; promoted/recommended posts. Report missing fixtures. |
| Gallery | Inline manual/automatic enlargement without URL change; direct `/photo/N` startup/reload; ordinal matching; selected-only renderer/network windows; Next/Previous, keyboard, Escape/Close and focus; direct Close returns via replacement to base post; unknown metadata stays blocked. |
| Navigation/identity | SPA and Back/Forward, infinite scroll, duplicate occurrences, recycled nodes, full DOM replacement losing grants, rapid route changes and concurrent tabs. No dependency on native viewer structure or renderer identity. |
| Lifecycle | Fresh defaults, legacy migration, saved settings, browser restart, worker suspension, extension reload/update, no stale grants or startup leakage. |
| Settings/UX | Exact A/C/B labels, cross-tab propagation, OFF eligibility/ON revocation, persistence errors, dark-only popup without footer, keyboard/focus, readable placeholders in X themes, bounded layout and usable text/actions/avatars. |
| Security/failure | Missing or malformed metadata, changed DOM/schema, denied permissions, loader/redirect-guard failure, stale/forged messages, invalid destinations/redirects. Fail closed, never broad-allow. |

### Network evidence protocol

Capture **before navigation**, covering page and extension renderer targets in both target-level HTTP-cache-disabled/site-worker-bypassed and normal conditions. Correlate successful requests with current grants and separately verify visible placeholders/decoded media. Pre-click evidence must show cancellation before transmission or no outbound requests in a complete capture; screenshots, cached 200s, timing sizes and unit/DOM tests alone do not prove safety. Gallery selection windows must distinguish the selected renderer from existing authorized inline media.

Follow the [dedicated-browser procedure](docs/development.md#dedicated-browser-validation) for binding, capture safety and restoration. Keep bounded route/settings evidence local and report missing fixtures and environment gaps separately.

## 9. Implementation deliverables

- Native JS/HTML/CSS in `extension/`, without dependency installation or a build step. `manifest.json` remains the version/permission source of truth.
- Offline checks and the sole browser regression entry point follow the [development guide](docs/development.md). Development CDP is not packaged or required at runtime.
- Documentation follows the ownership map above; do not duplicate run histories.

## 10. Selected implementation and verified boundaries

**Platform:** Chrome 128+, MV3, for the response-header redirect guard. Minimum-version testing is tracked in [validation](docs/validation.md).

**Permanent barrier:** enabled packaged rules block recognized `pbs.twimg.com` post-image/poster paths and `video.twimg.com` requests initiated by X, without an image/media-only resource-type restriction. No setting or click creates an allow rule. Storage reads, classification and worker liveness therefore do not control the page barrier. It is delivery-family-based, not DOM-owner-aware; an out-of-scope feature reusing covered paths may also be affected.

**Adapter and bridge:** the current schema/semantic DOM contract is §6. A nonce-bound, one-time MessagePort transfers bounded selected metadata into the isolated script; fields are revalidated there. Trusted input is required for placeholder grants. Metadata and synthetic page clicks are not privileged download commands. Observation does not replace the network barrier.

**Occurrence identity:** document-local nonces bind enclosing owner, attachment source, ordinal, normalized asset, kind and validated video ID. The revocation rules in §3 intentionally trade click persistence through virtualization for conservative isolation.

**Owned gallery:** `viewer.js` owns the modal UI; `content.js` owns selection, grants and renderer lifecycle under §§3–4. Late tickets for disposed items are rejected. The URL selects content, never authorizes it. Gallery loading can make an additional authorized request for an image already loaded inline; no zero-additional-download claim is made.

**Per-item transport:** the worker issues single-use renderer tickets scoped to tab, exact top-document challenge, route epoch and media item. The extension iframe displays anonymous-CORS images or native progressive MP4 with audio/range seeking. It never accepts an arbitrary page fetch request or forwards authentication headers. A session DNR rule rejects `Location` responses from authorized CDN requests; failure to install it denies loading. A rejected ticket replay must not unregister an active renderer's revocation port.

The MP4 selection is the highest available bitrate at or below 2.5 Mbps, otherwise the lowest available. Encoded poster family/media ID must match the selected video; metadata must not override a mismatch. A custom `/media/` cover requires the same media entry's validated numeric `id_str` to bind an `amplify_video`/`ext_tw_video` MP4. Missing/malformed/mismatched bindings stay denied, and the worker repeats the check.

Playback is **fixed-rendition MP4, not adaptive HLS**. HLS-only, live, paid and third-party media may remain unavailable. No Blob/base64 whole-video transport, offscreen document or player dependency is added. Page-origin playlists/segments remain blocked even when that format is not playable through the extension.

These are implementation boundaries, not a fresh browser certification. [Validation](docs/validation.md) separates offline checks, focused browser evidence and remaining limits.

## 11. Public-store preparation

The [release guide](docs/store/README.md) owns packaging, artwork and publisher approvals. Release packages must match the validated source. Account/legal actions, submission and publication require explicit authorization; preparation and archive integrity do not establish network safety or resolve acceptance gaps.
