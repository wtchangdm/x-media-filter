# Chrome Web Store listing — English draft

Review copy, not a published listing. Primary language: English (matches the UI). Suggested category: Workflow & Planning / Tools, if available in the current dashboard. Confirmed distribution: free, public, all regions available in the Chrome Web Store dashboard. Source and policy: https://github.com/wtchangdm/x-media-filter, licensed under MIT. Proposed store publisher name: wtchangdm (the GitHub maintainer; confirm it matches the developer account before submission).

## Name

X Media Filter

## Short description

Filter X post media downloads with click-to-load image groups and videos.

This is the existing manifest description (73 characters). Keep the manifest as the source of truth; the store limit is 132 characters.

## Detailed description — paste the text below

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
• Use Tab and Enter to activate placeholders. Reloading or moving to another logical page clears temporary click permissions. Turning a category ON revokes its loaded media; previously transferred bytes cannot be undone.

LOCAL PROCESSING, NO DEVELOPER TELEMETRY
The extension reads the current X page URL, post/author identifiers, relationships and media metadata locally to apply your filters. It handles placeholder activations locally to load selected attachments. Only the three filter preferences are saved by the extension. It sends no browsing records or analytics to the developer and has no backend or extension account. Eligible media is requested directly from X's media CDNs over HTTPS without forwarding your X authentication headers or cookies.

WHY THESE PERMISSIONS
Storage saves the three filters. Declarative Net Request blocks recognized X media requests before download and guards authorized loads against redirects. Access to x.com and its subdomains identifies posts and inserts placeholders; pbs.twimg.com and video.twimg.com access supports recognized images, posters and selected MP4 playback. No access to all websites, cookies, browser history API or debugger is requested.

LIMITS IN THIS EARLY RELEASE
Requires desktop Chrome 128 or later. Filtering covers recognized pbs.twimg.com post-image/video-thumbnail paths and video.twimg.com requests initiated by X. Avatars, profile banners and ordinary external-link previews are not targets. New X layouts or delivery paths may need updates. Not every X surface or attachment format has been verified.

Video uses one progressive MP4 rendition, not adaptive HLS. HLS-only, live, paid and third-party video may be unavailable. Mixed attachments, animated GIFs, quoted videos, Lists and Communities still have validation gaps. DMs, Spaces and embedded posts on other websites are outside the verified scope. Installing the extension cannot undo earlier downloads.

Independent extension; not affiliated with or endorsed by X Corp.

## Store URLs — ready to paste

- Privacy policy: https://github.com/wtchangdm/x-media-filter/blob/main/PRIVACY.md
- Support: https://github.com/wtchangdm/x-media-filter/blob/main/SUPPORT.md
- Homepage: https://github.com/wtchangdm/x-media-filter
- Proposed publisher name: wtchangdm; final confirmation belongs in the developer account.
- Policy effective date: 2026-10-17.
- Source license: MIT.

Support uses documentation and the verified developer contact email shown on the store listing, not GitHub Issues. The user reports the contact email is verified; its value is deliberately not copied into this repository. Disable the store's built-in Item support visibility in Account settings if no public support hub is desired; this does not remove meaningful-support or contact obligations.

## Image upload order

1. [Actual settings screenshot, 1280×800](../../assets/store/exports/screenshot-settings-1280x800.png): actual UI centered using its existing document background, then resized; no overlays. Shows saved all-ON settings, not fresh defaults.
2. Required [small promo, 440×280](../../assets/store/exports/small-promo-440x280.png): cropped from the supplied square cat image.
3. Optional [marquee, 1400×560](../../assets/store/exports/marquee-media-filter-1400x560.png): minimally cropped/resized from the supplied wide image.
4. Store icon: [existing runtime icon, 128×128](../../extension/icons/icon-128.png).

The supplied illustration is promotional artwork, not a screenshot of the extension. All supplied artwork was generated with ChatGPT, as confirmed by the user. The former custom text/layout compositions have been removed; promos use only direct crops/resizing, and the screenshot centers intact captured UI using its existing background. Final crop/listing approval is pending. No YouTube video is prepared or necessary for the minimum image deliverables; the official image requirements identify icon, small promo and at least one screenshot as mandatory.
