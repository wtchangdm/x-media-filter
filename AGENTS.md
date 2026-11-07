# X Media Filter

Native Chrome MV3 extension in `extension/`. No dependency installation or build step. Prefer native APIs; add dependencies or infrastructure only for an identified requirement.

## Read only what the task needs

| Task | Source |
| --- | --- |
| User copy, installation or support | [README.md](README.md), [SUPPORT.md](SUPPORT.md), [PRIVACY.md](PRIVACY.md). Keep README user-facing and all project copy English. |
| Product behavior or policy changes | [specs.md §§1–5](specs.md#1-goal-and-confirmed-requirements); acceptance cases in §8. Distinguish confirmed requirements, defaults and unverified designs. |
| Network, loader, classification or lifecycle changes | [specs.md §§7–10](specs.md#7-chrome-constraints-and-design-direction). Preserve the blocking/loading proof and relevant acceptance gates. |
| Development commands or browser work | [docs/development.md](docs/development.md); use its browser procedure before live testing. |
| Measured coverage, failures or claims | [docs/validation.md](docs/validation.md). Untested surfaces are not proven capabilities. |
| Store preparation or artwork | [docs/store/README.md](docs/store/README.md), [assets/README.md](assets/README.md). Preparation does not authorize store submission/publication. |

Keep behavior changes aligned with the relevant specification/tests/docs. Put workflows in the development guide, product semantics in the specification and coverage/limits in validation docs; link rather than duplicate them here or in README. Keep public documentation focused on current behavior and actionable limits, not dated validation diaries, test-machine browser versions or per-run reports. Keep detailed evidence local; retain compatibility requirements and policy effective dates where necessary.

## Correctness boundaries

- Filtering prevents unauthorized downloads, not merely hides content. CSS/DOM callbacks and post-load URL removal are not network barriers. Never replace per-occurrence grants with broad URL/CDN/tab allows.
- Video can use XHR playlists and segments behind `blob:` URLs; blocking only image/media request types is insufficient.
- Resolve focus from the current status ID, not article position, URL handle alone or quoted author. Unknown classification must not authorize potentially filtered media.
- Treat page messages as untrusted. Validate privileged-loader sender, current document/route, grant and destination; never expose an arbitrary-URL proxy.

## Verification

Runtime changes: `node --test tests/*.test.cjs` and `node tests/check.mjs` (Node.js 22+). Documentation-only changes need consistency/link checks, not a new application suite.

Media/network changes also require visible-placeholder and network evidence in the dedicated isolated Chrome/profile, including affected startup, SPA, duplicate-asset and video-segment cases. DOM/mocks and zero Resource Timing sizes alone do not prove zero downloads. Report routes/settings and material gaps to the user; keep exact browser versions and per-run details in local evidence. Browser safety and capture handling are in the development guide.
