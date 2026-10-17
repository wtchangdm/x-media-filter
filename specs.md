# X Media Filter — specification and implementation handoff

Status: **loadable MV3 extension 0.1.0 implemented; version retained**. Three-filter combinations, the dark-only popup and grouped loading on the supplied native three-image post are verified in the user's Chrome; defaults/migration and startup read races have offline coverage, not a fresh-profile installation claim. Current architecture and prior verification are in §10 and [docs/validation.md](docs/validation.md); the acceptance matrix remains the contract, not a claim that every surface has passed.

## 1. Goal and confirmed requirements

Build a Chrome extension for **all X post surfaces**, not just individual status pages. Filtering prevents image/video downloads until authorized and shows a local placeholder instead.

| Requirement | Agreed behavior |
| --- | --- |
| Media | Images and videos; UI wording can use “media.” |
| Control A (`a`) | **Filter media on post**: the focused post, independent feed items, and posts on non-status surfaces. Default OFF. |
| Control C (`c`) | **Filter media on author replies**: conversation replies and ancestors by the focused post's author. Default OFF. |
| Control B (`b`) | **Filter media on non-author comments**: conversation replies and ancestors by other authors. Default ON. |
| Author reference | On a status page, use the author of the post identified by the **current URL**, not the first author in the conversation. |
| Scope | All post surfaces, including home timelines, search, and profile timelines. |
| Controls | Three toggles with the exact English labels above, in a dark-only toolbar popup with no footer. Switch styling follows the supplied reference. |
| Manual load | An image click loads all still images belonging to the same attachment post in the same rendered occurrence; a video click loads only that video. No quote/neighbor/other-occurrence/tab/video spillover from an image click. Each image requires a separate validated loader ticket. |
| Defaults | A OFF, C OFF, B ON. ON means blocking is enabled. Keep startup blocked until settings have been read. |
| Persistence | Save settings locally, share them across X tabs, and retain them across Chrome restarts. Legacy saved `{a,b}` maps to `{a,c:a,b}`, preserving old preferences. No cross-device sync requirement. |
| Artwork | Use the supplied `Grumpy Cat Rubbing Its Eye.png` as the icon source. Preserve marquee assets outside the extension in `assets/store/`. Local public-store preparation is authorized; submission/publication and rights approval are not completed. |
| Validation | The user authorizes testing through their Chrome debug session at `<dedicated-loopback-endpoint>`, using `agent-browser`. |

Visual reference: [docs/reference/toggle.webp](docs/reference/toggle.webp), copied from the supplied CleanShot image. It shows a green rounded track and white circular thumb on the right when ON. OFF should have a neutral track and thumb on the left. The reference does not specify the popup layout.

## 2. Working defaults for details not explicitly selected

These make the specification implementable without more preliminary questions. They are product defaults, not additional user quotations.

- **Quoted media inherits the enclosing post's category**, regardless of the quoted author's identity. Reposts use the underlying post, not the reposter, for ownership.
- Include animated GIFs/X animated-video attachments, video posters, and thumbnail/resolution variants of covered media. An ordinary video includes its audio track.
- Exclude avatars, profile banners, emoji/icons, and external-link preview cards from media filtering. Keep post text, quote text, navigation, and ordinary X interactions intact.
- “All” covers X's post UI: home/Following/For You, profiles and media grids, search, bookmarks, Lists/Communities, post-bearing notifications, conversation views, and media viewers. Promoted/recommended posts follow the same policy. DMs, Spaces/live audio, embedded X posts on other websites, and third-party video embeds are outside the initial post-media scope; supporting them would need additional semantics and verification.
- Target desktop Chrome, Manifest V3, initially installed unpacked. Public-store release preparation is now authorized (see §11), not submission/publication. Mobile/Firefox support, backend, telemetry, extension account login, or X API credentials are not required.
- Helper text must explain that ON blocks downloads, distinguish the three categories, and describe grouped still-image loading versus single-video loading. The English switch labels and dark-only popup are confirmed requirements in §1.
- Click grants are temporary and local to the current tab/page context. They do not persist across a full reload, a different logical page, browser restart, or another tab.
- A video click authorizes that one video's poster, playlists, initialization data, audio/video segments, and subsequent seeking/quality changes. Showing controls is sufficient; do not force autoplay or sound.

## 3. Classification and state semantics

### Page context

A status context is identified by the status ID in the URL, including associated `/photo/...` and `/video/...` views. Resolve that post's actual author from the rendered post or its metadata. Prefer a stable user ID; a normalized handle from a verified post-author association is a fallback. The URL handle alone is not authoritative.

| Rendered item | Category |
| --- | --- |
| Focused status post | A |
| Conversation reply or ancestor by the focused author | C |
| Conversation reply or ancestor by another author | B |
| Quote attachment inside any of the above | Inherit enclosing post's A/C/B category |
| Independent feed item, recommendation, repost, or search result outside the current conversation | A |
| Any post on a non-status surface | A; C and B have no effect there |

Conversation ancestors displayed above the focused post use the same author-relative C/B classification as replies. Unrelated recommendations below a conversation remain A, not C or B. A reply opened as its own status becomes the focus (A) and establishes a new author reference.

Do not infer ownership from article position or nested quote links. For an unidentified relationship, withhold automatic loading if any possible category has its filter ON. If all three filters are OFF, author classification is not needed to authorize recognized post media. An explicit click can authorize an identified still-image group or video without waiting for its A/C/B classification.

### Settings truth table

| A (`a`) | C (`c`) | B (`b`) | Category A | Category C | Category B |
| --- | --- | --- | --- | --- | --- |
| ON | ON | ON | Placeholder | Placeholder | Placeholder |
| ON | ON | OFF | Placeholder | Placeholder | Load normally |
| ON | OFF | ON | Placeholder | Load normally | Placeholder |
| ON | OFF | OFF | Placeholder | Load normally | Load normally |
| OFF | ON | ON | Load normally | Placeholder | Placeholder |
| OFF | ON | OFF | Load normally | Placeholder | Load normally |
| OFF | OFF | ON | Load normally | Load normally | Placeholder |
| OFF | OFF | OFF | Load normally | Load normally | Load normally |

The fresh-install defaults are **A OFF, C OFF, B ON**. “Load normally” means eligible to load when X/the media UI needs it, not eagerly download every item in the timeline. Eligibility must work with independently selected filters; classification cannot depend on already downloading the media.

### Changes and grants

- Store three booleans (`a`, `c`, `b`) in `chrome.storage.local`. Missing/invalid values use A OFF, C OFF, B ON. For a valid legacy saved `{a,b}` pair without `c`, preserve `a`/`b` and initialize `c` from `a` instead of the fresh-install default. Keep media blocked until the asynchronous settings read completes; defaults must not authorize startup loads early. The permanent network safety baseline is independent of those reads.
- Apply a setting change to existing and newly rendered content in all X tabs without requiring a reload. A change must not open a window in which unrelated blocked media can load.
- Turning a category OFF makes its media eligible. Turning it ON revokes that category's existing automatic/manual authorizations, restores placeholders, and stops playback/future segment loading. Already-transferred bytes cannot be undone; cancellation of an already-sent request is best effort.
- Keep a clicked item authorized through ordinary React rerenders and virtualization in the same page context. A recycled DOM node must not transfer authorization to a different post/media item.
- On logical route changes, reset grants and recompute the focus. Same-post media viewers may retain an authorized item's grant, but must not preload neighboring gallery items outside the explicitly authorized still-image group.
- An image click authorizes all still images in the same attachment post and same rendered occurrence, with an independently validated ticket for each image. Quoted and enclosing attachments are separate groups even though quotes inherit the enclosing category. Do not authorize videos, neighboring posts, or duplicate assets in other occurrences/tabs. A grant is not a global media-URL or whole-post allowlist.
- A proposed identity includes document/tab context, logical route generation, enclosing post, quoted-media path if applicable, media identity/index, and an occurrence discriminator if the same post/media appears more than once. Resolve identity from current content; DOM nodes and CDN URLs alone are insufficient.

## 4. UI behavior

The popup contains the three exactly labeled switches in A, C, B order and a brief explanation, uses a dark-only theme, and has no footer. No separate image/video switches are needed. Use accessible checkbox/switch semantics, keyboard operation, visible focus, and readable ON/OFF state without relying only on color. Show persistence errors instead of pretending a change succeeded.

Each blocked attachment has its own local placeholder:

- Suggested text: **“Image blocked — click to load”** / **“Video blocked — click to load.”**
- Use locally generated markup/CSS/icons; no remote thumbnails, blurred previews, dimension probes, or media prefetches.
- Preserve a reasonable layout using dimensions already present in DOM/API metadata. Keep a placeholder per attachment in multi-image or mixed-media posts. Activating any still-image placeholder loads the remaining still images in its attachment-post/occurrence group, not videos or another attachment group.
- Keep each image's loading/error state and validated loader ticket separate. Loading and retries must not expand authorization beyond the intended still-image group or selected video.
- Clicking or keyboard-activating the placeholder must not also open the tweet/quote/gallery or trigger unrelated X actions. Other post interactions must continue to work.
- The loaded image remains viewable and the loaded video playable. If opening a viewer is supported, selection does not authorize adjacent items outside the explicitly authorized still-image group.

## 5. Meaning of “no downloading”

For recognized, filtered media, **no media request may reach its origin/CDN before an explicit still-image-group/video click or applicable filter-OFF authorization**. A request attempted by X but canceled by a pre-request browser rule is acceptable. Merely hiding a successful response is not.

This covers full images and thumbnails, alternate sizes/formats, video posters, GIF payloads, MP4/range requests, manifests, initialization data, and audio/video segments. HTML, JavaScript, fonts, post text, and API metadata containing media URLs/dimensions may load. The extension must not download a media payload merely to discover its type, size, or owner.

The guarantee begins on a fresh page load with the extension already active. Installing/enabling it after a page has loaded cannot undo previous downloads. The UI must still hide blocked content already in cache; a warm cache is not proof of network prevention.

The guarantee is for the supported X delivery mechanisms verified by the implementation, not an operating-system firewall. If X moves media bytes into required HTML/API responses or a new unrecognized delivery mechanism, record that gap; do not silently redefine “blocked” as CSS-hidden.

## 6. Discovery evidence

### Live inspection

Inspected using `agent-browser` attached to the user's CDP session. The attached browser reported **Chrome/155.0.0.0**. The X page was controlled by a site service worker. These are observations of this session, not a minimum Chrome version or stable X API contract.

| Example | Observed behavior / regression purpose |
| --- | --- |
| [Image thread](https://x.com/ArtificialAnlys/status/2110893784422908225) | Focused post and three immediately following posts by the same author each contained a `pbs.twimg.com/media/...` image. Another author's reply also contained an image. Originally exercised the combined focused/same-author category and the other-author category; now a regression fixture for A, C and B separately. |
| [Custom-cover video](https://x.com/github/status/2111225205309780009) | The video has a `/media/...jpg` cover, three progressive MP4 variants and HLS. The cover has no embedded video ID. Its media entry's explicit `id_str` matches the MP4 path ID, not the enclosing tweet ID. Cold/normal browser regressions now cover this case. |
| [Video post](https://x.com/thsottiaux/status/2111249534072529256) | Before playback, a `tweetPhoto` wrapper held a poster from `pbs.twimg.com/amplify_video_thumb/...` and a `playButton`; there was no `<video>`. After clicking Play, a `<video src="blob:...">` appeared, backed by XHR requests to `video.twimg.com`. Playback was paused after inspection. |
| [Quoted image](https://x.com/thsottiaux/status/2111245052513259606) | The focused post was the **second** rendered tweet article because a conversation ancestor preceded it. Its quoted image linked to `/Gavmn/status/2111136119945396436/photo/1`. The quote was inside the outer article, not a nested article. Exercises focus resolution and quote inheritance. |

Observed DOM hooks, subject to X changes:

- Tweet containers: `article[data-testid="tweet"]`.
- Author blocks: `[data-testid="User-Name"]`; a quote can add another block with no profile `<a>`.
- Image/poster containers: `[data-testid="tweetPhoto"]`. This does **not** mean the attachment is a still image.
- Status links associated with `<time>` help locate the outer post; photo links can point to a quoted post instead.
- The quoted image used `/media/<id>?format=...&name=...`, with no `srcset` in that sample. Other images must still be tested for responsive sources and alternate formats.

Observed video network behavior:

- Successful XHRs loaded `video.twimg.com/amplify_video/<media-id>/pl/...m3u8` master/rendition/audio playlists.
- Further XHRs loaded `.../vid/...` and `.../aud/...` `.mp4` initialization data and `.m4s` segments, including quality changes.
- The numeric video media ID differed from the enclosing status ID. Do not derive a video URL from the tweet ID.
- Resource Timing reported zero sizes for some cross-origin video entries despite successful playback and HTTP 200 responses in the network log. Zero timing sizes are **not** evidence of blocking.

A locally inspected `TweetDetail` XHR response supplied the focused post's `rest_id`, author identity via `core.user_results.result`, and media under `legacy.extended_entities.media`. The observed user handle was at `core.user_results.result.core.screen_name`. Media fields included `media_key`, `id_str`, `type`, `media_url_https`, `sizes`, `original_info.width/height`, and `video_info.variants` with HLS and MP4 URLs. This suggests ownership, dimensions, and video sources can be obtained without downloading media. The inspected source was XHR, so a fetch-only response observer would miss it.

Do not hard-code the GraphQL operation hash, one response wrapper/entry index, or these examples' IDs into production logic. Any passive metadata observer must handle response wrappers and changes conservatively and avoid collecting unrelated API data. No authenticated response bodies, headers, or HARs were saved to the project.

### Not yet verified

This was the pre-implementation discovery snapshot. A packaged barrier, isolated renderer, popup and browser tests now exist; see §10 for the implemented choice and [docs/validation.md](docs/validation.md) for measured results. The additional [native three-image post](https://x.com/OpenAIDevs/status/2110855382444704190) is now exercised in cold and normal modes. Other album layouts, mixed media, GIFs, quoted videos, additional delivery families and several account-dependent surfaces still need dedicated fixtures. These examples are regression anchors, not exhaustive coverage.

## 7. Chrome constraints and design direction

### Documented constraints

- Ordinary MV3 extensions cannot use `webRequestBlocking`; its blocking mode is reserved for policy-installed extensions. Observational `webRequest` cannot pause a request for asynchronous author classification. [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
- `declarativeNetRequest` (DNR) can block before a request is sent. Response-header-conditioned rules run too late for this requirement. Within an extension, explicit priority governs first, then action precedence; static/dynamic/session rules have no inherent ordering. Equal-priority allow rules outrank block rules. [DNR evaluation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation)
- DNR sees request properties, not DOM elements, authors, or quote ownership. `tabIds` conditions are available only for session rules. Two occurrences using the same URL in the same tab are not distinguishable by URL/tab conditions. [RuleCondition](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-RuleCondition)
- Static rules ship with the extension. Dynamic rules persist across sessions/updates; session rules do not. A session-rule update is atomic, but it is not a transaction with DOM changes or navigation. Current documented session quota is 5,000 rules across the extension. Do not allocate permanent rules for an infinite timeline. [Rules and limits](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- DNR covers requests reaching the network stack, including HTTP-cache responses and network fetches from site service workers. It does not filter responses produced by a service worker or returned from CacheStorage. Cached display needs separate UI handling. [Service worker interactions](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#interactions-with-service-workers)
- `document_start` enables early content scripts, but neither a DOM observer nor page-world monkey-patching is a universal pre-request barrier. `ISOLATED` and `MAIN` worlds have different access/CSP boundaries. [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- Extension-worker/page fetches have an extension origin and need appropriate host permissions; content-script requests act on behalf of the page origin. An `initiatorDomains` condition identifies the requesting origin, not the destination/media owner. [Cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- Chrome extension messaging uses JSON serialization, so do not assume a `Blob` can be sent directly through `runtime.sendMessage`. Extension service workers have a limited lifetime; their globals are not durable grant/settings storage. [Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### Responsibilities and original design constraints

The responsibilities below informed the implementation. The selected, tested transport is documented in §10; alternatives mentioned here are design context, not additional shipped mechanisms.

1. **Network barrier:** packaged, enabled pre-request protection for covered X media delivery. It must already apply during cold startup, before author discovery or storage reads. Include XHR/fetch/other delivery paths rather than relying only on `image`/`media` resource types. Scope filtering to X usage, not unrelated websites sharing a CDN. `pbs.twimg.com/media/`, observed poster paths, and `video.twimg.com` are a starting inventory, not complete coverage.
2. **Page adapter and policy:** discover media and owning posts, establish the focused author, handle quotes, and render placeholders. Keep observation incremental for infinite scrolling and recycled DOM; avoid repeated whole-page scans or cloning every unrelated API response.
3. **Loading coordinator:** authorize only the selected/eligible media and reject stale work after navigation or revocation. Treat video as one authorized media item with multiple associated requests. Release detached UI and object URLs; bound bookkeeping.
4. **Popup/storage:** three booleans with legacy migration and fail-closed startup, settings propagation, accessible dark-only UI without a footer, and honest error states. Use `chrome.storage.local`/`storage.onChanged`; do not persist browsing history or manual media grants.

**Choose the loading mechanism only after a small real-Chrome proof.** Exact-URL session allows by themselves can open identical URLs elsewhere in the tab; broad CDN, video-prefix, tab-wide, or `allowAllRequests` grants are not sufficient evidence of per-item isolation. Temporarily allowing then revoking also has a concurrent-request race.

A candidate is to keep page media requests blocked and use an extension-controlled fetch/render path only for eligible occurrences. This needs proof of permissions, CSP, redirects, image rendering, efficient video streaming/seeking, and extension-to-page transport. Do not buffer entire videos as base64 or add an offscreen document/player framework without demonstrating the need. [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen) are an option, not a requirement. A smaller alternative is acceptable if it proves the same isolation and lifecycle behavior.

A metadata bridge in the page's MAIN world may be needed for XHR/fetch responses, but DOM/metadata discovery must not itself be the download barrier. Validate all bridge messages; page code can forge them. A privileged loader must restrict media destinations, redirects, sender/context, and grants, and must not forward captured authentication headers or act as an arbitrary URL proxy. Prefer credential-free CDN access if verified to work.

Use the smallest permissions set supported by the chosen design: likely `storage`, an appropriate DNR permission, X content-script matches, and necessary media host access. Additional scripting/offscreen/navigation permissions need a concrete use. The extension itself must not require `debugger`, `cookies`, `<all_urls>`, or a permanent CDP connection merely because development tests use CDP.

## 8. Implementation gates and acceptance tests

### Gate 1 — blocking and loading proof, before full UI

Demonstrate in an unpacked MV3 extension, not just an agent-browser network mock:

1. Fresh navigation to each supplied URL, all three filters ON: blocked media has placeholders and no unauthorized media transfer occurs, including posters and video XHRs.
2. Click one image and one video: all still images in the selected attachment-post/occurrence group render, each using a separate validated ticket; the selected video plays. Other attachment groups, neighboring posts, duplicate occurrences/tabs and unselected videos remain blocked.
3. Independent automatic eligibility for A, C and B works without first downloading filtered categories. Test all eight combinations, including the fresh defaults A OFF/C OFF/B ON.
4. Test duplicate media URLs across categories/quotes and concurrent loads. Prove the loading design does not expose other blocked occurrences.
5. Repeat after worker suspension, cold start, reload, SPA navigation, and settings changes. Reject delayed callbacks from a prior context. Documented navigation events have no guaranteed ordering with network events, so an event-triggered rule update alone is not a startup/route barrier. [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)

If this proof fails, record the exact limitation and revise the design; do not quietly replace “no download” with “hidden after loading.”

### Acceptance matrix

| Area | Required checks |
| --- | --- |
| Policy | All eight A/C/B combinations; focused post independent of same-author replies/ancestors; other-author replies/ancestors; focused reply with a preceding ancestor; quote from a different author; unknown ownership; independent recommendations; A-only policy on non-status surfaces. |
| Per-item behavior | One image click loads all still images in the same attachment post and rendered occurrence, each with a separate validated ticket; mixed image/video attachments where supported; GIF; duplicated URLs and image sizes; no quoted/enclosing-group, neighbor, other-occurrence/tab or video spillover. |
| Video | Poster blocked; no pre-click manifests/segments; playable after click; seeking/quality changes/audio; failure/retry; later segment requests stop after revocation. |
| Surfaces | Home, profile posts/media grid, search, bookmarks, Lists/Communities, post-bearing notifications, conversation and media viewer; promoted/recommended posts where available. Missing environments must be reported. |
| Navigation | Direct load, in-app navigation, Back/Forward, photo/video modal, infinite scroll, recycled DOM, rapid route changes, two tabs showing the same media. |
| Lifecycle | Fresh defaults A OFF/C OFF/B ON; legacy `{a,b}` migrates with `c=a`; saved three-filter settings; browser restart; suspended extension worker; extension reload/update; no stale grants or startup leakage before the settings read. |
| Settings | Three exact labels in A/C/B order; popup changes propagate across tabs; OFF makes eligible media load; ON reblocks/revokes; persistence/error states are accurate. |
| UX | Dark-only popup without a footer; keyboard and visible focus; readable placeholder contrast in X light/dark themes; compact layout; one placeholder per item; no accidental tweet navigation; text/actions/avatars remain usable. |
| Failure/security | Missing author/metadata; DOM/API change; denied permission; loader failure; invalid/forged/stale message; rule-update failure/quota; malformed URL/redirect. Remain blocked rather than broad-allowing. |

### Network evidence protocol

- Begin recording **before navigation**, with the extension active. Record Chrome/extension versions and the exact route, settings, click time, and grant scope.
- Use CDP/DevTools network events and loading outcomes, not screenshots or Resource Timing alone. Correlate every media request with its authorization. Extension-owned requests may occur outside the page target; include the worker/rendering target when applicable.
- Exercise cold HTTP-cache conditions with the site worker bypassed, then ordinary site-worker-enabled/warm-cache behavior. Prefer an isolated profile/controlled fixture for cache clearing and server-side request counters; do not wipe the user's real profile, cookies, or CacheStorage.
- For pre-click media, show cancellation before transmission or the absence of outbound media requests in a complete capture. A cached 200 or zero transfer size alone is not proof. Canceled attempts may appear as blocked requests.
- After click, show only the selected still-image group's independently authorized requests or selected video's necessary request family succeeding, with other groups/occurrences/tabs and unselected videos still blocked. Include independent A/C/B automatic loading in this check.
- Keep actual network assertions in browser integration tests. Unit/DOM fixtures are useful for classification, quotes, route identity, and recycled nodes but do not prove network safety.
- Report gaps separately: HTTP-cache bypass tests do not prove normal service-worker behavior, and a development network mock does not prove shipped DNR rules.

## 9. Implementation deliverables

- Loadable extension: `extension/manifest.json` and adjacent native JS/HTML/CSS, retaining version **0.1.0**, with no package installation, build step, backend or telemetry.
- Icon derived from the user-supplied `Grumpy Cat Rubbing Its Eye.png`; marquee assets preserved in `assets/store/` outside the loadable extension. Store preparation deliverables are in §11; publication itself is not authorized by their preparation.
- [README.md](README.md): unpacked installation, toggle semantics, development commands and existing-Chrome test instructions.
- `node --test tests/*.test.cjs`: focused policy/worker protocol tests.
- `node tests/check.mjs`: manifest/resource, syntax, JSON, local-link and whitespace checks.
- Browser integration scripts: `tests/browser.mjs`, `tests/groups.mjs`, `tests/videos.mjs`, `tests/virtualization.mjs` and `tests/surfaces.mjs`, using `agent-browser` for user actions and scoped CDP network observation. CDP is development-only.
- [docs/validation.md](docs/validation.md): evidence, minimal aggregate reports, remaining gaps and manual checklist.

## 10. Selected implementation and verified boundaries

**Platform:** Chrome 128+, Manifest V3. The minimum supports the loader's response-header redirect guard. Acceptance runs use the user's Chrome **155.0.8059.85**; the reduced user-agent string reports 155.0.0.0.

**Permanent page barrier:** two enabled packaged block rules cover the listed `pbs.twimg.com` post-media/poster prefixes and all `video.twimg.com` paths for X initiators, without restricting protection to image/media resource types. No setting or click creates an allow rule. Network protection therefore does not depend on storage reads, page classification, route-event timing or worker liveness.

**Current policy/UI:** three independent filters A/C/B use the labels, defaults and truth table above. Legacy `{a,b}` initializes `c=a`; automatic loading remains blocked until settings are read. The popup is dark-only without a footer. Clicking a still image authorizes its attachment-post/occurrence group, never quoted/enclosing groups, neighbors, other occurrences/tabs or videos. Each image retains a separate validated ticket. Existing preferences are preserved rather than reset to fresh-install defaults.

**Per-item transport:** each selected/automatically eligible image or video receives its own single-use renderer ticket, scoped to tab, exact top-document challenge, route epoch and media item. A grouped still-image click issues separately validated tickets, not a shared group/CDN allow rule. The extension iframe uses anonymous-CORS images or native progressive MP4, including range seeking and audio. The selected MP4 is the highest available bitrate at or below 2.5 Mbps, otherwise the lowest available. For an encoded video thumbnail, its family/media ID must match the poster; an available metadata ID must also agree. A custom `/media/` cover can instead bind an `amplify_video`/`ext_tw_video` MP4 to the same media entry's validated numeric `id_str`. Missing/malformed/mismatched IDs remain denied; metadata never overrides an encoded thumbnail mismatch. The bridge carries only that scalar ID alongside the existing selected media fields, the isolated script validates it, and the worker repeats the binding check. The ID is part of video occurrence identity to revoke recycled/custom-cover replacements. A disconnect removes a renderer's revocation registration only if the entry belongs to that port; a rejected ticket replay cannot unregister the active renderer. The renderer never accepts a page-provided arbitrary fetch command or forwards X authentication headers. A session DNR rule rejects `Location` responses for extension-owned CDN requests; failure to install it denies loading.

This deliberately avoids Blob/base64 transport, offscreen documents and an HLS/player dependency. It also means **fixed rendition rather than adaptive HLS**; HLS-only/live/paid/third-party deliveries are not proven playable. This is a documented playback ceiling, not a fallback to post-load hiding.

**Page adapter:** document-start scripts pass sanitized GraphQL metadata through a one-time, nonce-bound MessagePort, observe both XHR and fetch, and validate received fields again in the isolated world. Placeholder grants require trusted user activation; forged window metadata and synthetic clicks do not authorize media. Classification resolves the current status ID, waits for a corresponding rendered focus before automatic conversation classification, and uses the enclosing owner for quoted attachments.

**Occurrence identity:** includes page epoch, surface/list scope, owning post, quoted attachment source, media index, normalized asset and rendered occurrence. A bounded MAIN-world adapter reads only existing keyed timeline identifiers from X's renderer, enabling real virtualized-node replacement without a URL-level grant. No React library is added. Unknown/colliding renderer identities use document-local nonces and may require a fresh click after full replacement; they are never guessed into shared authorizations. Metadata/grants and pending work are bounded and not persisted.

**Current evidence:** the user's Chrome 155.0.8059.85 passes all eight filter combinations in normal site-worker-controlled mode, image/video/quote loading, native video playback and seeking, cross-tab propagation/isolation, forged input rejection, worker stop/reconnect, SPA/Back revocation and real X virtualization. The supplied OpenAIDevs three-image post passes single-click group loading in cold and normal modes, with pre-click canceled requests and three decoded extension-owned images afterward. Controlled quote/duplicate fixtures and a second native tab remain blocked. Light/dark OS-theme emulation keeps the popup dark; its exact labels/footer removal, keyboard focus and axe audit pass. Defaults, migration, category revocation and settings-read races have 82 offline tests; no fresh-install storage reset was performed. The custom-cover GitHub video and original encoded-thumbnail video also pass cold/normal focused regressions: pre-click blocking, single MP4 playback and seeking to 40 seconds, duplicate-occurrence and synthetic-click rejection, reload revocation, automatic loading after filter OFF from a fresh blocked document, and reblocking. An early post-fix broad cold run passes the eight-filter/lifecycle matrix; a later broad rerun timed out waiting for its A/C/B discovery prerequisite, so the final focused video runs do not imply a new full-surface pass. Earlier home/profile/media grid/search and native image-viewer reports predate these changes and were not rerun. Full browser restart, other album layouts, mixed/GIF/quoted-video examples, Lists/Communities and additional CDN/video families remain gaps; bookmarks/notifications had no media available. See [docs/validation.md](docs/validation.md) for current and historical evidence rather than inferring universal support.

## 11. Public-store preparation (local review candidate)

The authorized scope is concrete preparation for a **public Chrome Web Store extension**, not another architecture redesign. The user subsequently authorized creating the same-name public GitHub repository with an MIT license and filling available fields. GitHub source/policy publication is separate from store publication: developer-account registration, payments, legal self-classification, store submission and store publication have not been performed by the assistant. The user reports the store contact email is verified; other account prerequisites were not inspected.

- [Store release checklist](docs/store/README.md), [English listing](docs/store/listing.en.md), [privacy/permission disclosures](docs/store/privacy-practices.md), a GitHub-readable [privacy policy](PRIVACY.md) and [reviewer instructions](docs/store/reviewer-notes.en.md) are prepared. All project/store documentation is English. Policy/store fields are filled with public GitHub maintainer `wtchangdm`, repository/homepage `https://github.com/wtchangdm/x-media-filter`, `/blob/main/PRIVACY.md` policy, `/blob/main/SUPPORT.md` support and effective date 2026-10-17. The user selected documentation/email support without a public issue tracker: GitHub Issues are disabled; support/privacy requests use the verified developer email shown on the store listing, without copying that address into the repo. The GitHub handle is an initial public publisher name, not a verified legal identity; final store-account confirmation remains necessary.
- `python3 scripts/package.py` creates `artifacts/release/x-media-filter-0.1.0.zip`, `SHA256SUMS` and `package-report.json`. The ZIP has the manifest at its root and 17 explicitly inventoried runtime files plus the root MIT LICENSE notice (18 archive files); generated `_metadata`, source artwork, store images, tests and browser/account data are excluded. CRC, per-file source hashes and inventory are checked on readback; repeated builds in the same environment produce identical bytes.
- [Artwork notes](assets/README.md) identify the 440×280 small promo, 1280×800 actual-settings screenshot and optional 1400×560 marquee. The user confirmed all supplied artwork was generated with ChatGPT and requested direct crop/resize only. Custom layouts, added text/graphics and the Swift exporter were removed; originals remain unchanged outside the ZIP. The square cat supplies the small promo, the existing wide illustration supplies the marquee, and actual 0.1.0 UI supplies the screenshot. A subsequent screenshot-only request centers the intact captured popup between equal strips of its existing document background before resizing; runtime popup layout is unchanged. Its saved all-ON settings are not fresh defaults. The original capture used existing Chrome 155.0.8059.85 and contains no X account content; reuse/cropping is not new browser/network validation.
- Executable runtime files, manifest version 0.1.0 and permissions are unchanged by release preparation. The requested MIT license is in root `LICENSE` and in the ZIP, with copyright 2026 wtchangdm. Local Git history uses `main` and the owner's public GitHub noreply author address; generated `_metadata/`, artifacts and private/browser files are ignored. No new extension dependency/build/backend was added.
- Confirmed decisions: free, all available store regions; public GitHub repository/policy hosting, MIT license and documentation/email support with GitHub Issues disabled. Public remains the last selected store visibility; Unlisted was discussed, not applied, and needs confirmation only if changing that selection. Remaining: unconfirmed account prerequisites (email verification is reported complete), final publisher name/Trader status, turning off the store's built-in public support hub if enabled, final policy/mailbox/listing/crop review, privacy certifications and assessment of applicable additional in-product disclosure/consent obligations. The store docs include a concise publisher-action checklist. Meaningful support/contact obligations remain; disabling Issues does not waive them. Prefer deferred publishing if submission is later authorized; store publication still needs authorization.

The acceptance gaps in §10 remain; packaging and listing preparation do not resolve them. The conditional BFCache dead-port hypothesis was not fixed or reproduced with native BFCache, and is not being promoted to an established severe release blocker. See the validation record for measured checks and remaining uncertainty.
