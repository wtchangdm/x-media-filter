(() => {
  "use strict";
  const P = XMFPolicy;
  const selector = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="swipe-to-dismiss"]';
  const posts = new Map();
  const items = new Map();
  const manual = new Map();
  const ambiguousIdentities = new Set();
  const articleIds = new WeakMap();
  const pendingIdentities = new Map();
  const dirty = new Set();
  let settings = {a: true, c: true, b: true};
  let route = P.routeKey(location.href);
  let locationURL = location.href;
  let epoch = crypto.randomUUID();
  let focusAuthor = null;
  let contextReady = !P.statusId(location.href);
  let port;
  let scheduled = false;
  let articleSequence = 0;

  function post(msg) {
    try { port?.postMessage(msg); } catch { disconnect(); }
  }
  function disconnect() {
    port = null;
    for (const item of items.values()) reset(item);
  }
  function connect() {
    try {
      port = chrome.runtime.connect({name: "coordinator"});
      const connected = port;
      connected.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port === connected) disconnect();
      });
      connected.onMessage.addListener(msg => { if (port === connected) message(msg); });
      post({type: "context", route, epoch});
    } catch { disconnect(); }
  }
  function context() {
    // X reuses the swipe viewer for avatars/banners, not just post attachments.
    document.documentElement?.toggleAttribute("data-xmf-status", !!P.statusId(location.href));
    const next = P.routeKey(location.href);
    if (next === route) {
      if (locationURL !== location.href) { locationURL = location.href; queue(document); }
      return;
    }
    locationURL = location.href;
    route = next; epoch = crypto.randomUUID(); focusAuthor = null; contextReady = !P.statusId(location.href);
    manual.clear(); ambiguousIdentities.clear();
    for (const item of items.values()) reset(item);
    post({type: "context", route, epoch});
    queue(document);
  }
  function applySettings(next) {
    const previous = settings;
    settings = P.normalizeSettings(next);
    const turnedOn = cat => cat === "A" ? (!previous.a && settings.a) : cat === "C" ? (!previous.c && settings.c) :
      cat === "B" ? (!previous.b && settings.b) :
      (!previous.a && settings.a) || (!previous.c && settings.c) || (!previous.b && settings.b);
    for (const [identity, cat] of manual) if (turnedOn(cat)) manual.delete(identity);
    for (const item of items.values()) if (turnedOn(category(item))) reset(item);
    queue(document);
  }
  function message(msg) {
    context();
    if (msg.type === "settings") {
      applySettings(msg.settings);
    } else if (msg.type === "revoked" && msg.epoch === epoch) {
      const item = [...items.values()].find(value => value.id === msg.id);
      applySettings(msg.settings);
      if (item?.id === msg.id) reset(item);
    } else if (msg.epoch === epoch && (msg.type === "ticket" || msg.type === "denied")) {
      const item = [...items.values()].find(value => value.id === msg.id);
      if (!item || !item.element.isConnected || !item.pending) { post({type: "revoke", id: msg.id}); return; }
      item.pending = false;
      if (msg.type === "denied") { item.button.disabled = false; item.button.textContent = "Unable to load — click to retry"; return; }
      if (!manual.has(item.identity) && P.blocked(settings, category(item))) { reset(item); return; }
      item.workerCategory = category(item);
      post({type: "category", id: item.id, epoch, category: item.workerCategory});
      const frame = document.createElement("iframe");
      frame.title = item.kind === "video" ? "Selected post video" : "Selected post image";
      frame.allow = "fullscreen";
      frame.referrerPolicy = "no-referrer";
      frame.src = chrome.runtime.getURL("player.html") + "#" + msg.token;
      item.shadow.replaceChildren(item.style, frame);
      item.frame = frame;
    }
  }
  function blockedLabel(item) {
    return item.kind === "image" && item.imageCount > 1
      ? `${item.imageCount} images blocked — click to load all images`
      : `${item.kind === "video" ? "Video" : "Image"} blocked — click to load`;
  }
  function activate(item) {
    // Refresh descriptors before grouping so recycled nodes cannot inherit a click.
    context(); dirty.add(document); flush();
    if (items.get(item.element) !== item) return;
    for (const candidate of items.values()) {
      if (candidate === item || (item.kind === "image" && candidate.kind === "image" &&
          candidate.boundaryNonce === item.boundaryNonce && candidate.attachmentPost === item.attachmentPost)) {
        authorize(candidate, true);
      }
    }
  }
  function reset(item) {
    post({type: "revoke", id: item.id});
    item.id = crypto.randomUUID(); item.workerCategory = undefined;
    item.frame?.remove(); item.frame = null; item.pending = false;
    item.button.disabled = false;
    item.button.textContent = blockedLabel(item);
    if (item.shadow.firstElementChild !== item.style || !item.button.isConnected)
      item.shadow.replaceChildren(item.style, item.button);
  }
  function authorize(item, clicked = false) {
    context();
    if (item.pending || item.frame || !item.element.isConnected) return;
    if (!port) connect();
    if (!port) { item.button.textContent = "Extension unavailable — reload this X tab to retry"; return; }
    const src = item.kind === "video" ? item.video : item.poster;
    if (!src) {
      item.button.textContent = "Media source unavailable — waiting for X metadata. Click to retry.";
      return;
    }
    if (clicked) {
      manual.set(item.identity, category(item));
      if (manual.size > 1000) manual.delete(manual.keys().next().value);
    }
    item.workerCategory = category(item);
    item.pending = true; item.button.disabled = true; item.button.textContent = "Loading selected media…";
    post({type: "grant", id: item.id, epoch, url: src, kind: item.kind,
      poster: item.poster, mediaId: item.mediaId, category: category(item), manual: manual.has(item.identity)});
  }
  function outerPost(article) {
    if (!article) return null;
    for (const time of article.querySelectorAll("time")) {
      const link = time.closest("a[href]");
      const id = link && P.statusId(link.href);
      if (id && !link.closest('[role="link"]:not(a)')) {
        const handle = new URL(link.href).pathname.split("/")[1].toLowerCase();
        const authorBlock = article.querySelector('[data-testid="User-Name"]');
        const verified = [...(authorBlock?.querySelectorAll("a[href]") || [])].some(a => {
          try { return new URL(a.href).pathname.toLowerCase() === "/" + handle; } catch { return false; }
        });
        return {id, author: verified ? handle : posts.get(id)?.author || null};
      }
    }
    return null;
  }
  function relationship(id) {
    const focus = P.statusId(location.href);
    const a = posts.get(focus);
    const b = posts.get(id);
    if (a?.conversation && b?.conversation) return a.conversation === b.conversation ? "conversation" : "independent";
    let current = b;
    for (let depth = 0; current && depth < 100; depth++) {
      if (current.parent === focus) return "conversation";
      current = posts.get(current.parent);
    }
    current = a;
    for (let depth = 0; current && depth < 100; depth++) {
      if (current.parent === id) return "conversation";
      current = posts.get(current.parent);
    }
    return null;
  }
  function category(item) {
    const focus = P.statusId(location.href);
    if (focus && !contextReady && item.postId !== focus) return null;
    return P.classify({focusId: focus, focusAuthor, postId: item.postId, postAuthor: item.author,
      relationship: relationship(item.postId)});
  }
  function descriptor(element) {
    if (element.matches('[data-testid="swipe-to-dismiss"]') && !P.statusId(location.href)) return null;
    const article = element.closest('article[data-testid="tweet"]');
    let owner = outerPost(article);
    // Media grids and viewers may not contain an article. Their status link is an item boundary.
    const link = element.closest('a[href*="/status/"]');
    const linkedId = link && P.statusId(link.href);
    if (!owner && linkedId) owner = {id: linkedId, author: posts.get(linkedId)?.author || null};
    if (!owner) {
      const dialog = element.closest('[role="dialog"]');
      const focus = P.statusId(location.href);
      if (dialog && focus) owner = {id: focus, author: posts.get(focus)?.author || focusAuthor};
    }
    if (!owner) return null;
    const possibleQuote = element.closest('[role="link"]:not(a)');
    const quoteScope = possibleQuote?.querySelector('[data-testid="User-Name"]') ? possibleQuote : null;
    const ownerMetadata = posts.get(owner.id);
    const img = element.querySelector("img");
    const domPoster = P.mediaURL(img?.getAttribute("src"), "image") || P.mediaURL(element.querySelector("video")?.poster, "image");
    let attachmentPost = linkedId || (quoteScope && ownerMetadata?.quote) || owner.id;
    // A quoted video may have a play button but no photo/status anchor.
    if (!linkedId && domPoster) {
      if (ownerMetadata?.media.some(entry => P.sameAsset(entry.poster, domPoster))) attachmentPost = owner.id;
      else if (ownerMetadata?.quote && posts.get(ownerMetadata.quote)?.media.some(entry => P.sameAsset(entry.poster, domPoster))) attachmentPost = ownerMetadata.quote;
    }
    const siblings = [...(quoteScope || article || element.closest('[role="dialog"]') || element.parentElement).querySelectorAll(selector)]
      .filter(e => !e.parentElement?.closest(selector));
    const isViewer = element.matches('[data-testid="swipe-to-dismiss"]');
    const linkIndex = (isViewer ? location.pathname : link?.pathname)?.match(/\/(?:photo|video)\/(\d+)/)?.[1];
    const mediaIndex = linkIndex ? Number(linkIndex) - 1 : Math.max(0, siblings.indexOf(element));
    const cached = items.get(element);
    const metadata = posts.get(attachmentPost)?.media || [];
    const poster = domPoster ||
      metadata[mediaIndex]?.poster || (cached?.postId === owner.id && cached.attachmentPost === attachmentPost && cached.mediaIndex === mediaIndex ? cached.poster : null);
    let attachment = metadata.find(entry => P.sameAsset(entry.poster, poster));
    const kind = attachment?.type === "video" || attachment?.type === "animated_gif" || /\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//.test(poster) || element.querySelector('video, [data-testid="playButton"]') ? "video" : "image";
    const mediaId = attachment?.mediaId || null;
    let video = attachment?.video || null;
    if (!video && kind === "video") video = P.mediaURL(element.querySelector("video")?.getAttribute("src"), "video");
    const surface = element.closest('[role="dialog"]') ? "dialog" : element.closest('[data-testid="primaryColumn"]') ? "primary" : "page";
    const region = element.closest('[role="region"]')?.getAttribute("aria-labelledby") || "none";
    const base = [owner.id, surface, region, attachmentPost, mediaIndex, poster ? P.assetKey(poster) : "unresolved"].join("|") +
      (kind === "video" && mediaId ? "|video:" + mediaId : "");
    const boundary = article || link || element.closest('[role="dialog"]') || element;
    const stamp = boundary.getAttribute("aria-labelledby") || boundary.getAttribute("href") || "";
    const cell = boundary.closest('[data-testid="cellInnerDiv"]') || boundary.parentElement;
    let record = articleIds.get(boundary);
    if (!record || record.postId !== owner.id || record.stamp !== stamp || record.cell !== cell) {
      record = {nonce: ++articleSequence, postId: owner.id, stamp, cell, stable: null, requested: false};
      articleIds.set(boundary, record);
    }
    if (metadataPort && !record.requested && pendingIdentities.size < 200) {
      record.requested = true;
      const marker = crypto.randomUUID();
      boundary.setAttribute("data-xmf-identity", marker);
      pendingIdentities.set(marker, {element: boundary, record});
      metadataPort.postMessage({type: "identity", marker, postId: owner.id});
    }
    return {postId: owner.id, author: owner.author, poster, video, mediaId, kind, base,
      occurrence: record.stable || "dom:" + record.nonce, boundaryNonce: record.nonce, attachmentPost, mediaIndex};
  }
  function make(element, desc) {
    const host = document.createElement("xmf-slot");
    const shadow = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = ':host{display:block;width:100%;height:100%;color-scheme:light dark}button{box-sizing:border-box;width:100%;height:100%;min-height:80px;border:0;border-radius:12px;background:#15202b;color:#f5f7f8;font:600 14px/1.5 system-ui;padding:16px;cursor:pointer}button:hover{background:#223746}button:focus-visible{outline:3px solid #60e0a7;outline-offset:-5px}iframe{width:100%;height:100%;border:0;border-radius:12px;display:block}';
    const button = document.createElement("button");
    button.type = "button";
    const item = {...desc, id: crypto.randomUUID(), identity: desc.base + "|" + desc.occurrence, element, host, shadow, style, button, frame: null, pending: false};
    host.addEventListener("click", event => event.stopPropagation());
    button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      if (event.isTrusted) activate(item);
    });
    for (const type of ["pointerdown", "keydown"]) host.addEventListener(type, event => event.stopPropagation());
    if (getComputedStyle(element).position === "static") element.style.position = "relative";
    element.setAttribute("data-xmf-covered", "");
    shadow.append(style, button); element.append(host); items.set(element, item);
    reset(item);
    return item;
  }
  function scan(root) {
    const elements = [];
    if (root.matches?.(selector)) elements.push(root);
    elements.push(...root.querySelectorAll(selector));
    for (const element of elements) {
      // tweetPhoto can wrap a videoPlayer: one UI and grant for that attachment.
      if (element.parentElement?.closest(selector)) continue;
      const desc = descriptor(element);
      let item = items.get(element);
      if (!desc) {
        if (item) { reset(item); item.host.remove(); element.removeAttribute("data-xmf-covered"); items.delete(element); }
        continue;
      }
      if (item && (item.base !== desc.base || item.kind !== desc.kind || item.boundaryNonce !== desc.boundaryNonce)) {
        reset(item); item.host.remove(); items.delete(element); item = null;
      }
      if (!item) item = make(element, desc);
      else {
        Object.assign(item, desc);
        if (!item.host.isConnected) element.append(item.host);
      }
      if (item.postId === P.statusId(location.href)) {
        contextReady = true;
        if (item.author && focusAuthor !== item.author) { focusAuthor = item.author; queue(document); }
      }
      for (const video of element.querySelectorAll("video")) {
        video.pause(); video.removeAttribute("autoplay");
        if (video.hasAttribute("src")) { video.removeAttribute("src"); video.load(); }
      }
    }
  }
  function queue(root) {
    dirty.add(root);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }
  function flush() {
    scheduled = false; context();
    const roots = dirty.has(document) ? [document] : [...dirty]; dirty.clear();
    // Resolve a text-only focused post as well as one with attachments.
    if ((!focusAuthor || !contextReady) && P.statusId(location.href)) {
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        const owner = outerPost(article);
        if (owner?.id === P.statusId(location.href)) { contextReady = true; focusAuthor = owner.author; break; }
      }
      focusAuthor ||= posts.get(P.statusId(location.href))?.author || null;
    }
    for (const root of roots) if (root && (root === document || root.isConnected)) scan(root);
    const identities = new Map();
    const imageGroups = new Map();
    for (const [element, item] of items) {
      if (!element.isConnected) { reset(item); element.removeAttribute("data-xmf-covered"); items.delete(element); continue; }
      if (item.kind === "image") {
        const key = item.boundaryNonce + "|" + item.attachmentPost;
        if (!imageGroups.has(key)) imageGroups.set(key, []);
        imageGroups.get(key).push(item);
      }
      const identity = item.base + "|" + item.occurrence;
      if (!identities.has(identity)) identities.set(identity, []);
      identities.get(identity).push(item);
    }
    for (const group of imageGroups.values()) for (const item of group) {
      item.imageCount = group.length;
      if (!item.pending && !item.frame && item.button.textContent.includes(" blocked — "))
        item.button.textContent = blockedLabel(item);
    }
    for (const [proposed, group] of identities) {
      if (group.length > 1) { ambiguousIdentities.add(proposed); manual.delete(proposed); }
      const ambiguous = ambiguousIdentities.has(proposed);
      for (const item of group) {
        const identity = ambiguous ? item.base + "|dom:" + item.boundaryNonce : proposed;
        // Upgrade this existing DOM occurrence only; never merge two occurrences by URL.
        if (!ambiguous && item.identity !== identity && manual.has(item.identity)) {
          manual.set(identity, manual.get(item.identity)); manual.delete(item.identity);
        }
        item.identity = identity;
        const cat = category(item);
        item.host.dataset.category = cat || "unknown";
        item.host.dataset.identity = item.occurrence.startsWith("react:") && !ambiguous ? "stable" : "document";
        item.host.dataset.ready = String(!!(item.kind === "video" ? item.video : item.poster));
        if (manual.has(identity)) manual.set(identity, cat);
        if ((item.frame || item.pending) && item.workerCategory !== cat) {
          item.workerCategory = cat; post({type: "category", id: item.id, epoch, category: cat});
        }
        if (!manual.has(identity) && P.blocked(settings, cat) && (item.frame || item.pending)) reset(item);
        if ((manual.has(identity) || !P.blocked(settings, cat)) && visible(item.element)) authorize(item);
      }
    }
    for (const [marker, entry] of pendingIdentities) if (!entry.element.isConnected) pendingIdentities.delete(marker);
    if (ambiguousIdentities.size > 2000) { manual.clear(); ambiguousIdentities.clear(); }
  }
  function visible(element) {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.top < innerHeight + 300 && box.bottom > -300;
  }
  let metadataPort;
  const bridgeNonce = crypto.randomUUID();
  addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window || event.origin !== location.origin || event.data?.channel !== "xmf-channel-v1" || event.ports.length !== 1) return;
    event.stopImmediatePropagation();
    if (metadataPort || event.data.nonce !== bridgeNonce) { event.ports[0].close(); return; }
    metadataPort = event.ports[0];
    metadataPort.onmessage = event => {
      const data = event.data;
      if (data?.type === "identity") {
        const entry = pendingIdentities.get(data.marker);
        pendingIdentities.delete(data.marker);
        if (!entry || !entry.element.isConnected || articleIds.get(entry.element) !== entry.record) return;
        if (Array.isArray(data.keys) && data.keys.length <= 16 && data.keys.every(key => typeof key === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(key)) &&
            data.keys.some(key => key.split(/[^0-9]+/).includes(entry.record.postId))) entry.record.stable = "react:" + data.keys.join("/");
        queue(entry.element);
      } else observeMetadata(data);
    };
    queue(document);
  });
  function readyBridge(attempt = 0) {
    if (metadataPort) return;
    dispatchEvent(new CustomEvent("xmf-ready-v1", {detail: bridgeNonce}));
    if (attempt < 5) setTimeout(() => readyBridge(attempt + 1), 50 * (attempt + 1));
  }
  readyBridge();
  function observeMetadata(data) {
    if (!Array.isArray(data?.posts)) return;
    for (const raw of data.posts.slice(0, 500)) {
      if (!raw || !/^\d{1,25}$/.test(raw.id) || !Array.isArray(raw.media)) continue;
      const media = [];
      for (const entry of raw.media.slice(0, 16)) {
        const poster = P.mediaURL(entry?.poster, "image");
        const mediaId = typeof entry?.mediaId === "string" && /^\d{1,25}$/.test(entry.mediaId) ? entry.mediaId : null;
        if (poster) media.push({poster, mediaId, video: P.chooseVideo(entry.variants, poster, mediaId)?.url || null,
          type: ["photo", "video", "animated_gif"].includes(entry.type) ? entry.type : "photo"});
      }
      posts.delete(raw.id);
      posts.set(raw.id, {id: raw.id, author: typeof raw.author === "string" && /^[A-Za-z0-9_]{1,15}$/.test(raw.author) ? raw.author.toLowerCase() : null,
        conversation: /^\d{1,25}$/.test(raw.conversation) ? raw.conversation : null,
        parent: /^\d{1,25}$/.test(raw.parent) ? raw.parent : null,
        quote: /^\d{1,25}$/.test(raw.quote) ? raw.quote : null, media});
    }
    while (posts.size > 2000) posts.delete(posts.keys().next().value);
    queue(document);
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== "xmf-context") return;
    context();
    if (msg.route === route && msg.epoch === epoch) respond({route, epoch});
  });
  const observer = new MutationObserver(records => {
    context();
    for (const record of records) {
      const root = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (root?.closest("xmf-slot")) continue;
      const article = root?.closest('article[data-testid="tweet"]');
      if (article) queue(article);
      else if (root) queue(root);
    }
  });
  observer.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ["src", "poster", "href", "data-testid", "aria-labelledby"]});
  navigation?.addEventListener("currententrychange", context);
  addEventListener("popstate", context);
  addEventListener("scroll", () => queue(null), {passive: true});
  addEventListener("pagehide", () => {
    manual.clear(); ambiguousIdentities.clear(); epoch = crypto.randomUUID();
    for (const item of items.values()) reset(item);
    port?.disconnect();
  });
  addEventListener("pageshow", () => { context(); if (!port) connect(); queue(document); });
  setInterval(() => {
    context();
    if (!port) connect();
    post({type: "alive"});
  }, 20000);
  context(); connect(); queue(document);
})();
