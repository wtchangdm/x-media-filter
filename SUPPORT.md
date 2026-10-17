# X Media Filter Support

Installation help, troubleshooting and known limitations for X Media Filter **0.1.0**.

## Install and start

Requires desktop **Chrome 128 or later**. There is no extension account, subscription or payment.

The Chrome Web Store release has not been published yet. For the current unpacked version:

1. Download the repository and extract it locally.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**, then choose the extracted **`extension/`** directory, not the repository root.
4. Pin X Media Filter to the toolbar and refresh existing X tabs.

## Understand the filters

**ON blocks downloads; OFF makes recognized media eligible to load.** Fresh-install defaults:

| Filter | Default | Applies to |
| --- | --- | --- |
| Filter media on post | OFF | The focused post and independent posts in timelines, profiles and search. |
| Filter media on author replies | OFF | Conversation replies and ancestors by the focused post's author. |
| Filter media on non-author comments | ON | Conversation replies and ancestors by other authors. |

Settings apply across this browser profile's X tabs. To block all recognized post media, turn all three ON. Avatars and profile banners are not targets.

Click a blocked image, or focus its placeholder with Tab and press Enter, to load the still images in that attachment group and rendered location. A video click loads only that video. Other posts, separate quote groups, duplicate locations and tabs do not inherit the click.

Reloading or changing logical pages clears temporary grants. Turning a category ON revokes its grants. Already downloaded bytes cannot be undone.

## Troubleshooting

### Nothing seems filtered

- Check that the extension is enabled and the relevant filter is **ON**. The post and author-reply filters default to OFF.
- Refresh X tabs after installing, enabling or updating the extension. Installing cannot undo earlier downloads.
- Check the scope: avatars, banners, ordinary external-link previews, DMs, Spaces and external embeds are not covered by the verified post-media behavior.

### A placeholder says the source is unavailable or loading failed

- Wait for the post to finish loading its metadata, then retry the placeholder.
- Refresh that X tab and try again. For unpacked updates, first reload the extension at `chrome://extensions`.
- If the problem persists, the source, media format or X layout may be unsupported. Do not disable browser security controls or add a broad CDN exception as a workaround.

### A video has no playback or quality selection

Playback uses a selected progressive MP4 with native controls and seeking when supported. It does not use X's adaptive HLS quality selector. HLS-only, live, paid or third-party video may remain unavailable. Playback and sound are not forced automatically; use the native Play and volume controls.

### A previously selected item needs another click

Grants are temporary and scoped to the current page and rendered occurrence. Navigation/reload clears them. If X replaces a virtualized item without a stable, unambiguous identity, another click may be necessary rather than risk authorizing a different item.

## Known limitations

Filtering covers recognized post-image/video-thumbnail paths on `pbs.twimg.com` and X-initiated delivery on `video.twimg.com`, not every possible X delivery mechanism. New hosts or changed X layouts may need an update.

Other album layouts, mixed attachments, animated GIFs, quoted videos, Lists/Communities, full Chrome restart and additional delivery families do not have complete current native validation. Missing fixtures are not reported as passed. See [README](README.md) and [validation evidence](docs/validation.md) for precise coverage.

## Contact and privacy requests

For a problem not covered here, a privacy question or a data-removal request, use the **verified developer contact email displayed on this extension's Chrome Web Store listing**. No personal email address is duplicated in this public repository. Until the store listing exists, that contact route is not yet available from a listing; this page does not invent a temporary address.

For troubleshooting, include only:

- Extension and Chrome versions.
- Relevant filter settings and concise reproduction steps.
- A public example URL, if safe to share, and the visible error message.

Do not send passwords, cookies, authentication headers, CDP URLs, raw authenticated API responses or private/unrelated account content. Redact personal information from screenshots. There is no automatic diagnostic upload.

Support is best effort: no fixed response time, feature implementation or fix date is promised. This does not waive applicable privacy/legal rights or the publisher's Chrome Web Store obligations. The MIT license does not remove those obligations. See the [privacy policy](PRIVACY.md) for local data handling and voluntarily submitted support messages.
