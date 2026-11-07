# Validation and limits

Focused current-X browser regressions pass in normal mode and with target-level HTTP cache disabled/site worker bypassed, in the dedicated isolated Chrome. Earlier native-viewer and selector-dependent results are not inherited coverage. Commands and safety are in the [development guide](development.md); the full acceptance matrix in [specs.md §8](../specs.md#8-implementation-gates-and-acceptance-tests) remains a requirement, not a completed coverage claim.

## Evidence boundaries

The [implementation boundaries](../specs.md#10-selected-implementation-and-verified-boundaries) are not substitute browser evidence. Apply the [network evidence protocol](../specs.md#network-evidence-protocol): capture page and extension-renderer traffic before navigation, distinguish canceled attempts from authorized responses, and separately check visible output. DOM mocks, static checks, cached responses and zero Resource Timing sizes do not establish zero downloads.

The offline suite exercises policy/settings migration, metadata handling, semantic attachment discovery, gallery behavior and privileged loader boundaries. Its results must be reported separately from live browser results; it cannot establish compatibility with current X responses, native focus behavior or real network isolation. Static checks validate resources, syntax, JSON and local documentation links, not media behavior.

## Measured browser coverage

- The public image conversation shows visible A/C placeholders with all filters ON and no successful pre-click media responses. Synthetic clicks do not authorize loading. Trusted loading leaves a cloned duplicate occurrence blocked; A OFF loads the focused image while C stays blocked.
- The four-image album loads its inline still-image group. The owned gallery passes pointer/keyboard entry, Close/Escape, opener-focus restoration and Previous/Next. Inline entry leaves the URL unchanged. Direct `/photo/2` startup/reload stays blocked; each authorized selection fetches only its expected canonical attachment. Arrow navigation does not invoke X's route shortcuts. Settings revoke gallery renderers, and direct Close replaces the photo route with its base post.
- A two-photo post with a nested quoted video inherits the enclosing A policy. All-ON startup blocks all three assets; a still-image click loads only the two-photo group, a separate video click plays the quote, and a cloned duplicate stays blocked. A OFF automatically loads both photos and the quoted video.
- Native status-link SPA navigation recomputes the focused post and leaves media blocked. Duplicate checks use removable cloned occurrences, not proof of X's full virtualization behavior.
- Custom-cover, encoded-thumbnail and source-attributed reused videos show ready placeholders before authorization, then play and seek with one authorized progressive MP4 asset while duplicates stay blocked. Settings remove the renderer; a bounded one-second post-revocation window has no new media requests. Reload loses grants. Observed page-origin image/poster, playlist and MP4/init attempts are canceled with `net::ERR_BLOCKED_BY_CLIENT`; successful authorized responses come from extension renderers.

These checks do not establish adaptive `.m4s` delivery, audio audibility, every video family or long-running revocation behavior. Normal mode includes site-worker-controlled pages with the registered X worker under network observation; this does not establish every CacheStorage or synthesized-response scenario. Detailed captures stay local.

## Current behavior and limits

- Integration targets current X's `media_entities2`, `quoted_tweet_results` and current author metadata, semantic article/media/status anchors and document-local occurrences. No historical schema fallback, `data-testid` selector contract or React identity is supported. Changed or ambiguous inputs can leave attachments unavailable or require a new adapter.
- A full DOM occurrence replacement loses manual grants and may require another click. New occurrences, duplicate locations and other tabs never inherit grants by URL alone.
- Opening the gallery can cause another authorized request for an image already loaded inline. It is not a zero-additional-download design. Native swipe/drag, full-resolution zoom and image-save menus are not promised features.
- Fixed-rendition MP4 is implemented, not adaptive HLS. HLS-only, live, paid and third-party video may remain unavailable. Page-origin playlists/segments are covered by the static barrier; that is not proof of successful adaptive playback.
- Full-surface/eight-setting browser coverage, fresh-install storage, full browser restart, native BFCache and cross-tab behavior remain unproven for this rewrite. Lists/Communities, account-dependent bookmarks/notifications, mixed/GIF posts, additional quoted-video layouts and delivery families need suitable fixtures.
- Redirect rejection has offline tests, not a positive current live test against a redirecting media asset. Chrome 128 is the minimum supported version, not a verified test environment.
- New hosts/paths or media bytes embedded in required HTML/API responses need renewed discovery. DMs, Spaces and external embeds are outside the post-media scope. Installing/updating cannot undo previous downloads; refresh existing X tabs after loading updated scripts.

## Release boundary

Follow the [release gates](store/README.md#release-gates) and verify that the package matches the validated source. Archive integrity alone does not establish browser behavior or authorize submission/publication.
