(() => {
  "use strict";
  const nativePost = window.postMessage.bind(window);
  const channel = new MessageChannel();
  const publish = channel.port1.postMessage.bind(channel.port1);
  let handedOff = false;
  let pending = [];
  // Wait until the isolated document_start listener is installed; never broadcast metadata.
  addEventListener("xmf-ready-v1", event => {
    if (handedOff || typeof event.detail !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event.detail)) return;
    handedOff = true;
    nativePost({channel: "xmf-channel-v1", nonce: event.detail}, location.origin, [channel.port2]);
    if (pending.length) { publish({posts: pending}); pending = []; }
  });
  function relevant(url) {
    try {
      const u = new URL(url, location.href);
      const operation = /^\/graphql\/[A-Za-z0-9_-]+\/([A-Za-z0-9_]+)$/.exec(u.pathname)?.[1];
      return !u.username && !u.password && u.origin === "https://api.x.com" &&
        !!operation && /tweet|post|timeline|search|bookmark|notification|communit|list/i.test(operation);
    }
    catch { return false; }
  }
  const scalar = (value, limit) => typeof value === "string" && value.length <= limit ? value : undefined;
  const numeric = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  // Undefined means absent; malformed provided containers/values remain explicit nulls.
  function field(object, ...path) {
    for (const key of path) {
      if (!object || typeof object !== "object" || Array.isArray(object)) return object === undefined ? undefined : null;
      if (!Object.hasOwn(object, key)) return undefined;
      object = object[key] === undefined ? null : object[key];
    }
    return object;
  }
  function put(target, key, value, sanitize) {
    if (value !== undefined) target[key] = sanitize(value) ?? null;
  }
  function attachment(entry) {
    const poster = scalar(entry?.media_url_https, 8192);
    if (!poster) return {};
    const media = {poster};
    put(media, "type", field(entry, "type"), value => scalar(value, 32));
    put(media, "mediaId", field(entry, "id_str"), value => scalar(value, 25));
    put(media, "key", field(entry, "media_key"), value => scalar(value, 100));
    put(media, "variants", field(entry, "video_info", "variants"), variants => Array.isArray(variants) ? variants.slice(0, 16).map(variant => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) return {};
      const result = {};
      put(result, "url", field(variant, "url"), value => scalar(value, 8192));
      put(result, "content_type", field(variant, "content_type"), value => scalar(value, 100));
      put(result, "bitrate", field(variant, "bitrate"), numeric);
      return result;
    }) : null);
    return media;
  }
  function observe(data, limits = {nodes: 60000, posts: 500}) {
    const stack = [data];
    const seen = new Set();
    const posts = [];
    while (stack.length && limits.nodes-- > 0 && limits.posts > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const legacy = field(node, "legacy");
      if (typeof node.rest_id === "string" && /^\d{1,25}$/.test(node.rest_id) &&
          (Object.hasOwn(node, "media_entities2") || (legacy && typeof legacy === "object" && !Array.isArray(legacy) &&
            Object.hasOwn(legacy, "conversation_id_str")))) {
        const post = {id: node.rest_id};
        put(post, "author", field(node, "core", "user_results", "result", "core", "screen_name"), value => scalar(value, 15));
        put(post, "conversation", field(legacy, "conversation_id_str"), value => scalar(value, 25));
        put(post, "parent", field(legacy, "in_reply_to_status_id_str"), value => scalar(value, 25));
        put(post, "quote", field(legacy, "quoted_status_id_str"), value => scalar(value, 25));
        put(post, "media", field(node, "media_entities2"), value => Array.isArray(value) ? value.slice(0, 16).map(attachment) : null);
        posts.push(post);
        limits.posts--;
      }
      for (const key in node) {
        if (limits.nodes-- <= 0) break;
        if (!Object.hasOwn(node, key)) continue;
        const value = node[key];
        if (value && typeof value === "object") stack.push(value);
      }
    }
    if (posts.length) {
      if (handedOff) publish({posts});
      else {
        // Replay in arrival order; only the isolated consumer merges metadata.
        pending.push(...posts);
        if (pending.length > 500) pending.splice(0, pending.length - 500);
      }
    }
  }
  // Keep only fingerprints/work counters, never source text or decoded page payloads.
  const scripts = new WeakMap();
  const maxSource = 2 * 1024 * 1024;
  function hasSchema(text) {
    return text.includes("rest_id") && (text.includes("media_entities2") ||
      (text.includes("legacy") && text.includes("conversation_id_str")));
  }
  function observeScript(script) {
    if (script.localName !== "script" || script.hasAttribute("src")) return;
    const previous = scripts.get(script);
    if (previous?.work >= maxSource * 8) return;
    const source = script.textContent;
    if (!source || source.length > maxSource) return;
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
    if (previous?.length === source.length && previous.hash === hash) return;
    scripts.set(script, {length: source.length, hash, work: (previous?.work || 0) + source.length});
    if (!hasSchema(source)) return;
    const limits = {nodes: 60000, posts: 500};
    try {
      const data = JSON.parse(source);
      if (typeof data !== "string") { observe(data, limits); return; }
      if (hasSchema(data)) { observe(JSON.parse(data), limits); return; }
    } catch { /* Streaming scripts may be incomplete or wrap JSON in JavaScript. */ }
    // Only complete double-quoted JSON literals are decoded; page code is never run.
    let candidates = 0;
    for (let i = 0; i < source.length && candidates < 128 && limits.nodes > 0 && limits.posts > 0; i++) {
      if (source[i] !== '"') continue;
      const start = i++;
      for (; i < source.length && source[i] !== '"'; i++) if (source[i] === "\\") i++;
      if (i >= source.length) break;
      const literal = source.slice(start, i + 1);
      if (!hasSchema(literal)) continue;
      candidates++;
      try {
        const decoded = JSON.parse(literal);
        if (hasSchema(decoded)) observe(JSON.parse(decoded), limits);
      } catch { /* Non-JSON JavaScript strings and partial payloads remain unknown. */ }
    }
  }
  new MutationObserver(records => {
    const changed = new Set();
    const collect = node => {
      if (node.nodeType !== 1) return;
      if (node.localName === "script") changed.add(node);
      else for (const script of node.querySelectorAll("script")) changed.add(script);
    };
    for (const record of records) {
      const parent = record.type === "characterData" ? record.target.parentNode : record.target;
      if (parent?.localName === "script") changed.add(parent);
      // addedNodes still references scripts that removed themselves before delivery.
      for (const node of record.addedNodes || []) collect(node);
    }
    for (const script of changed) observeScript(script);
  }).observe(document, {subtree: true, childList: true, characterData: true});
  for (const script of document.querySelectorAll("script")) observeScript(script);

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await Reflect.apply(originalFetch, this, args);
    const url = typeof args[0] === "string" || args[0] instanceof URL ? args[0] : args[0]?.url;
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
