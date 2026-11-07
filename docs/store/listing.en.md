# Chrome Web Store listing — English draft

English review copy for the current source, not proof of the published listing or existing ZIP. Suggested category: Workflow & Planning / Tools, if available. Follow the [release gates](README.md#release-gates) before submission.

## Name

X Media Filter

## Short description

Browse X without needing to bleach your eyes.

## Detailed description — paste the text below

Browse X without needing to bleach your eyes.

Choose which post images and videos load while you browse x.com. Free to use.

X Media Filter blocks recognized post-media requests before download when their filter is ON, and replaces attachments with local click-to-load placeholders. Keep reading post text without automatically loading every attachment.

THREE INDEPENDENT FILTERS
• Filter media on post: the focused post and independent posts in timelines, profiles and search.
• Filter media on author replies: conversation replies and ancestors by the focused post's author.
• Filter media on non-author comments: conversation replies and ancestors by other authors.

ON means block downloads. Fresh-install defaults: post OFF, author replies OFF, non-author comments ON. Existing preferences are saved on this device and shared across X tabs. Refresh X tabs after installation.

LOAD ONLY WHAT YOU CHOOSE
• Click a blocked image to load the still images from that attachment post in that rendered location.
• Click a blocked video to load only that video, with native playback controls and seeking when supported.
• Image clicks do not authorize another quote group, neighboring posts, videos, duplicate locations or another tab.
• Use Tab and Enter to activate placeholders. Click a loaded image to enlarge it in the extension's own gallery, with Previous/Next, arrow keys and Close/Escape. Inline enlargement leaves the page URL unchanged; closing a direct photo URL returns to its post.
• Reloading, moving to another logical page or fully replacing an attachment's rendered location clears its temporary click permission. Turning a category ON revokes its loaded media; previously transferred bytes cannot be undone.

LOCAL PROCESSING, NO DEVELOPER TELEMETRY
The extension reads the current X page URL, post/author identifiers, relationships and media metadata locally to apply your filters. It handles placeholder activations locally to load selected attachments. Only the three filter preferences are saved by the extension. It sends no browsing records or analytics to the developer and has no backend or extension account. Eligible media is requested directly from X's media CDNs over HTTPS without forwarding your X authentication headers or cookies.

WHY THESE PERMISSIONS
Storage saves the three filters. Declarative Net Request blocks recognized X media requests before download and guards authorized loads against redirects. Access to x.com and its subdomains identifies posts and inserts placeholders; pbs.twimg.com and video.twimg.com access supports recognized images, posters and selected MP4 playback. No access to all websites, cookies, browser history API or debugger is requested.

LIMITS IN THIS EARLY RELEASE
Requires desktop Chrome 128 or later. Filtering covers recognized pbs.twimg.com post-image/video-thumbnail paths and video.twimg.com requests initiated by X. Avatars, profile banners and ordinary external-link previews are not targets. Integration targets current X metadata and semantic markup, not historical implementations. Changed layouts or delivery paths may need updates. Not every X surface or attachment format has been verified.

Video uses one progressive MP4 rendition, not adaptive HLS. HLS-only, live, paid and third-party video may be unavailable. Mixed attachments, animated GIFs, quoted videos, Lists and Communities still have validation gaps. DMs, Spaces and embedded posts on other websites are outside the verified scope. Installing the extension cannot undo earlier downloads.

Independent extension; not affiliated with or endorsed by X Corp.

## Store URLs

- Privacy policy: https://github.com/wtchangdm/x-media-filter/blob/main/PRIVACY.md
- Support: https://github.com/wtchangdm/x-media-filter/blob/main/SUPPORT.md
- Homepage: https://github.com/wtchangdm/x-media-filter

## Images

Use the [store exports](../../assets/README.md#store-exports), with the settings screenshot first and focused-post screenshot second. Approval and upload requirements are in the [release guide](README.md#store-requirements-and-submission).
