var XMFAdapter = (function () {
  "use strict";
  const policy = typeof XMFPolicy === "object" ? XMFPolicy : require("./policy.js");

  function link(node) {
    if (node?.tagName !== "A") return null;
    try {
      const page = new URL(node.ownerDocument.location.href);
      const url = new URL(node.getAttribute("href"), page);
      if (url.origin !== page.origin || url.username || url.password) return null;
      const id = policy.statusId(url.href);
      if (!id) return null;
      const media = url.pathname.match(/\/(photo|video)\/(\d+)\/?$/);
      const ordinal = media ? Number(media[2]) : null;
      if (media && (!Number.isSafeInteger(ordinal) || ordinal < 1)) return null;
      return { id, ordinal };
    } catch {
      return null;
    }
  }

  function record(posts, id) {
    const value = posts?.get(id);
    return value?.id === id ? value : null;
  }

  function isQuoteBoundary(element) {
    return element.tagName === "ARTICLE" || element.tagName === "BLOCKQUOTE" ||
      (element.tagName !== "A" && element.getAttribute("role") === "link");
  }

  function quoteBoundary(node, article) {
    for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (isQuoteBoundary(parent)) return parent;
    }
    return null;
  }

  function owner(article, posts) {
    if (article?.tagName !== "ARTICLE") return null;
    const candidates = new Set();
    for (const anchor of article.querySelectorAll("a[href]")) {
      const status = link(anchor);
      if (!status || status.ordinal !== null || quoteBoundary(anchor, article) ||
          anchor.querySelector("img, video")) continue;
      candidates.add(status.id);
    }
    const quoted = new Set();
    for (const id of candidates) {
      const quote = record(posts, id)?.quote;
      if (typeof quote === "string" && quote !== id) quoted.add(quote);
    }
    const roots = [...candidates].filter((id) => !quoted.has(id));
    return roots.length === 1 ? roots[0] : null;
  }

  function source(node, name, kind) {
    return policy.mediaURL(node.getAttribute(name), kind);
  }

  function nativeMedia(node) {
    if (node.tagName === "IMG") {
      let poster = source(node, "src", "image");
      if (!poster) {
        for (const candidate of (node.getAttribute("srcset") || "").split(",")) {
          poster = policy.mediaURL(candidate.trim().split(/\s+/)[0], "image");
          if (poster) break;
        }
      }
      return poster ? { poster, video: null } : null;
    }
    const poster = source(node, "poster", "image");
    let video = source(node, "src", "video");
    if (!video) {
      for (const child of node.querySelectorAll("source")) {
        video = source(child, "src", "video");
        if (video) break;
      }
    }
    return poster || video ? { poster, video } : null;
  }

  function same(left, right) {
    return Boolean((left.poster && right.poster && policy.sameAsset(left.poster, right.poster)) ||
      (!left.poster && !right.poster && left.video && right.video && policy.sameAsset(left.video, right.video)));
  }

  function mediaOnly(element, item, linked) {
    if (!["A", "DIV", "SPAN", "FIGURE"].includes(element.tagName) ||
        element.getAttribute("role") === "button" || element.querySelector("button, input, textarea, select, article, blockquote")) return false;
    const natives = [...element.querySelectorAll("img, video")];
    if (!natives.length || natives.some((node) => !same(item, nativeMedia(node) || {}))) return false;
    if ([...element.querySelectorAll("a[href]")].some((anchor) => !link(anchor)?.ordinal)) return false;
    // Status attachment anchors may contain X's native failed-load message.
    if (!linked && element.textContent.trim()) return false;
    return true;
  }

  function nativePlayer(node, item, article, entry) {
    if (node.tagName !== "IMG" || !article || !["video", "animated_gif"].includes(entry?.type)) return null;
    for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (isQuoteBoundary(parent)) break;
      if (![...parent.children].some((child) => child.tagName === "VIDEO")) continue;
      // The nearest direct-video boundary owns the controls, not the surrounding post.
      if (!["DIV", "SPAN", "FIGURE"].includes(parent.tagName) ||
          parent.querySelector("a, article, blockquote, form, input, textarea, select")) return null;
      const videos = [...parent.querySelectorAll("video")];
      if (videos.length !== 1 || [...parent.querySelectorAll("img")].some((image) =>
        !policy.sameAsset(nativeMedia(image)?.poster, item.poster))) return null;
      const native = nativeMedia(videos[0]);
      if ((native?.poster && !policy.sameAsset(native.poster, item.poster)) ||
          (native?.video && !policy.videoMatchesPoster(item.poster, native.video, entry.mediaId))) return null;
      return parent;
    }
    return null;
  }

  function surface(node, item, article, entry) {
    const anchor = node.closest("a[href]");
    const status = link(anchor);
    if (anchor && !status) return null; // External cards and profile links are not attachments.
    const player = nativePlayer(node, item, article, entry);
    if (player) return player;
    if (status?.ordinal && mediaOnly(anchor, item, true)) return anchor;
    for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (isQuoteBoundary(parent)) break;
      if (mediaOnly(parent, item, false)) return parent;
    }
    return null;
  }

  function scan(root, posts) {
    const owners = new Map();
    const getOwner = (article) => {
      if (!owners.has(article)) owners.set(article, owner(article, posts));
      return owners.get(article);
    };
    const nodes = [...root.querySelectorAll("img, video")];
    if (root.matches?.("img, video")) nodes.unshift(root);
    const results = [];
    for (const node of nodes) {
      if (node.closest("xmf-slot")) continue;
      const item = nativeMedia(node);
      if (!item) continue;
      const nearest = node.closest("article");
      let article = nearest;
      while (article?.parentElement?.closest("article")) article = article.parentElement.closest("article");
      const anchor = node.closest("a[href]");
      const status = link(anchor);
      if (!article && !status?.ordinal) continue;
      const enclosing = article ? getOwner(article) : null;
      const local = nearest ? getOwner(nearest) : null;
      const boundary = nearest && quoteBoundary(node, nearest);
      let attachment = status?.ordinal ? status.id : (!boundary ? local : null);
      const enclosingRecord = record(posts, enclosing);
      // An unlinked quote can only be identified by a unique canonical-poster match.
      if (!attachment && boundary && enclosingRecord?.quote) {
        const quoted = record(posts, enclosingRecord.quote);
        if (quoted?.media?.some((entry) => policy.sameAsset(entry?.poster, item.poster))) attachment = quoted.id;
      }
      const metadata = record(posts, attachment);
      const matches = [];
      for (const [index, entry] of (metadata?.media || []).entries()) {
        if (policy.sameAsset(entry?.poster, item.poster)) matches.push({ entry, index });
      }
      const ordinal = status?.ordinal ? status.ordinal - 1 : null;
      const match = ordinal !== null ? matches.find(({ index }) => index === ordinal)
        : matches.length === 1 ? matches[0] : null;
      const element = surface(node, item, nearest, match?.entry);
      if (!element) continue;
      const mediaId = typeof match?.entry.mediaId === "string" && /^\d{1,25}$/.test(match.entry.mediaId)
        ? match.entry.mediaId : null;
      // Metadata may supply a usable source, but cannot erase a native contradiction.
      const nativeValid = !item.video || !item.poster || policy.videoMatchesPoster(item.poster, item.video, mediaId);
      let video = nativeValid ? item.video : null;
      const candidate = policy.mediaURL(match?.entry.video, "video");
      if (candidate && policy.videoMatchesPoster(item.poster, candidate, mediaId)) video = candidate;
      const attachmentKnown = Boolean(attachment && (!metadata || match));
      let known = Boolean(enclosing && attachmentKnown && nativeValid);
      if (known && attachment !== enclosing &&
          (enclosingRecord ? enclosingRecord.quote !== attachment : !boundary && nearest === article)) known = false;
      const thumbnail = item.poster && /^\/(?:tweet_video_thumb|ext_tw_video_thumb|amplify_video_thumb)\//.test(new URL(item.poster).pathname);
      const kind = node.tagName === "VIDEO" || thumbnail || ["video", "animated_gif"].includes(match?.entry.type) ? "video" : "image";
      const descriptor = {
        element, article, postId: known ? enclosing : null,
        attachmentPost: attachmentKnown ? attachment : null,
        mediaIndex: ordinal ?? match?.index ?? null,
        poster: item.poster, video, mediaId, kind,
        width: dimension(node, "width"), height: dimension(node, "height"),
      };
      const duplicate = results.findIndex((entry) => same(entry, descriptor) &&
        (entry.element.contains(element) || element.contains(entry.element)));
      if (duplicate < 0) results.push(descriptor);
      else {
        const previous = results[duplicate];
        const outer = previous.element.contains(element) ? previous.element : element;
        results[duplicate] = { ...(descriptor.kind === "video" ? descriptor : previous), element: outer };
      }
    }
    return results;
  }

  function dimension(node, name) {
    const value = Number(node.getAttribute(name));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  return Object.freeze({ owner, scan });
})();
if (typeof module === "object" && module.exports) module.exports = XMFAdapter;
