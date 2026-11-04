# Supplied artwork

The supplied illustrations and icon were generated with ChatGPT. Browser captures are documented separately.

| Source | Dimensions |
| --- | --- |
| [icon-source.png](icon-source.png) | 1254 × 1254 |
| [store/marquee-media-filter.png](store/marquee-media-filter.png) | 1983 × 793 |
| [store/marquee-grumpy-cat.png](store/marquee-grumpy-cat.png) | 1254 × 1254 |

`extension/icons/` contains 16, 32, 48 and 128 px PNG derivatives of the icon source.

## Store images: crop/resize only

Illustrated promotional files are **direct crops/resizes of supplied artwork**. Screenshots preserve captured UI with matching document-background margins; no artwork, text or UI is added. Source artwork remains outside the runtime package.

| Output | Source and operation |
| --- | --- |
| [440×280 small promo](store/exports/small-promo-440x280.png) | Square cat image: crop **1254×798 at x=0, y=120**, then resize to 440×280. The 11:7 crop trims the scene above/below, preserving the face; no stretching or added content. |
| [1400×560 marquee](store/exports/marquee-media-filter-1400x560.png) | Supplied wide illustration: crop **1980×792 at x=1, y=0**, removing only three columns/one row overall, then resize to 1400×560. No stretching or new graphics. |
| [640×400 focused-post screenshot](store/exports/screenshot-openai-post-640x400.png) | Complete OpenAIDevs focused article captured from X. Fit to 344×400 and center with 148 px black margins on each side. No added text, stretched UI or clipped post content. This is a screenshot, not a marquee export. |
| [1280×800 settings screenshot](store/exports/screenshot-settings-1280x800.png) | From the actual 1472×920 document crop: keep the 720×920 popup intact, place 376-pixel strips of the existing blank document area on each side, then resize to 1280×800. The panel is horizontally centered, with no overlay, invented UI or newly generated background. |

The store icon is the unchanged [128×128 runtime icon](../extension/icons/icon-128.png), already in the ZIP. The wide illustration is a **promo**, not an actual filtering screenshot. The screenshot shows saved all-ON settings; fresh defaults remain post OFF / author replies OFF / other comments ON.

Reproduce the store exports with `sh scripts/store-assets.sh` using an already-installed `ffmpeg`. It crops/resizes illustrations, centers the settings screenshot and fits the focused-post capture with matching black side margins; it is not an extension build/runtime requirement.

## Actual screenshot provenance

[store/captures/popup-0.1.0.png](store/captures/popup-0.1.0.png) is a **1472×920 top-left crop** of a 2× viewport screenshot of extension 0.1.0, opened as an extension page rather than a native toolbar popup. All three saved filters are ON.

The panel is 360×460 CSS pixels (720×920 capture pixels). The blank area on its right belongs to the same extension document; the export redistributes it equally to center the panel. Only extension-document pixels are retained, without browser chrome or account data. Screenshots demonstrate appearance, not network blocking.

## OpenAIDevs focused-post screenshot

Source route: https://x.com/OpenAIDevs/status/2111211411766399288.

[store/captures/openai-focused-post.png](store/captures/openai-focused-post.png) retains the complete **1078×1252** focused article, cropped at x=870, y=77 from the temporary 3024×1350 viewport capture. The public author, post text, blocked video and post controls remain intact. Account controls, sidebars, reply content and authenticated API data are excluded. The original full viewport is not included.

The final export fits the post at 344×400 with 148 px black side margins to meet **640×400**, without clipping or added text. Upload it in the store's Screenshots slot, not the optional 1400×560 marquee slot. This is visual provenance only, not network-blocking evidence.

## Review status

ChatGPT provenance is not legal clearance against third-party rights. Final crop approval and store acceptance are pending. See the [release checklist](../docs/store/README.md).
