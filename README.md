# X Media Filter

Block downloads of recognized X post images and videos according to your filters, and show local click-to-load placeholders instead. Clicking an image loads the still images from the same attachment post in the same rendered occurrence; clicking a video loads only that video.

Native Chrome Manifest V3 extension, version **0.1.0**. No npm install, build step, backend or X API credentials.

## Public release preparation

The planned release is **free, public, and available in all regions offered by the Chrome Web Store**. Source: [wtchangdm/x-media-filter](https://github.com/wtchangdm/x-media-filter), under the [MIT License](LICENSE). [Privacy policy](https://github.com/wtchangdm/x-media-filter/blob/main/PRIVACY.md) and [support](https://github.com/wtchangdm/x-media-filter/blob/main/SUPPORT.md) are hosted on GitHub. The Chrome Web Store extension has not been uploaded, submitted for review or published; public source hosting is separate.

Run `python3 scripts/package.py` to create `artifacts/release/x-media-filter-0.1.0.zip`, its SHA-256 checksum and a per-file inventory. See the [release checklist](docs/store/README.md) for listing text, disclosures, reviewer instructions, images and all remaining decisions. The [privacy policy](PRIVACY.md) identifies GitHub maintainer `wtchangdm`, this repository, documentation/email-based support and its 2026-10-17 effective date. Final store certifications and account setup remain pending; see [where to register](docs/store/README.md#where-to-set-up-your-chrome-web-store-account).

## Install unpacked

Requires **Chrome 128 or later**.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this project's **`extension/`** directory, not the project root.
3. Pin X Media Filter to the toolbar and refresh existing X tabs.
4. Open the dark settings popup. **ON means block downloads**:
   - **Filter media on post** (`a` / A, default **OFF**): the focused post, independent timeline/recommended items, and posts on non-status surfaces such as timelines, profiles and search.
   - **Filter media on author replies** (`c` / C, default **OFF**): conversation replies and ancestors by the focused post's author.
   - **Filter media on non-author comments** (`b` / B, default **ON**): conversation replies and ancestors by other authors.

Settings are saved in `chrome.storage.local` and apply across X tabs with the extension loaded. Legacy `{a,b}` preferences retain both values and initialize `c` from `a`; existing preferences are not reset. Startup stays blocked until the settings read completes, even though A and C default to OFF on a fresh install. Quotes inherit the enclosing post's category. Uncertain classification does not automatically authorize media that might still be filtered. The popup is dark-only and has no footer.

Click a placeholder, or focus it with Tab and press Enter, to authorize loading. An image click loads the remaining still images in **the same attachment post and rendered occurrence**, not another quoted/enclosing attachment group, neighboring post, duplicate occurrence, another tab or a video. Each image retains an independently validated single-use loader ticket; there is no whole-post or CDN-wide allow rule. Videos use native controls without forced autoplay or sound.

Navigating to another logical page, reloading, or turning the relevant category ON clears its grants. Already transferred bytes cannot be undone, including downloads made before installation.

## Implementation and limits

- Packaged `extension/rules.json` provides a **pre-request DNR barrier**, independent of settings reads and author discovery. Clicking does not broadly release X-origin image, poster, video, XHR or fetch requests.
- Eligible attachments render in extension-origin iframes. Images use anonymous CORS; videos use native **progressive MP4 range requests**, not whole-video base64 buffering. The worker passes only validated per-item URLs/tickets, never X authentication headers.
- Custom `/media/` video covers can bind to an MP4 using the same media entry's explicit `id_str`. Encoded thumbnails must still match their video family/ID; metadata cannot override mismatches. The loader rejects redirects and denies loading if its guard cannot be installed.
- Identical CDN URLs do not share grants. Virtualization uses X's existing keyed timeline identity where unambiguous; unknown/conflicting identities get independent document-local identities and may require another click after full replacement.
- Video uses one fixed MP4 rendition, not X's adaptive HLS quality selector. HLS-only, live, paid or third-party media may be unavailable. Missing sources show a retry state, not a CDN-wide exception.
- Coverage is limited to recognized `pbs.twimg.com/media/`, `tweet_video_thumb/`, `ext_tw_video_thumb/`, `amplify_video_thumb/` and `video.twimg.com` delivery. New hosts/paths or media embedded in required API/HTML responses need revalidation.
- Avatars, profile banners and ordinary external-link previews are not targets. DMs, Spaces and external embeds are outside this version's verified scope.
- The supplied OpenAIDevs three-image attachment is verified. Other album layouts, mixed attachments, GIFs, quoted videos, Lists/Communities and full Chrome restart remain validation gaps. Bookmarks/notifications had no media in the available test state; visiting an empty surface is not a pass.

Existing Chrome **155.0.8059.85** evidence covers all eight filter combinations, grouped three-image loading in cold/normal modes, isolation/revocation, video playback/seeking, SPA navigation, virtualization and the dark popup. Defaults, migration and storage-read races have offline coverage; the user's settings were not erased to simulate a fresh install. See [validation evidence](docs/validation.md) and the [specification](specs.md).

All supplied artwork was generated with ChatGPT, as confirmed by the user. Manifest/action icons use the supplied `Grumpy Cat Rubbing Its Eye.png`. Store images use only crops/resizing of the supplied artwork; no new text, graphics or custom compositions are added. Sources and store assets remain outside the extension ZIP. See [artwork notes](assets/README.md).

## Development and offline checks

Requires Node.js 22+. There are no package dependencies or lockfiles.

```sh
node --test tests/*.test.cjs
node tests/check.mjs
```

After code changes, reload the extension at `chrome://extensions`, then refresh the test X tabs.

## Existing-Chrome browser validation

Connect only to the **user's already-running Chrome**, never a separate clean/logged-out browser. `agent-browser` and an authorized CDP connection are development tools, not extension runtime requirements.

```sh
agent-browser --session xmf-check --auto-connect --pin-tab tab new about:blank
agent-browser --session xmf-check get cdp-url
agent-browser --session xmf-check tab list --json
```

Use the current browser WebSocket URL and the **new test tab's `targetId`**. Never reuse stale IDs or select an unrelated user tab. Below, `<WS>` and `<TARGET>` stand for those fresh values.

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
```

`load.mjs` uses development-only `Extensions.loadUnpacked`. If Chrome denies it, use manual installation/reload instead; do not change browser security settings. If a different project path changes the unpacked extension ID, set `XMF_EXTENSION_ID` to the ID returned by `load.mjs` before running `browser.mjs`.

`browser.mjs` temporarily changes popup settings, creates a test X tab and adds removable duplicate-attachment DOM fixtures. It restores settings and closes its helper tabs afterward. It stops only **this extension's** worker to test recovery, not X's or another extension's worker. `virtualization.mjs` and `surfaces.mjs` require all three filters ON, not fresh-install defaults.

Cold mode temporarily disables HTTP cache and bypasses the site worker on test targets only, then restores those controls. It does not clear cookies, accounts, site storage or the user's CacheStorage. Reports contain aggregate outcomes, not authentication headers, cookies, API bodies or HARs. CDP URLs grant browser control: do not commit or share them.
