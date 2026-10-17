# Privacy practices — submission draft

Based on **0.1.0 source code**. Nothing has been certified or submitted in the developer dashboard. Local-only processing still requires disclosure; no developer backend does not mean no user data is handled.

## Single purpose — paste copy

Control downloads of recognized X post images and videos using three category filters and per-occurrence click-to-load placeholders on x.com.

## Permissions justification — paste copy

| Dashboard field | Justification |
| --- | --- |
| `storage` | Save only the three filter preferences in chrome.storage.local and propagate preference changes across this browser's X tabs. No browsing records or manual grants are persisted. |
| `declarativeNetRequest` | Use enabled packaged block rules to stop recognized X-initiated post image, poster and video requests before download, including XHR/fetch delivery. A session rule rejects redirects for extension-owned authorized CDN loads. Settings and clicks never install broad allow rules. |
| Host permissions | x.com and its subdomains support document-start post/media discovery, focused-post classification and local placeholders. pbs.twimg.com supplies recognized images/posters; video.twimg.com supplies a validated selected progressive MP4. These CDN permissions also scope the renderer's redirect guard. No arbitrary destination proxy, all-sites access or authentication-header forwarding is provided. |
| Remote code | No. All executable JavaScript, HTML and CSS are packaged with the extension. X API responses are treated as data, not executable instructions. Selected CDN images/video are media, not remote code. No eval, remote script imports, CDN libraries or remotely supplied executable configuration is used. |

Sources: `extension/manifest.json`, `rules.json`, `worker.js`, `bridge.js`, `content.js`, `player.js` and `popup.js`. Calling `chrome.tabs.get/sendMessage` does not itself require adding the broad `tabs` permission; existing X host access scopes the current-page checks. No permission changes are proposed.

## Data usage — conservative category mapping

The following is a proposed mapping for publisher review against the current dashboard definitions, not an approved submission. Do not select “does not collect or use user data” merely because processing is local.

| Data category | Proposed disclosure and actual scope |
| --- | --- |
| Personally identifiable information | X post author handles/identifiers, processed temporarily to distinguish author replies from other comments. Not an extension registration/contact database. |
| Web history | Current X URL/status context and attachment URLs, used temporarily for classification and revocation. No browser history API or persistent browsing log. |
| User activity | Placeholder activations and temporary per-occurrence grants, handled locally for authorized loading. No clickstream analytics. |
| Website content | Relevant rendered X structure and API post/media metadata, plus selected CDN media for display. Responses are parsed locally, not uploaded or archived by the extension. |
| Health, financial/payment, authentication information, personal communications, location | No intentional processing for these purposes or dedicated access. DMs are out of scope. Normal authorized CDN requests expose an IP address; the extension does not perform geolocation. Arbitrary X posts may contain sensitive subjects; do not claim third-party content can never contain them. |

The implementation supports the three limited-use certifications: no sale/transfer outside permitted purposes, no use unrelated to the single purpose, and no creditworthiness/lending use. The publisher must verify that the final extension, policy, support practices and dashboard answers agree before making these certifications.

## Filled policy and store fields

The GitHub-readable [PRIVACY.md](../../PRIVACY.md) has **no remaining placeholders**:

| Field | Filled value | Basis / remaining check |
| --- | --- | --- |
| Public maintainer/publisher name | `wtchangdm` | Authenticated GitHub owner; use as the initial public name, not a verified legal identity. Confirm it matches the intended store publisher. |
| Repository/homepage | https://github.com/wtchangdm/x-media-filter | Same-name public repository requested by the user. |
| Privacy policy | https://github.com/wtchangdm/x-media-filter/blob/main/PRIVACY.md | Rendered Markdown on the default branch; no separate website required. |
| Support | https://github.com/wtchangdm/x-media-filter/issues | Initial support channel using the selected public repository. The maintainer should monitor it. |
| Effective date | 2026-10-17 | Current policy-preparation/public-source date, not a claimed store release date. |
| License | MIT | Explicitly requested; root LICENSE is also included in the release ZIP. |
| Price / visibility / regions | Free / public / all available store regions | Explicit user decisions, subject to platform restrictions. |

The policy discloses GitHub hosting and public Issues records and links GitHub's own privacy statement. No provider log-retention period has been invented. Keep the public policy current and review it before store certification. The account owner's legal verification, email, Trader classification and any additional consent determination cannot be filled from a GitHub profile; see [account setup and remaining approvals](README.md#where-to-set-up-your-chrome-web-store-account).

## Complete disclosure checklist

These subjects are already addressed in the draft policy and/or listing. The publisher should approve them rather than supply more personal information:

- [ ] Single purpose and the three filters, including automatic loading with a filter OFF.
- [ ] Local processing of the current X URL, status/post IDs, author handles, relationships, media metadata and rendered structure.
- [ ] Local handling of placeholder activations, occurrence identities and temporary tickets/grants.
- [ ] Only the three preferences are deliberately persisted; no browsing database or cross-device sync.
- [ ] No developer telemetry/backend, analytics uploads, sale, advertising, unrelated transfers or credit/lending use.
- [ ] No reading/forwarding of passwords, cookies or X authentication headers.
- [ ] Direct HTTPS requests to the named X CDNs, which receive the media URL, IP and ordinary request information.
- [ ] X's own traffic and Google's platform processing are separate; filtering is not anonymity or total tracking prevention.
- [ ] Retention, revocation, uninstall behavior and the fact that downloaded bytes/browser caches cannot be undone.
- [ ] GitHub policy hosting and public Issues support, including voluntarily submitted usernames/text/attachments and public-record retention.
- [ ] Limited Use statement, policy changes and a working support channel.
- [ ] Final dashboard categories and all three data-use certifications match actual behavior.

## In-product disclosure and consent — unresolved assessment, not a proven defect

The current popup explains filtering and click-to-load. It has **no separate data-processing notice, privacy-policy link or consent gate**. The listing and policy now describe local processing, but they do not constitute an in-product consent flow.

The official User Data FAQ describes prominent disclosure and affirmative consent within the product where that requirement applies. The remaining question is whether this necessary, local-only processing requires an additional flow beyond the existing functionality/permission disclosures. This preparation has not established that answer. It is not a finding that the extension is definitely prohibited or that a new consent screen is automatically required.

If an in-product notice is required, proposed text for review is:

> X Media Filter processes the current X page URL, post/author identifiers, media metadata and your media-load selections on this device to apply your filters. Only your three filter settings are saved. Eligible media is requested directly from X's media CDNs. No browsing records or analytics are sent to the developer. Read the Privacy Policy for details.

If affirmative consent is also required, text alone is insufficient. The flow would need to appear **before the covered processing**, provide a clear affirmative choice and policy link, define decline/revocation behavior, and keep the network barrier fail-closed. Adding it requires an explicit implementation decision and fresh validation; it is not implemented in this documentation change.

## Official references

Previously checked 2026-10-17. Recheck the final dashboard wording at submission.

- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ — local handling and prominent disclosure](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
