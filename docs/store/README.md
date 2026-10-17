# Public release preparation — 0.1.0

**Chrome Web Store review candidate, not a submitted or published store extension.** Public GitHub source hosting and the MIT license were explicitly requested; those are separate from store submission, developer-account registration, payments and store publication. Runtime code, manifest version, permissions and saved settings remain unchanged.

## Confirmed decisions

- **Price:** free. A free listing does not remove Google's separate one-time developer registration fee.
- **Visibility and regions:** public, in all regions available in the Chrome Web Store dashboard, subject to platform restrictions.
- **Repository:** [wtchangdm/x-media-filter](https://github.com/wtchangdm/x-media-filter), public, default branch `main`.
- **License:** [MIT](../../LICENSE), copyright 2026 wtchangdm. The release ZIP also includes this notice.
- **Policy:** https://github.com/wtchangdm/x-media-filter/blob/main/PRIVACY.md
- **Support:** https://github.com/wtchangdm/x-media-filter/issues
- **Publisher name/date:** `wtchangdm` (GitHub maintainer used as the initial public name), policy effective 2026-10-17. Confirm the actual store publisher name before submission. No separate policy website is required.
- **Language:** English throughout project documentation and store materials.
- **Artwork origin:** all supplied artwork was generated with ChatGPT, as confirmed by the user. This is recorded as the source, not treated as an unanswered provenance question.
- **Image treatment:** crop/resize supplied images only. The previous custom text/layout compositions and Swift exporter have been removed. Keep the supplied originals untouched. A subsequent screenshot-only request centers the actual popup panel using its existing background pixels; the runtime popup layout remains unchanged.

## Reviewable deliverables

| Item | Location |
| --- | --- |
| Runtime ZIP | `artifacts/release/x-media-filter-0.1.0.zip` |
| Checksums and per-file inventory | `artifacts/release/SHA256SUMS`, `package-report.json` |
| Reproducible packager | [scripts/package.py](../../scripts/package.py), Python 3 standard library |
| Listing | [listing.en.md](listing.en.md) |
| Permission/data disclosures and full policy checklist | [privacy-practices.md](privacy-practices.md) |
| GitHub-readable privacy policy | [PRIVACY.md](../../PRIVACY.md) |
| Reviewer test instructions | [reviewer-notes.en.md](reviewer-notes.en.md) |
| Required images | [440×280 small promo](../../assets/store/exports/small-promo-440x280.png), [1280×800 actual UI screenshot](../../assets/store/exports/screenshot-settings-1280x800.png), [128×128 icon](../../extension/icons/icon-128.png) |
| Optional marquee | [1400×560 supplied wide illustration](../../assets/store/exports/marquee-media-filter-1400x560.png) |

The ZIP contains **17 runtime files plus the MIT `LICENSE` notice** (18 files total), with `manifest.json` at its root. It excludes Chrome-generated `_metadata/`, source artwork, store images, tests, docs and browser/account data. The packager refuses unknown runtime files or symlinks; `_metadata/` and `.DS_Store` are explicitly excluded. `artifacts/` is already ignored.

## Rebuild and verify

From the project root:

```sh
node --test tests/*.test.cjs
node tests/check.mjs
python3 scripts/package.py
(cd artifacts/release && shasum -a 256 -c SHA256SUMS)
```

The packager reads back the archive and verifies CRC, inventory and each source-file hash. ZIP order, permissions and timestamps are fixed. The same source/environment reproduces the same bytes; different zlib versions may produce different compressed bytes.

Optional image preparation: `sh scripts/store-assets.sh`, using an already-installed `ffmpeg`. It crops/resizes promotional images and centers the screenshot's intact UI between equal strips of its existing document background. It adds no text, generated backgrounds or graphics. Pre-generated PNGs are included, so the extension does not need this tool. Crop coordinates and actual screenshot provenance are in [assets/README.md](../../assets/README.md).

## What “publisher account status” means

This refers to the **Chrome Web Store developer account**, not the artwork or ChatGPT account:

1. Which Google/developer account will own the listing, and which public developer name it will show.
2. Whether developer registration and its one-time fee are complete.
3. Whether the required contact email is verified.
4. Whether Google 2-Step Verification is enabled.
5. Whether the publisher has declared Trader/Non-Trader status and completed any required verification.

Do not put credentials, payment details, identity documents, personal addresses or verification codes in this repository or chat. The account owner should handle those steps directly. Trader determination is the publisher's responsibility; required verified contact/legal information may be displayed publicly by the store.

## Where to set up your Chrome Web Store account

Start at the official [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).

1. Sign in with the Google account that should own the extension. Choose it carefully; Google's registration guide explains account email changes require a new account/item transfer.
2. If not registered, complete developer registration, review/accept Google's agreement and policies, and pay the one-time registration fee shown there. The extension itself remains free. Payment and acceptance must be handled by the account owner, not recorded in the repo or chat.
3. Open **Account** in the dashboard. Set the public publisher name (initial draft: `wtchangdm`), add/verify the contact email, and complete the requested developer profile fields.
4. Enable [Google 2-Step Verification](https://myaccount.google.com/security) if not already enabled. It is required before publishing/updating store extensions.
5. Declare **Trader or Non-Trader** and complete any applicable verification. This is a legal self-classification, not something inferred from GitHub or the extension being free. Supply any requested identity/contact information directly to Google.
6. Once ready, the dashboard's **Items / Add new item** flow is where the ZIP and prepared store fields go. Do not submit for review or enable automatic publication until final approval.

Official instructions: [register](https://developer.chrome.com/docs/webstore/register), [set up the account](https://developer.chrome.com/docs/webstore/set-up-account). Account status has not been inspected or changed by this work.

## Support contact

Use [GitHub Issues](https://github.com/wtchangdm/x-media-filter/issues) as the initial public support channel. It avoids inventing or exposing a personal support email. The maintainer should monitor it; issues, usernames and attachments are public, as disclosed in the policy. Google's required verified developer-account email is separate and still must be configured directly in the dashboard.

## All remaining items before submission

### Filled fields and remaining approvals

All former policy placeholders are filled:

- [x] Public maintainer/publisher draft name: `wtchangdm`, from the authenticated GitHub account, not an inferred legal identity.
- [x] Repository/homepage: https://github.com/wtchangdm/x-media-filter
- [x] Policy URL: https://github.com/wtchangdm/x-media-filter/blob/main/PRIVACY.md
- [x] Support URL: https://github.com/wtchangdm/x-media-filter/issues
- [x] Policy effective date: 2026-10-17, the policy-preparation/public-source date, not a claimed store release date.
- [x] License: MIT, as requested.

Remaining approvals:

- [ ] Confirm the final store publisher name and the maintainer's ability to monitor Issues; review the public-support retention wording.
- [ ] Approve the policy's complete data-handling disclosures, listed individually in [privacy-practices.md](privacy-practices.md).
- [ ] Resolve whether additional in-product disclosure/affirmative consent applies to this necessary local processing. The existing popup has no separate processing notice, policy link or consent gate. This is an unresolved assessment, not a demonstrated mandatory new feature or established severe blocker.
- [ ] Check the live dashboard's data-category definitions and certify the three limited-use statements only after they match the final product/policy/support practices.
The policy has no remaining placeholder values or unpublished-draft notice. It names GitHub hosting and Issues support, links GitHub's own privacy statement, and does not invent a platform log-retention period. Filled fields do not substitute for the publisher's final review or store certifications.

### Other release prerequisites

- [ ] Confirm developer-account readiness using the five points above; the account itself has not been inspected.
- [x] Public GitHub repository and MIT source license selected and authorized. Local history uses a GitHub noreply commit email; generated extension metadata, release artifacts and browser/private data are excluded from source control.
- [ ] Review the direct image crops and final listing. ChatGPT provenance is recorded; no independent legal clearance or blanket guarantee against third-party rights is claimed. No extra artwork-source information is requested.
- [ ] If X's login wall blocks review, arrange an authorized review-access method. Do not give reviewers personal cookies, authentication headers or CDP URLs.
- [ ] Decide whether to complete outstanding browser cases or release with the clearly documented limitations. See [validation evidence](../validation.md).
- [ ] Authorize upload/submission, then separately authorize publication. Preparation alone is not permission to publish.

Free pricing, all available regions, the GitHub repository/policy/support URLs and MIT licensing are **settled**, not questions to ask again.

## Store requirements already checked

Official sources were checked on **2026-10-17**; no authenticated dashboard state has been inspected.

- Root-level manifest; description at most 132 characters; later uploaded updates need a higher version.
- Required: 128×128 PNG icon, 440×280 small promo, and at least one screenshot (maximum five, 1280×800 or 640×400). A 1400×560 marquee is optional. The specific Images guide identifies these minimum assets; no promotional video is needed for this prepared minimum set.
- Single purpose, permission explanations, remote-code declaration, data-use certifications and publicly accessible privacy policy. Local processing must be disclosed.
- Developer registration, verified contact email and 2-Step Verification; Trader/Non-Trader declaration as applicable to the account flow.
- Deferred publishing can prevent automatic publication after approval. The official guide currently gives a 30-day staged-publication window after review; recheck at submission.

## Validation boundaries

Existing evidence uses **Chrome 155.0.8059.85**, not a real Chrome 128 run. The popup capture was taken in the user's existing Chrome, in a named/pinned session, with all three saved filters ON and no setting changes. The new crops reuse that capture: no browser was launched for image revision. The screenshot centers the actual popup between equal strips of background from that same document, with no explanatory overlay or change to the runtime UI; all-ON is an example, not fresh-install defaults.

The 82 offline protocol/policy tests and historical network evidence remain distinct from image/packaging checks. Full Chrome restart, actual redirect rejection, native mixed/GIF/quoted-video coverage and other documented cases remain gaps. The conditional BFCache dead-port hypothesis is unchanged and unverified under native BFCache; it is not reported as fixed or as an established severe release blocker.

## Submission sequence — not performed

1. Complete developer-account setup and the remaining final approvals. GitHub source/policy publication is separate from Chrome Web Store publication and was authorized by the repository request.
2. Verify the final ZIP hash, listing, images, public policy/support links and dashboard warnings.
3. With upload authorization, create the store draft and fill Listing, Privacy, Distribution and Test instructions. Choose free/public/all available regions.
4. Obtain explicit **Submit for Review** authorization. Use deferred publishing rather than automatic publication.
5. Obtain explicit publication authorization after approval. A store-assigned extension ID differs from the unpacked ID; runtime code uses `chrome.runtime.id/getURL`, not the development ID. Preferences do not automatically migrate between the two installations.

## Official sources

- [Prepare the extension](https://developer.chrome.com/docs/webstore/prepare)
- [Listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Image requirements](https://developer.chrome.com/docs/webstore/images)
- [Listing quality](https://developer.chrome.com/docs/webstore/best-listing)
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Local data / privacy FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Developer registration](https://developer.chrome.com/docs/webstore/register)
- [Account setup](https://developer.chrome.com/docs/webstore/set-up-account)
- [2-Step Verification](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
- [Trader FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
- [Submission and deferred publishing](https://developer.chrome.com/docs/webstore/publish)
