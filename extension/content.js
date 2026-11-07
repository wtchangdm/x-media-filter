(() => {
  "use strict";
  const P = XMFPolicy;
  const posts = new Map();
  const items = new Map();
  const boundaries = new WeakMap();
  const dirty = new Set();
  let settings = {a: true, c: true, b: true};
  let route = P.routeKey(location.href);
  let locationURL = location.href;
  let epoch = crypto.randomUUID();
  let port;
  let metadataPort;
  let scheduled = false;
  let sequence = 0;
  let viewerSurface = null;
  let dismissedViewerURL = null;

  function post(message) {
    try { port?.postMessage(message); } catch { disconnect(); }
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
  function relationship(id, focus) {
    const a = posts.get(focus), b = posts.get(id);
    if (a?.conversation && b?.conversation) return a.conversation === b.conversation ? "conversation" : "independent";
    for (const [start, destination] of [[b, focus], [a, id]]) {
      let current = start;
      for (let depth = 0; current && depth < 100; depth++) {
        if (current.parent === destination) return "conversation";
        current = posts.get(current.parent);
      }
    }
    return null;
  }
  function category(item) {
    const focus = P.statusId(location.href);
    return P.classify({focusId: focus, focusAuthor: posts.get(focus)?.author,
      postId: item.postId, postAuthor: posts.get(item.postId)?.author,
      relationship: relationship(item.postId, focus)});
  }
  function context() {
    const next = P.routeKey(location.href);
    document.documentElement?.toggleAttribute("data-xmf-status", !!P.statusId(location.href));
    if (locationURL !== location.href) {
      closeViewer(false);
      dismissedViewerURL = null;
      locationURL = location.href;
      queue(document);
    }
    if (next === route) return;
    route = next; epoch = crypto.randomUUID();
    for (const item of items.values()) { item.manual = false; reset(item); }
    post({type: "context", route, epoch});
  }
  function applySettings(next) {
    const previous = settings;
    settings = P.normalizeSettings(next);
    const enabled = ["A", "C", "B"].filter(cat => !P.blocked(previous, cat) && P.blocked(settings, cat));
    const turnedOn = cat => cat === null ? enabled.length > 0 : enabled.includes(cat);
    if (viewerSurface && turnedOn(category(viewerSurface))) viewerSurface.allowed.clear();
    for (const item of items.values()) if (turnedOn(category(item))) {
      item.manual = false; reset(item);
    }
    queue(document);
  }
  function message(msg) {
    context();
    if (msg.type === "settings") { applySettings(msg.settings); return; }
    if (msg.epoch !== epoch || !["revoked", "ticket", "denied"].includes(msg.type)) return;
    const item = [...items.values()].find(item => item.id === msg.id);
    if (msg.type === "revoked") {
      applySettings(msg.settings);
      if (item?.id === msg.id) reset(item);
      return;
    }
    if (!item || !item.element.isConnected || !item.pending) { post({type: "revoke", id: msg.id}); return; }
    item.pending = false;
    if (msg.type === "denied") { item.button.disabled = false; item.button.textContent = "Unable to load — click to retry"; return; }
    item.workerCategory = category(item);
    if (!item.manual && P.blocked(settings, item.workerCategory)) { reset(item); return; }
    post({type: "category", id: item.id, epoch, category: item.workerCategory});
    const frame = document.createElement("iframe");
    frame.title = item.kind === "video" ? "Selected post video" : "Selected post image";
    frame.allow = "fullscreen"; frame.referrerPolicy = "no-referrer";
    frame.src = chrome.runtime.getURL("player.html") + "#" + msg.token;
    item.shadow.replaceChildren(item.style, frame);
    item.frame = frame;
  }
  function blockedLabel(item) {
    return item.kind === "image" && item.imageCount > 1 ? `${item.imageCount} images blocked — click to load all images`
      : `${item.kind === "video" ? "Video" : "Image"} blocked — click to load`;
  }
  function reset(item) {
    post({type: "revoke", id: item.id});
    item.id = crypto.randomUUID(); item.workerCategory = undefined;
    item.frame = null; item.pending = false; item.imageReady = false;
    item.button.disabled = false; item.button.textContent = blockedLabel(item);
    item.shadow.replaceChildren(item.style, item.button);
  }
  function dispose(item) {
    post({type: "revoke", id: item.id});
    item.frame?.remove(); item.manual = false; item.pending = false; item.frame = null;
    item.host.remove(); items.delete(item.element);
    if (!item.isViewer) {
      item.element.removeAttribute("data-xmf-covered");
      for (const [name, saved] of Object.entries(item.presentation)) {
        if (item.element.style[name] === saved.applied) item.element.style[name] = saved.original;
      }
    }
  }
  function mediaSource(item) {
    if (item.kind === "image") return item.poster;
    return P.videoMatchesPoster(item.poster, item.video, item.mediaId) ? item.video : null;
  }
  function authorize(item, clicked = false) {
    context();
    if (items.get(item.element) !== item || item.pending || item.frame || !item.element.isConnected) return;
    const cat = category(item);
    if (!clicked && !item.manual && P.blocked(settings, cat)) return;
    const src = mediaSource(item);
    if (!src) {
      item.button.textContent = "Media source unavailable — waiting for X metadata. Click to retry.";
      return;
    }
    if (clicked) item.manual = true;
    if (item.isViewer && item.element !== viewerSurface?.ui.stage) return;
    if (!port) connect();
    if (!port) { item.button.textContent = "Extension unavailable — reload this X tab to retry"; return; }
    item.workerCategory = cat;
    item.pending = true; item.button.disabled = true; item.button.textContent = "Loading selected media…";
    post({type: "grant", id: item.id, epoch, url: src, kind: item.kind, poster: item.poster,
      mediaId: item.mediaId, category: cat, manual: item.manual});
  }
  function imageKey(item) { return item.mediaIndex + "|" + P.assetKey(item.poster); }
  function activate(item) {
    dirty.add(document); flush();
    if (items.get(item.element) !== item) return;
    if (item.isViewer) {
      for (const entry of viewerSurface.entries) if (entry.poster) viewerSurface.allowed.add(imageKey(entry));
      authorize(item, true);
      return;
    }
    for (const candidate of items.values()) {
      if (candidate === item || (item.kind === "image" && candidate.kind === "image" && !candidate.isViewer &&
          candidate.group === item.group)) authorize(candidate, true);
    }
  }
  function make(element, desc) {
    const host = document.createElement("xmf-slot"), shadow = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = ':host{display:block;width:100%;height:100%;color-scheme:dark}button{box-sizing:border-box;width:100%;height:100%;min-height:80px;border:0;border-radius:12px;background:#15202b;color:#f5f7f8;font:600 14px/1.5 system-ui;padding:16px;cursor:pointer}button:hover{background:#223746}button:focus-visible{outline:3px solid #60e0a7;outline-offset:-5px}iframe{width:100%;height:100%;border:0;border-radius:12px;display:block}';
    const button = document.createElement("button"); button.type = "button";
    const item = {...desc, element, host, shadow, style, button, id: crypto.randomUUID(),
      manual: false, frame: null, pending: false, imageReady: false, presentation: {}};
    button.textContent = blockedLabel(item);
    button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      if (event.isTrusted) activate(item);
    });
    for (const type of ["click", "pointerdown", "mousedown", "keydown"]) host.addEventListener(type, event => {
      if (!item.imageReady) event.stopPropagation();
    });
    if (!item.isViewer) {
      const set = (name, value) => {
        item.presentation[name] = {original: element.style[name], applied: value}; element.style[name] = value;
      };
      if (getComputedStyle(element).position === "static") set("position", "relative");
      if (element.getBoundingClientRect().height < 80) {
        set("display", "block");
        const width = element.getBoundingClientRect().width;
        const height = desc.width && desc.height ? width * desc.height / desc.width : 160;
        set("minHeight", Math.max(80, Math.min(height, innerHeight * .8)) + "px");
      }
      element.setAttribute("data-xmf-covered", "");
    }
    shadow.append(style, button); element.append(host); items.set(element, item);
    return item;
  }
  function descriptor(desc) {
    const {attachmentPost} = desc;
    const boundary = desc.article || desc.element;
    let record = boundaries.get(boundary);
    if (!record || record.postId !== desc.postId) {
      record = {postId: desc.postId, nonce: ++sequence}; boundaries.set(boundary, record);
    }
    return {...desc, group: attachmentPost ? record.nonce + "|" + attachmentPost : desc.element,
      base: [desc.postId, attachmentPost, desc.mediaIndex, P.assetKey(desc.poster), P.assetKey(desc.video), desc.kind, desc.mediaId, record.nonce].join("|")};
  }
  function updateItem(element, desc) {
    let item = items.get(element);
    if (item && item.base !== desc.base) { dispose(item); item = null; }
    if (!item) return make(element, desc);
    Object.assign(item, desc);
    if (!item.host.isConnected) element.append(item.host);
    return item;
  }
  function scan(root) {
    const found = new Set();
    for (const raw of XMFAdapter.scan(root, posts)) {
      const desc = descriptor(raw), element = desc.element;
      found.add(element);
      updateItem(element, desc);
      for (const video of element.querySelectorAll("video")) { video.pause(); video.removeAttribute("autoplay"); }
    }
    for (const item of items.values()) {
      if (!item.isViewer && (root === document || root === item.element || root.contains?.(item.element)) && !found.has(item.element)) dispose(item);
    }
  }
  function galleryEntries(postId, fallback = []) {
    const metadata = posts.get(postId)?.media;
    return metadata ? metadata.flatMap((entry, mediaIndex) => entry.type === "photo" && entry.poster
      ? [{poster: entry.poster, mediaIndex}] : []) : fallback;
  }
  function openViewer(source, selectedIndex, direct = false, opener = null) {
    closeViewer(false);
    const fallback = source.fallback || [];
    const entries = galleryEntries(source.attachmentPost, fallback);
    let index = entries.findIndex(entry => entry.mediaIndex === selectedIndex);
    if (index < 0) { entries.splice(0, entries.length, {poster: null, mediaIndex: selectedIndex}); index = 0; }
    const surface = {...source, direct, fallback, entries, index, allowed: new Set(), nonce: ++sequence};
    surface.ui = XMFViewer.create({opener, onSelect: selectViewer, onClose: () => closeViewer(true)});
    viewerSurface = surface;
    if (source.inheritManual) for (const entry of entries) if (entry.poster) surface.allowed.add(imageKey(entry));
    syncViewer(); queue(null);
  }
  function selectViewer(index) {
    if (!viewerSurface || !Number.isInteger(index) || index < 0 || index >= viewerSurface.entries.length) return;
    viewerSurface.index = index; syncViewer(); queue(null);
  }
  function closeViewer(restoreFocus = true) {
    const surface = viewerSurface;
    if (!surface) return;
    viewerSurface = null;
    const item = items.get(surface.ui.stage);
    if (item) dispose(item);
    surface.ui.destroy({restoreFocus});
    queue(null);
    if (surface.direct) {
      dismissedViewerURL = location.href;
      if (restoreFocus) location.replace(location.href.replace(/\/photo\/\d+\/?(?=[?#]|$)/, ""));
    }
  }
  function syncViewer() {
    const directIndex = location.pathname.match(/\/photo\/(\d+)\/?$/)?.[1];
    if (!viewerSurface && directIndex && dismissedViewerURL !== location.href && document.documentElement) {
      const id = P.statusId(location.href);
      if (id) openViewer({postId: id, attachmentPost: id}, Number(directIndex) - 1, true);
      return;
    }
    const surface = viewerSurface;
    if (!surface) return;
    const selected = surface.entries[surface.index];
    const fresh = galleryEntries(surface.attachmentPost, surface.fallback);
    const index = fresh.findIndex(entry => entry.mediaIndex === selected.mediaIndex);
    if (index >= 0) { surface.entries = fresh; surface.index = index; }
    else surface.entries[surface.index] = {poster: null, mediaIndex: selected.mediaIndex};
    const entry = surface.entries[surface.index];
    const desc = {isViewer: true, postId: surface.postId, attachmentPost: surface.attachmentPost,
      poster: entry.poster, mediaIndex: entry.mediaIndex, video: null, mediaId: null, kind: "image",
      imageCount: surface.entries.length,
      base: [surface.nonce, entry.mediaIndex, P.assetKey(entry.poster)].join("|")};
    const item = updateItem(surface.ui.stage, desc);
    if (surface.allowed.has(imageKey(entry))) item.manual = true;
    surface.ui.update({index: surface.index, count: surface.entries.length});
  }
  function visible(item) {
    if (item.isViewer) return true;
    if (viewerSurface) return false;
    const box = item.element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.top < innerHeight + 300 && box.bottom > -300;
  }
  function queue(root) {
    if (root) dirty.add(root);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }
  function flush() {
    scheduled = false; context();
    const roots = dirty.has(document) ? [document] : [...dirty]; dirty.clear();
    for (const root of roots) if (root === document || root?.isConnected) scan(root);
    syncViewer();
    const groups = new Map();
    for (const item of items.values()) {
      if (!item.element.isConnected) { dispose(item); continue; }
      if (item.kind === "image" && !item.isViewer) {
        groups.set(item.group, (groups.get(item.group) || 0) + 1);
      }
    }
    for (const item of items.values()) {
      if (!item.isViewer && item.kind === "image") item.imageCount = groups.get(item.group);
      const cat = category(item);
      item.host.dataset.category = cat || "unknown";
      item.host.dataset.post = item.postId || "";
      item.host.dataset.attachment = item.attachmentPost || "";
      item.host.dataset.index = item.mediaIndex == null ? "" : String(item.mediaIndex);
      item.host.dataset.ready = String(!!mediaSource(item));
      if (!item.pending && !item.frame && item.button.textContent.includes(" blocked — ")) item.button.textContent = blockedLabel(item);
      if ((item.frame || item.pending) && item.workerCategory !== cat) {
        item.workerCategory = cat; post({type: "category", id: item.id, epoch, category: cat});
      }
      if (!item.manual && P.blocked(settings, cat) && (item.frame || item.pending)) reset(item);
      if (visible(item)) authorize(item);
    }
  }
  function imageState(event) {
    if (!event.isTrusted || event.origin !== new URL(chrome.runtime.getURL("/")).origin) return;
    const item = [...items.values()].find(item => item.kind === "image" && item.frame?.contentWindow === event.source);
    if (!item || !item.element.isConnected) return;
    if (event.data?.type === "xmf-viewer-key" && item.isViewer && ["ArrowLeft", "ArrowRight", "Escape"].includes(event.data.key)) {
      if (event.data.key === "Escape") closeViewer(true);
      else selectViewer(viewerSurface.index + (event.data.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    if (event.data?.type !== "xmf-image-state" || typeof event.data.ready !== "boolean") return;
    item.imageReady = event.data.ready;
    if (item.imageReady && item.shadow.activeElement === item.frame) {
      const target = item.isViewer ? viewerSurface?.ui.closeButton : item.element.closest('a[href*="/photo/"]');
      target?.focus({preventScroll: true});
    }
    item.frame.style.pointerEvents = item.imageReady ? "none" : "auto";
    item.frame.tabIndex = item.imageReady ? -1 : 0;
  }
  function observeMetadata(data) {
    if (!Array.isArray(data?.posts)) return;
    for (const raw of data.posts.slice(0, 500)) {
      if (!raw || typeof raw.id !== "string" || !/^\d{1,25}$/.test(raw.id)) continue;
      const previous = posts.get(raw.id);
      const media = raw.media === undefined ? previous?.media || [] : (Array.isArray(raw.media) ? raw.media : []).slice(0, 16).map((entry, index) => {
        const poster = P.mediaURL(entry?.poster, "image");
        const old = previous?.media[index];
        const key = typeof entry?.key === "string" && entry.key.length > 0 && entry.key.length <= 100 ? entry.key : null;
        const same = P.sameAsset(poster, old?.poster) &&
          (entry?.key === undefined || (key !== null && key === old?.key));
        const type = entry?.type === undefined && same ? old.type
          : ["photo", "video", "animated_gif"].includes(entry?.type) ? entry.type : null;
        const compatible = same && type === old.type;
        const mediaId = entry?.mediaId === undefined && compatible ? old.mediaId
          : typeof entry?.mediaId === "string" && /^\d{1,25}$/.test(entry.mediaId) ? entry.mediaId : null;
        const candidate = entry?.variants === undefined && compatible && mediaId === old.mediaId ? old.video
          : P.chooseVideo(entry?.variants, poster, mediaId)?.url;
        return {poster, mediaId, type, key: entry?.key === undefined && same ? old.key ?? null : key,
          video: P.videoMatchesPoster(poster, candidate, mediaId) ? candidate : null};
      });
      const numeric = key => raw[key] === undefined ? previous?.[key] || null
        : typeof raw[key] === "string" && /^\d{1,25}$/.test(raw[key]) ? raw[key] : null;
      const author = raw.author === undefined ? previous?.author || null
        : typeof raw.author === "string" && /^[A-Za-z0-9_]{1,15}$/.test(raw.author) ? raw.author.toLowerCase() : null;
      posts.delete(raw.id);
      posts.set(raw.id, {id: raw.id, author, conversation: numeric("conversation"),
        parent: numeric("parent"), quote: numeric("quote"), media});
    }
    while (posts.size > 2000) posts.delete(posts.keys().next().value);
    queue(document);
  }

  // Document lifecycle and trusted input. Website rendering internals are not an interface.
  document.addEventListener("click", event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href*="/photo/"]');
    if (!link) return;
    dirty.add(document); flush();
    const item = [...items.values()].find(item => !item.isViewer && item.element.closest("a") === link && item.imageReady);
    if (!item) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const fallback = [...items.values()].filter(candidate => !candidate.isViewer && candidate.kind === "image" && candidate.poster &&
      candidate.group === item.group)
      .map(candidate => ({poster: candidate.poster, mediaIndex: candidate.mediaIndex}));
    openViewer({postId: item.postId, attachmentPost: item.attachmentPost,
      fallback, inheritManual: item.manual}, item.mediaIndex, false, link);
  }, true);
  // Intercept before X's window-level shortcuts can navigate behind the modal.
  addEventListener("keydown", event => {
    if (!viewerSurface || !event.isTrusted) return;
    event.stopImmediatePropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Escape") closeViewer(true);
      else selectViewer(viewerSurface.index + (event.key === "ArrowLeft" ? -1 : 1));
    }
  }, true);
  addEventListener("message", imageState);
  const bridgeNonce = crypto.randomUUID();
  addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window || event.origin !== location.origin || event.data?.channel !== "xmf-channel-v1" || event.ports.length !== 1) return;
    event.stopImmediatePropagation();
    if (metadataPort || event.data.nonce !== bridgeNonce) { event.ports[0].close(); return; }
    metadataPort = event.ports[0];
    metadataPort.onmessage = event => observeMetadata(event.data);
  });
  function readyBridge(attempt = 0) {
    if (metadataPort) return;
    dispatchEvent(new CustomEvent("xmf-ready-v1", {detail: bridgeNonce}));
    if (attempt < 5) setTimeout(() => readyBridge(attempt + 1), 50 * (attempt + 1));
  }
  readyBridge();
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== "xmf-context") return;
    context();
    if (msg.route === route && msg.epoch === epoch) respond({route, epoch});
  });
  const observer = new MutationObserver(records => {
    context();
    for (const record of records) {
      const root = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (root?.closest("xmf-slot,xmf-gallery")) continue;
      if (root) queue(root.closest("article") || root.closest('a[href*="/status/"]') || root);
    }
  });
  observer.observe(document, {childList: true, subtree: true, attributes: true,
    attributeFilter: ["src", "srcset", "poster", "href", "width", "height"]});
  navigation?.addEventListener("currententrychange", context);
  addEventListener("popstate", context);
  addEventListener("scroll", () => queue(null), {passive: true});
  addEventListener("pagehide", () => {
    closeViewer(false); epoch = crypto.randomUUID();
    for (const item of items.values()) { item.manual = false; reset(item); }
    port?.disconnect();
  });
  addEventListener("pageshow", () => { context(); if (!port) connect(); queue(document); });
  setInterval(() => { context(); if (!port) connect(); post({type: "alive"}); }, 20000);
  context(); connect(); queue(document);
})();
