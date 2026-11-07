# Supplied artwork

The [icon source](icon-source.png), [wide illustration](store/marquee-media-filter.png) and [square cat illustration](store/marquee-grumpy-cat.png) were generated with ChatGPT. Runtime icons in `extension/icons/` derive from the icon source. Keep source artwork unchanged and outside the runtime package.

## Store exports

Illustrated promos are direct crops/resizes of supplied artwork, not screenshots. Screenshots preserve captured UI with matching document-background margins; no text, artwork or invented UI is added.

| Upload slot | File |
| --- | --- |
| Required icon | [128×128 runtime icon](../extension/icons/icon-128.png) |
| Required small promo | [440×280 square-cat crop](store/exports/small-promo-440x280.png) |
| Screenshot | [1280×800 settings UI](store/exports/screenshot-settings-1280x800.png) |
| Additional screenshot | [640×400 focused post](store/exports/screenshot-openai-post-640x400.png) |
| Optional marquee | [1400×560 wide illustration](store/exports/marquee-media-filter-1400x560.png) |

Reproduce exports with `sh scripts/store-assets.sh` using an already-installed `ffmpeg`; the script defines crop/resize coordinates. Pre-generated PNGs are available, so this is not an extension build requirement. The focused-post image belongs in Screenshots, not Marquee.

## Screenshot provenance

The [settings capture](store/captures/popup-0.1.0.png) is a top-left crop of a 2× viewport screenshot, opened as an extension page rather than a native toolbar popup. All three saved filters are ON, not the fresh defaults. The export keeps the panel intact and redistributes blank pixels from the same document to center it. Only extension-document pixels remain, without browser chrome or account data; recheck its appearance against the intended release before upload.

The [focused-post capture](store/captures/openai-focused-post.png) retains the complete article from https://x.com/OpenAIDevs/status/2111211411766399288: public author, post text, blocked video and controls. Account controls, sidebars, replies and authenticated API data are excluded; the original full viewport is not included. The export fits the complete post with matching black margins, without clipping or added text.

Screenshots establish visual provenance, not network blocking. ChatGPT provenance is not legal clearance against third-party rights. Final crop approval and store acceptance remain pending; see the [release gates](../docs/store/README.md#release-gates).
