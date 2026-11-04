# Validation and limits

This is a concise coverage summary, not a run log. Detailed reports and captures stay local. Reproduction commands and browser-safety procedures are in the [development guide](development.md); required acceptance cases are in [specs.md §8](../specs.md#8-implementation-gates-and-acceptance-tests).

## Network evidence

Browser checks observe requests from the X page and extension renderers before navigation. Filtered page requests are canceled with `net::ERR_BLOCKED_BY_CLIENT`; successful authorized image/video responses come from extension-owned renderers. Visible placeholders and decoded media are checked separately. DOM mocks and zero Resource Timing sizes do not establish zero downloads.

The static page barrier remains enabled for images, video, XHR and fetch. Loading uses per-occurrence, single-use tickets with sender, document, route and destination validation, not URL/CDN/tab allow rules. See [the implementation boundaries](../specs.md#10-selected-implementation-and-verified-boundaries).

## Route-owned photo viewer

The blank-image failure came from requiring carousel-specific React media props that were absent in a listless single-image viewer. One extension-owned display surface now selects the attachment from the current status and `/photo/N`, without identifying native slides or reading their React props. Native DOM is used only to locate the display area; missing metadata shows a non-loading placeholder. Missing or ambiguous display areas revoke the viewer rather than reuse stale content.

Focused browser checks cover:

- Single-image manual enlargement with A/C/B ON and automatic enlargement with A OFF, C/B ON; duplicate isolation, native Close/Escape/history, keyboard activation and Retry focus recovery.
- Direct startup and reload with visible placeholders and no successful pre-selection media responses. Each selection window loads only the selected canonical asset, including in cold mode with HTTP cache disabled and the site worker bypassed on the test target.
- Listless and carousel-based single-image layouts, plus a four-image album. Next/Previous, settings revocation and direct reload pass. The album's cold-mode check also compares each selected renderer with its corresponding decoded inline attachment.
- Normal and cold checks for the reported single-image case and four-image album; the alternate single-image layout is normal-mode coverage only. Retry uses a local decode error, not a simulated CDN outage.

Viewer loading can make an additional authorized request for an image already loaded inline. It is not a zero-additional-download design.

## Video and offline checks

Normal-mode video regressions cover custom-cover and encoded-thumbnail posts: no successful pre-click media, one authorized progressive MP4, playback and range seeking, duplicate isolation, reload, automatic loading and filter-ON revocation. These are progressive MP4 results, not proof of adaptive HLS playback.

The offline suite covers filter defaults/migration and all eight combinations; classification; URL/media identity validation; sender/document/route/ticket boundaries; revocation races; viewer ownership and ordinal preservation; ambiguous or replaced stages; cross-status cleanup; forged messages; and keyboard/focus behavior. Static checks cover resources, syntax, JSON and documentation links. See the [local check commands](development.md#local-checks-and-reload).

## Remaining limits

- The viewer still depends on X's photo routes, API metadata and dialog/display-area hooks. Native touch/swipe/drag gestures, full-resolution zoom and image-save context menus are not verified.
- Current focused viewer checks are not a fresh full-surface, eight-setting browser, virtualization or cross-tab pass. The supplementary avatar/profile regression did not complete; earlier results are not promoted to current coverage.
- Full browser restart, fresh-install storage behavior and native BFCache recovery remain unverified. Worker recovery and mocked lifecycle tests do not replace those checks.
- Lists/Communities, account-dependent bookmarks/notifications, additional album layouts, mixed/GIF/quoted-video posts and additional delivery families need suitable live fixtures.
- Playback uses fixed-rendition MP4. HLS-only, live, paid and third-party media may remain unavailable. Page-origin playlists/segments remain covered by the static barrier, but successful adaptive segment delivery is not proven.
- Loader redirect rejection has offline coverage, not a positive live test against a redirecting media asset.
- New media hosts/paths or bytes embedded in required API/HTML responses require renewed discovery. Installing or updating cannot undo prior downloads; refresh existing X tabs to install updated content scripts.

The release archive includes the route-owned viewer change. Packaging checks verify archive integrity, inventory and source hashes; they do not imply store submission or publication.
