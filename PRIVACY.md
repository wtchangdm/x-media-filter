# X Media Filter Privacy Policy

- Publisher: **wtchangdm**
- Effective date: **2026-10-17**
- Project: [X Media Filter](https://github.com/wtchangdm/x-media-filter)
- Support: [Support and troubleshooting](https://github.com/wtchangdm/x-media-filter/blob/main/SUPPORT.md)
- Applies to extension version **0.1.0**.

## Purpose

X Media Filter controls whether recognized post images and videos download on x.com. It classifies attachments, shows local placeholders, and loads media you select or make eligible through your filters. It is independent of X Corp.

## Information processed on your device

- **Preferences:** three filter booleans saved in Chrome's local extension storage. They apply across your X tabs in this browser profile. This extension does not sync them to another device.
- **Current X page context:** the current X URL/status ID, post and author identifiers (including author handles), conversation/quote relationships, media URLs, identifiers, types, dimensions and video variants. The extension inspects rendered X elements and parses relevant X API responses already received by the page. Only selected metadata is kept in bounded, temporary in-memory records for classification and rendering; the extension does not archive those API responses or post bodies as browsing records.
- **Temporary interaction state:** which attachment occurrence you authorize, the current tab/document/route context, renderer identity keys and single-use loading tickets. This prevents a click from authorizing another attachment or tab. It is not an analytics log.

These data are used only for media filtering and loading. The extension does not request the browser history API or create a browsing-history database. It does not read passwords, cookies or X authentication headers, and includes no extension login, advertisements, telemetry, crash-reporting service or developer-operated backend.

## Network requests and recipients

The extension does not transmit page metadata, preferences or interaction records to the publisher, an analytics service or a data broker.

When a filter is OFF, eligible media may load automatically. When a filter is ON, a trusted placeholder activation authorizes its image group or selected video. The extension renderer requests eligible images/posters directly from **pbs.twimg.com** and progressive video directly from **video.twimg.com** over HTTPS using anonymous CORS, without forwarding X login headers or cross-origin cookies.

Those CDN operators necessarily receive the requested media URL, your IP address and ordinary browser/network request information. They are not operated by this extension's publisher. X continues to make its own normal page/API requests under its own policies. The extension is not an anonymity tool and does not block all X tracking.

Chrome and the Chrome Web Store may independently process installation, update, review or store-usage information under Google's policies. This is separate from extension telemetry; the extension includes no telemetry sender.

## Retention and your choices

Only filter preferences are deliberately persisted by the extension. Change them in the toolbar popup. Uninstalling removes its local extension storage through Chrome. The publisher has no extension-uploaded browsing records to retrieve or delete.

Temporary metadata and grants remain in memory while their document/worker context exists, with bounded records. Grants are revoked on logical route changes, reloads or applicable reblocking. Closing X tabs releases their document state. Browser-managed HTTP/media caches may retain previously downloaded bytes independently; revoking a grant or uninstalling does not erase those caches or undo prior transfers.

## Limited Use

X Media Filter's use of information accessed through Chrome APIs adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. Information is used only to provide the disclosed media-filtering purpose. It is not sold, used for advertising, transferred for unrelated purposes, used for creditworthiness or lending decisions, or made available for human review by the publisher through the extension.

## Policy hosting and support

This policy and the project's source are hosted in the public [X Media Filter repository](https://github.com/wtchangdm/x-media-filter). Visiting GitHub is separate from using the extension: the extension does not send browsing data to GitHub. GitHub processes website visits and account activity under the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The [support page](https://github.com/wtchangdm/x-media-filter/blob/main/SUPPORT.md) provides installation help, troubleshooting and known limitations. GitHub Issues are disabled. For direct support or privacy requests, use the verified developer contact email displayed on the extension's Chrome Web Store listing when available; no personal address is duplicated in this repository.

If you choose to send an email, the publisher receives your sender address, message and any attachments. This is separate from the extension, which does not automatically send diagnostics or browsing records. Support information is used to address your request, troubleshoot the extension, handle security/privacy concerns and meet applicable obligations. The publisher and the email providers involved in delivering or responding to the message process that correspondence; it is not posted to a public issue tracker. Email providers' own service/privacy policies also apply.

Support correspondence is retained only as needed to address the request and meet applicable security/legal obligations, then deleted when no longer needed. Request access or deletion through the same developer contact address. This does not promise erasure of recipients' copies, provider backups or records the provider or publisher must retain under applicable requirements. No fixed provider log-retention period is invented here.

Do not send passwords, cookies, authentication headers, CDP URLs, private posts or unrelated account information. Share only the minimum information needed for your request and redact personal information from screenshots.

## Changes and contact

The publisher will update this policy when data practices change and provide any disclosures or consent required for those changes. For questions, start with the [support page](https://github.com/wtchangdm/x-media-filter/blob/main/SUPPORT.md) and its developer-contact instructions.
