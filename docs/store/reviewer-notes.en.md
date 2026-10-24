# Reviewer test instructions — draft for dashboard

X Media Filter 0.1.1 is a desktop Chrome Manifest V3 extension requiring Chrome 128+. There is no extension account, license key, payment, backend or runtime debugging connection. The development CDP harness is not packaged or required for users/reviewers.

## Setup and access

1. Install the submitted extension and refresh existing x.com tabs. Pin its toolbar action to reach the settings popup.
2. ON means block downloads. Fresh defaults are post OFF, author replies OFF, non-author comments ON. Set all three ON for the blocking demonstrations below.
3. X may require its own account/sign-in to display conversations. No X credentials are bundled or supplied here. If review requires access credentials, the publisher must arrange an authorized review method through the dashboard; do not use a developer's personal browser session or share cookies/headers.

## Reproducible examples

Public fixture availability depends on X and may change:

- Image thread: https://x.com/ArtificialAnlys/status/2110893784422908225
- Three-image attachment: https://x.com/OpenAIDevs/status/2110855382444704190
- Custom-cover video: https://x.com/github/status/2111225205309780009
- Encoded-thumbnail video: https://x.com/thsottiaux/status/2111249534072529256
- Quoted image with preceding ancestor: https://x.com/thsottiaux/status/2111245052513259606

## Expected behavior

1. With all filters ON, recognized attachments show local image/video placeholders; post text and actions remain usable. Requests attempted by X to covered media paths are canceled by packaged pre-request rules, not hidden after a successful page download.
2. Click one image placeholder in the three-image attachment, or focus it with Tab and press Enter. Its three still images load through separate extension renderers. Other posts, another quote group, videos and another tab's copies are not authorized by that click.
3. On either video example, click its video placeholder. Native MP4 playback controls appear; start playback and seek if desired. The extension does not force autoplay or sound. No adaptive HLS quality selector is provided.
4. Reload with all filters ON: previous manual grants are gone. Then turn only the post filter OFF: eligible focused-post media can load automatically without a click. Turn it ON again: media is reblocked and playback/future loading stops; bytes already transferred cannot be recalled.
5. On the image conversation, independently switch author replies and non-author comments to distinguish those categories from the focused post. An ancestor before the focused post must not become the author reference. Independent recommendations use the post filter. Uncertain classification stays conservative.
6. Open a second X tab with the same post: preferences propagate, but manual click grants do not. Navigate to another logical route: prior route grants are revoked.

## Implementation review notes

- `rules.json` keeps page-origin X media requests blocked for recognized paths, regardless of settings. No tab/CDN-wide allow rule is used for clicks.
- `worker.js` checks internal sender, tab, exact document context, route epoch, single-use ticket and permitted media destination. A redirect-guard installation failure denies loading.
- `player.html` renders only the validated image or progressive MP4 with anonymous CORS. It does not act as an arbitrary URL fetch proxy or forward X cookies/authentication headers.
- `bridge.js` observes relevant X responses already delivered to the page and sends selected metadata through a nonce-bound MessagePort. No remotely supplied code is executed. All executable resources are packaged.
- Only three boolean settings are persisted. No analytics, browsing record uploads, remote code, debugger/cookies/history permissions or external services are added by the extension.

## Known limitations — not a universal compatibility claim

Fixed-rendition progressive MP4 only. HLS-only/live/paid/third-party video may remain unavailable. Recognized pbs.twimg.com post-image/poster paths and video.twimg.com delivery are covered; new hosts or changed X layouts need revalidation. Mixed attachments, animated GIFs, quoted videos, Lists/Communities and full-browser-restart behavior do not have complete current native validation. DMs, Spaces and external embeds are outside the verified scope. Earlier broad surface reports were not all rerun after recent fixes.

Existing evidence uses Chrome 155.0.8059.85, not an actual Chrome 128 run. Release packaging did not change runtime code. See the project's validation documentation for test provenance; do not submit private CDP URLs, raw API bodies, account screenshots or authenticated HARs as reviewer evidence.
