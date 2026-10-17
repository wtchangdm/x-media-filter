# Supplied artwork

The user confirmed that **the original illustrations and icon below were generated with ChatGPT**. Actual browser captures are documented separately. The Downloads originals are untouched. These source copies were previously verified byte-identical with `cmp`:

| Local copy | Supplied filename | Dimensions |
| --- | --- | --- |
| [icon-source.png](icon-source.png) | `Grumpy Cat Rubbing Its Eye.png` | 1254 × 1254 |
| [store/marquee-media-filter.png](store/marquee-media-filter.png) | `ChatGPT Image Oct 17, 2026, 11_42_16 AM-2.png` | 1983 × 793 |
| [store/marquee-grumpy-cat.png](store/marquee-grumpy-cat.png) | `ChatGPT Image Oct 17, 2026, 11_47_24 AM.png` | 1254 × 1254 |

`extension/icons/` contains 16, 32, 48 and 128 px PNG derivatives of the icon source, originally generated locally using macOS `sips`. The previous `thumbnail.png` is superseded and was not used.

## Store images: crop/resize only

At the user's request, the custom promotional layouts, added text/graphics and Swift exporter were removed. Illustrated promotional files are **direct crops/resizes of existing artwork**. The additional 640×400 screenshot uses a complete focused post captured from X, fitted intact with matching black side margins. The screenshot centers the intact actual UI between equal strips of its existing document background, as subsequently requested; no new artwork or UI is drawn. Supplied originals remain unchanged and outside the runtime package.

| Output | Source and operation |
| --- | --- |
| [440×280 small promo](store/exports/small-promo-440x280.png) | Square cat image: crop **1254×798 at x=0, y=120**, then resize to 440×280. The 11:7 crop trims the scene above/below, preserving the face; no stretching or added content. |
| [1400×560 marquee](store/exports/marquee-media-filter-1400x560.png) | Supplied wide illustration: crop **1980×792 at x=1, y=0**, removing only three columns/one row overall, then resize to 1400×560. No stretching or new graphics. |
| [640×400 focused-post screenshot](store/exports/screenshot-openai-post-640x400.png) | Complete OpenAIDevs focused article captured in existing Chrome. Fit to 344×400 and center with 148 px black margins on each side. No added text, stretched UI or clipped post content. This is a screenshot, not a marquee export. |
| [1280×800 settings screenshot](store/exports/screenshot-settings-1280x800.png) | From the actual 1472×920 document crop: keep the 720×920 popup intact, place 376-pixel strips of the existing blank document area on each side, then resize to 1280×800. The panel is horizontally centered, with no overlay, invented UI or newly generated background. |

The store icon is the unchanged [128×128 runtime icon](../extension/icons/icon-128.png), already in the ZIP. The wide illustration is a **promo**, not an actual filtering screenshot. The screenshot shows saved all-ON settings; fresh defaults remain post OFF / author replies OFF / other comments ON.

Reproduce the store exports with `sh scripts/store-assets.sh` using an already-installed `ffmpeg`. It crops/resizes illustrations, centers the settings screenshot and fits the focused-post capture with matching black side margins; it is not an extension build/runtime requirement. Do not silently restore the removed custom compositions or crop another asset instead.

## Actual screenshot provenance

[store/captures/popup-0.1.0.png](store/captures/popup-0.1.0.png) is now the **1472×920 top-left crop** of the original actual 2× viewport screenshot from 2026-10-17. That capture was taken in the user's existing **Chrome 155.0.8059.85**, using the named/pinned `agent-browser` session `xmf-store`, with extension 0.1.0 opened as an extension page rather than a native toolbar popup. All three saved filters were ON; no settings were changed.

The full popup is 360×460 CSS pixels (720×920 capture pixels). In this unchanged source capture, the additional area on the right is the same actual extension document. Only the exported screenshot redistributes that blank area equally to the left and right to center the panel. The 1472×920 crop has an 8:5 ratio for the store screenshot. It was recovered from the existing temporary viewport PNG with `ffmpeg -vf crop=1472:920:0:0`; no new browser session was needed for this revision. The earlier 720×920 tight crop was replaced.

Only extension-document pixels are retained: no browser chrome, X account/post content, unrelated tabs, authenticated API data or CDP URL. The temporary original full viewport is not included in the project. This screenshot is not new network-blocking evidence. Future updates should recapture the actual popup rather than fabricate controls.

## OpenAIDevs focused-post screenshot

Source route: https://x.com/OpenAIDevs/status/2111211411766399288, explicitly supplied by the user. Captured on 2026-10-17 in the user's existing Chrome through named/pinned `agent-browser` session `xmf-marquee`. A newly created test tab was used; no media was activated and no preferences were changed.

[store/captures/openai-focused-post.png](store/captures/openai-focused-post.png) retains the complete **1078×1252** focused article, cropped at x=870, y=77 from the temporary 3024×1350 viewport capture. The public author, supplied post text, blocked video and post controls remain intact, as requested. Account controls, sidebars, reply content and authenticated API data are excluded. The original full viewport is not included.

The final export fits the post at 344×400 with 148 px black side margins to meet **640×400**, without clipping or added text. Upload it in the store's Screenshots slot. A marquee still requires 1400×560 and is optional; the earlier illustration remains available. Rejected portrait/placeholder-only and wide-post drafts were not retained. This is visual provenance only: full browser version/filter settings were not recorded for this capture, and it is not new network/download-prevention evidence.

## Review status

ChatGPT provenance is recorded; it is not a blanket legal guarantee against third-party rights. No external artwork source or license requirement has been identified from the supplied files, and no additional source details are requested. Final crop approval and store acceptance are still pending. See the [release checklist](../docs/store/README.md).
