# X Media Filter Support

For installation, filter defaults and click-to-load controls, see the [user guide](README.md). Requires desktop **Chrome 128 or later**; no extension account, subscription or payment is needed.

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

Grants are temporary and scoped to the current page and rendered occurrence. Navigation, reload or full DOM replacement clears them, even if the replacement shows the same post. Turning a category ON also revokes its grants; already downloaded bytes cannot be undone.

## Known limitations

Filtering covers recognized post-image/video-thumbnail paths on `pbs.twimg.com` and X-initiated delivery on `video.twimg.com`, not every possible X delivery mechanism. New hosts or changed X layouts may need an update.

Not every surface, attachment format or lifecycle has passed browser validation. See [measured coverage and remaining gaps](docs/validation.md); missing fixtures are not reported as passed.

## Contact and privacy requests

For a problem not covered here, a privacy question or a data-removal request, use the **verified developer contact email displayed on this extension's [Chrome Web Store listing](https://chromewebstore.google.com/detail/x-media-filter/foikoegjbgcejpbjgnbggcjoaminebem)**. No personal email address is duplicated in this public repository.

For troubleshooting, include only:

- Extension and Chrome versions.
- Relevant filter settings and concise reproduction steps.
- A public example URL, if safe to share, and the visible error message.

Do not send passwords, cookies, authentication headers, CDP URLs, raw authenticated API responses or private/unrelated account content. Redact personal information from screenshots. There is no automatic diagnostic upload.

Support is best effort: no fixed response time, feature implementation or fix date is promised. This does not waive applicable privacy/legal rights or the publisher's Chrome Web Store obligations. The MIT license does not remove those obligations. See the [privacy policy](PRIVACY.md) for local data handling and voluntarily submitted support messages.
