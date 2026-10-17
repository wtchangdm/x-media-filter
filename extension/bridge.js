(() => {
  "use strict";
  const nativePost = window.postMessage.bind(window);
  const channel = new MessageChannel();
  const publish = channel.port1.postMessage.bind(channel.port1);
  let handedOff = false;
  let pending = [];
  // Wait until the isolated document_start listener is installed; never broadcast metadata.
  addEventListener("xmf-ready-v1", event => {
    if (handedOff || typeof event.detail !== "string" || event.detail.length !== 36) return;
    handedOff = true;
    nativePost({channel: "xmf-channel-v1", nonce: event.detail}, location.origin, [channel.port2]);
    if (pending.length) { publish({posts: pending}); pending = []; }
  });
  channel.port1.onmessage = event => {
    const request = event.data;
    if (request?.type !== "identity" || !/^[a-f0-9-]{36}$/.test(request.marker) || !/^\d{1,25}$/.test(request.postId)) return;
    const element = document.querySelector(`[data-xmf-identity="${request.marker}"]`);
    const keys = [];
    try {
      const property = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      let fiber = property && element[property];
      // Keyed X timeline entries survive virtualization; never return props or post bodies.
      for (let depth = 0; fiber && depth < 120; depth++, fiber = fiber.return) {
        if (typeof fiber.key === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(fiber.key) && keys.length < 16) keys.push(fiber.key);
        if (Array.isArray(fiber.memoizedProps?.items)) break;
      }
    } catch { /* An unknown renderer gets document-local identity only. */ }
    publish({type: "identity", marker: request.marker, keys: keys.some(key => key.split(/[^0-9]+/).includes(request.postId)) ? keys : []});
  };
  function relevant(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin && /\/graphql\//.test(u.pathname) && /Tweet|Timeline|Search|Bookmark|Notification|Community|List/.test(u.pathname); }
    catch { return false; }
  }
  function observe(data) {
    const stack = [data];
    const seen = new Set();
    const posts = [];
    let budget = 60000;
    while (stack.length && budget-- > 0 && posts.length < 500) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const legacy = node.legacy;
      if (/^\d+$/.test(node.rest_id) && legacy && (legacy.conversation_id_str || legacy.extended_entities)) {
        const user = node.core?.user_results?.result;
        const author = user?.core?.screen_name || user?.legacy?.screen_name;
        const media = [];
        for (const entry of (legacy.extended_entities?.media || []).slice(0, 16)) {
          const poster = entry.media_url_https;
          if (typeof poster !== "string") continue;
          const variants = (entry.video_info?.variants || []).slice(0, 16).map(v => ({url: v.url, content_type: v.content_type, bitrate: v.bitrate}));
          media.push({poster, type: entry.type, variants, mediaId: entry.id_str,
            key: String(entry.media_key || entry.id_str || "").slice(0, 100),
            width: entry.original_info?.width, height: entry.original_info?.height});
        }
        posts.push({id: node.rest_id, author: typeof author === "string" ? author : null,
          conversation: legacy.conversation_id_str, parent: legacy.in_reply_to_status_id_str,
          quote: node.quoted_status_result?.result?.rest_id || node.quoted_status_result?.result?.tweet?.rest_id || legacy.quoted_status_id_str, media});
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    if (posts.length) {
      if (handedOff) publish({posts}); else pending = posts;
    }
  }
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await Reflect.apply(originalFetch, this, args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (relevant(url) && response.headers.get("content-type")?.includes("json")) {
      response.clone().json().then(observe).catch(() => {});
    }
    return response;
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    urls.set(this, url); return Reflect.apply(open, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (relevant(urls.get(this))) this.addEventListener("load", () => {
      try {
        if (this.responseType === "json") observe(this.response);
        else if (!this.responseType || this.responseType === "text") observe(JSON.parse(this.responseText));
      } catch { /* Changes to X's API leave media blocked. */ }
    }, {once: true});
    return Reflect.apply(send, this, args);
  };
})();
