# X Media Filter

> Browsing X without washing your eyes after reading unpleasant stuff in the comments

Choose which post images and videos download on x.com. Filtered attachments show click-to-load placeholders, so you can keep reading and load media when you want it.

Free to use. Requires desktop **Chrome 128 or later**.

## Install

The Chrome Web Store release is not available yet. To install the current version:

1. [Download the source ZIP](https://github.com/wtchangdm/x-media-filter/archive/refs/heads/main.zip) and extract it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the extracted **`extension/`** folder, not the project root.
4. Pin X Media Filter to the toolbar and refresh your X tabs.

## Choose what to filter

Open the toolbar popup. **ON blocks media downloads; OFF allows eligible media to load.**

| Filter | Default | Applies to |
| --- | --- | --- |
| Filter media on post | OFF | The focused post and independent posts in timelines, profiles and search. |
| Filter media on author replies | OFF | Conversation replies and ancestors by the focused post's author. |
| Filter media on non-author comments | ON | Conversation replies and ancestors by other authors. |

Turn all three ON to filter all recognized post media. Settings are saved in this browser and apply across your X tabs.

## Load an attachment

- Click a blocked image to load the still images from that attachment group in that location.
- Click a blocked video to load only that video, with native playback controls.
- You can also focus a placeholder with Tab and press Enter.

Other posts, separate quote groups and copies in another tab do not inherit your click. Reloading or changing pages clears temporary selections. Turning a category ON blocks its media again; previously downloaded bytes cannot be undone.

## Limits

Filters use post categories, not a judgment of whether content is unpleasant. Avatars, profile banners and ordinary link previews are not targets; DMs, Spaces and external embeds are outside the verified scope.

Some formats and X layouts remain unsupported or unverified. HLS-only, live, paid and third-party videos may not play. See [known limitations and troubleshooting](SUPPORT.md#known-limitations).

## Support and privacy

See [installation help, troubleshooting and contact instructions](SUPPORT.md). The extension has no account or telemetry; its [privacy policy](PRIVACY.md) explains local processing and media requests.

[MIT License](LICENSE). Independent project, not affiliated with or endorsed by X Corp.
