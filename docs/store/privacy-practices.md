# Privacy practices — submission draft

Draft disclosures for the **current source**, not dashboard certifications. Reconcile them with the verified package under the [release gates](README.md#release-gates). Local-only processing still requires disclosure; no developer backend does not mean no user data is handled.

## Single purpose — paste copy

Control downloads of recognized X post images and videos using three category filters and per-occurrence click-to-load placeholders on x.com.

## Permissions justification — paste copy

| Dashboard field | Justification |
| --- | --- |
| `storage` | Save only the three filter preferences in chrome.storage.local and propagate preference changes across this browser's X tabs. No browsing records or manual grants are persisted. |
| `declarativeNetRequest` | Use enabled packaged block rules to stop recognized X-initiated post image, poster and video requests before download, including XHR/fetch delivery. A session rule rejects redirects for extension-owned authorized CDN loads. Settings and clicks never install broad allow rules. |
| Host permissions | x.com and its subdomains support document-start post/media discovery, focused-post classification and local placeholders. pbs.twimg.com supplies recognized images/posters; video.twimg.com supplies a validated selected progressive MP4. These CDN permissions also scope the renderer's redirect guard. No arbitrary destination proxy, all-sites access or authentication-header forwarding is provided. |
| Remote code | No. All executable JavaScript, HTML and CSS are packaged with the extension. X API responses are treated as data, not executable instructions. Selected CDN images/video are media, not remote code. No eval, remote script imports, CDN libraries or remotely supplied executable configuration is used. |

The [manifest](../../extension/manifest.json) is the permission source of truth. Calling `chrome.tabs.get/sendMessage` does not itself require the broad `tabs` permission; existing X host access scopes current-page checks.

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

## Policy review

Approve [PRIVACY.md](../../PRIVACY.md) as the authoritative disclosure of local processing, persistence/revocation, CDN recipients, GitHub hosting, voluntary support email, retention/deletion and Limited Use. Store URLs are in the [listing](listing.en.md#store-urls); account prerequisites are in the [release guide](README.md#where-to-set-up-your-chrome-web-store-account).

Review support-email recipients, retention and deletion against the actual mailbox/provider practices; add provider-specific disclosures if needed. The provider has not been inspected, and no personal email belongs in this repository. Filled policy fields do not substitute for the publisher's approval or dashboard certifications.

## In-product disclosure and consent — unresolved assessment, not a proven defect

The current popup explains filtering and click-to-load. It has **no separate data-processing notice, privacy-policy link or consent gate**. The listing and policy now describe local processing, but they do not constitute an in-product consent flow.

The official User Data FAQ requires prominent in-product disclosure and affirmative consent where applicable. Whether this necessary local processing needs an additional flow remains unresolved; a new consent screen is not established as mandatory.

If required, disclose the processing described in the policy before it begins. Affirmative consent needs a clear choice and policy link, defined decline/revocation behavior, and a fail-closed network barrier, not notice text alone. Implementation requires an explicit decision and fresh validation.

## Official references

Recheck the final dashboard wording at submission.

- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ — local handling and prominent disclosure](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [Meaningful customer support requirement](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Developer agreement, including support/contact requirements](https://developer.chrome.com/docs/webstore/program-policies/terms)
