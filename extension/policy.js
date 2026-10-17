var XMFPolicy = (function () {
  "use strict";

  function normalizeSettings(raw) {
    // Only complete two-filter records are legacy preferences. An invalid C in
    // a newer record defaults independently instead of inheriting A.
    const legacy = typeof raw?.a === "boolean" && typeof raw?.b === "boolean" &&
      !Object.prototype.hasOwnProperty.call(raw, "c");
    return {
      a: typeof raw?.a === "boolean" ? raw.a : false,
      c: typeof raw?.c === "boolean" ? raw.c : legacy ? raw.a : false,
      b: typeof raw?.b === "boolean" ? raw.b : true,
    };
  }

  function parseURL(value) {
    if (typeof value !== "string") return null;
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function statusId(value) {
    const url = parseURL(value);
    return url?.pathname.match(
      /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/,
    )?.[1] ?? null;
  }

  function routeKey(value) {
    const url = parseURL(value);
    if (!url) return null;
    const id = statusId(value);
    return id ? `status:${id}` : url.origin + url.pathname + url.search;
  }

  function authorKey(value) {
    return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
  }

  // Relationship must be established by the adapter, never inferred from author alone.
  function classify({ focusId, focusAuthor, postId, postAuthor, relationship } = {}) {
    if (!focusId) return "A";
    if (postId === focusId || relationship === "independent") return "A";
    if (relationship !== "conversation") return null;
    const focus = authorKey(focusAuthor);
    const author = authorKey(postAuthor);
    return focus && author ? (focus === author ? "C" : "B") : null;
  }

  function blocked(raw, category) {
    const settings = normalizeSettings(raw);
    if (category === "A") return settings.a;
    if (category === "C") return settings.c;
    if (category === "B") return settings.b;
    return settings.a || settings.c || settings.b;
  }

  function mediaURL(value, kind) {
    // Validate the original spelling before URL parsing can erase dot segments,
    // backslashes, default ports, empty credentials, or an empty fragment.
    if (typeof value !== "string" || /[\s\u0000-\u001f\u007f\\#]/.test(value)) return null;
    const match = value.match(/^https:\/\/(pbs\.twimg\.com|video\.twimg\.com)(\/[^?]*)(?:\?[^#]*)?$/i);
    if (!match) return null;
    const host = match[1].toLowerCase();
    const path = match[2];
    let valid = false;
    if (kind === "image" && host === "pbs.twimg.com") {
      valid = /^\/(?:media|tweet_video_thumb|ext_tw_video_thumb|amplify_video_thumb)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.(?:jpg|jpeg|png|webp|gif))?(?::(?:orig|large|medium|small|thumb))?$/.test(path);
    } else if (kind === "video" && host === "video.twimg.com") {
      valid = /^\/(?:tweet_video|ext_tw_video|amplify_video)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.mp4$/.test(path);
    }
    if (!valid) return null;
    const url = parseURL(value);
    return url && !url.username && !url.password && !url.port && !url.hash ? url.href : null;
  }

  function assetKey(value) {
    const image = mediaURL(value, "image");
    if (image) return "pbs.twimg.com" + new URL(image).pathname.replace(/:(?:orig|large|medium|small|thumb)$/, "").replace(/\.(?:jpg|jpeg|png|webp|gif)$/, "");
    const video = mediaURL(value, "video");
    return video ? "video.twimg.com" + new URL(video).pathname : null;
  }

  function sameAsset(a, b) {
    for (const kind of ["image", "video"]) {
      const left = mediaURL(a, kind);
      const right = mediaURL(b, kind);
      if (left && right) {
        // Video resolution is part of its path; never merge different renditions.
        return assetKey(left) === assetKey(right);
      }
    }
    return false;
  }

  function videoMatchesPoster(poster, video, mediaId) {
    const image = mediaURL(poster, "image");
    const source = mediaURL(video, "video");
    if (!image || !source) return false;
    const thumb = new URL(image).pathname.match(/^\/(amplify_video|ext_tw_video)_thumb\/(\d+)\//);
    if (thumb) return new URL(source).pathname.startsWith(`/${thumb[1]}/${thumb[2]}/`) &&
      (mediaId == null || mediaId === thumb[2]);
    const gif = new URL(image).pathname.match(/^\/tweet_video_thumb\/([A-Za-z0-9_-]+)(?:\.[a-z]+)?$/);
    if (gif) return new URL(source).pathname === `/tweet_video/${gif[1]}.mp4`;
    // Custom video covers have no embedded video ID. Bind them to the media
    // entry's explicit ID, never the enclosing tweet ID or an arbitrary variant.
    const videoId = new URL(source).pathname.match(/^\/(?:amplify_video|ext_tw_video)\/(\d+)\//)?.[1];
    return new URL(image).pathname.startsWith("/media/") &&
      typeof mediaId === "string" && /^\d{1,25}$/.test(mediaId) && videoId === mediaId;
  }

  // Return only the selected canonical URL and bitrate, not untrusted extra fields.
  // A missing/invalid bitrate is treated as unknown (0), useful for animated GIFs.
  function chooseVideo(variants, poster, mediaId) {
    if (!Array.isArray(variants)) return null;
    let withinLimit = null;
    let lowest = null;
    for (const variant of variants) {
      if (!variant || variant.content_type !== "video/mp4") continue;
      const url = mediaURL(variant.url, "video");
      if (!url || (poster !== undefined && !videoMatchesPoster(poster, url, mediaId))) continue;
      const bitrate = typeof variant.bitrate === "number" && Number.isFinite(variant.bitrate) && variant.bitrate >= 0
        ? variant.bitrate : 0;
      const candidate = { url, bitrate };
      if (!lowest || bitrate < lowest.bitrate) lowest = candidate;
      if (bitrate <= 2500000 && (!withinLimit || bitrate > withinLimit.bitrate)) withinLimit = candidate;
    }
    return withinLimit || lowest;
  }

  return Object.freeze({ normalizeSettings, routeKey, statusId, classify, blocked, mediaURL, assetKey, sameAsset, videoMatchesPoster, chooseVideo });
})();
if (typeof module === "object" && module.exports) module.exports = XMFPolicy;
