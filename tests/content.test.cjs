"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../extension/policy.js");

// Offline controller contracts only; native focus, rendering and network need browser proof.
const source = fs.readFileSync(require.resolve("../extension/content.js"), "utf8");
const marker = "  // Document lifecycle and trusted input.";
assert.ok(source.indexOf(marker) > 0, "content startup boundary must exist");
const testSource = source.slice(0, source.indexOf(marker)) + `
  globalThis.controller = {
    items, posts, dirty, make, scan, activate, authorize, message, imageState,
    observeMetadata, flush, context, applySettings, openViewer, selectViewer,
    closeViewer, syncViewer, connect, disconnect,
    get surface() { return viewerSurface; },
    get epoch() { return epoch; },
    get route() { return route; }
  };
})();`;
const image = "https://pbs.twimg.com/media/Selected?format=jpg&name=small";
const secondImage = "https://pbs.twimg.com/media/Second?format=jpg&name=small";
const thirdImage = "https://pbs.twimg.com/media/Third?format=jpg&name=small";
const videoPoster = "https://pbs.twimg.com/ext_tw_video_thumb/1003/pu/img/Video.jpg";
const videoURL = "https://video.twimg.com/ext_tw_video/1003/pu/vid/640x360/Video.mp4";
const destination = "https://x.com/author/status/123/photo/1";
const extensionOrigin = "chrome-extension://test-extension";
const blocked = { a: true, c: true, b: true };
const attachments = [image, secondImage, thirdImage].map(poster => ({ type: "photo", poster }));

// Node treats extension schemes as opaque; Chrome exposes a tuple origin.
class ChromeURL extends URL {
  get origin() { return this.protocol === "chrome-extension:" ? `${this.protocol}//${this.host}` : super.origin; }
}

function node(tag, attributes = {}) {
  const value = Object.assign(new EventTarget(), {
    tag, attributes, style: {}, dataset: {}, children: [], parentElement: null,
    textContent: "", disabled: false, focusCalls: [], activeElement: null,
    matches(selector) {
      return selector.split(",").some(part => part.trim() === tag ||
        (part.trim() === 'a[href*="/photo/"]' && tag === "a" && attributes.href?.includes("/photo/")));
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    },
    contains(other) {
      for (let current = other; current; current = current.parentElement) if (current === this) return true;
      return false;
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
    append(...children) {
      for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
    },
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); },
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    },
    attachShadow() { this.shadowRoot = node("shadow"); this.shadowRoot.shadowHost = this; return this.shadowRoot; },
    setAttribute(name, value) { attributes[name] = value; },
    getAttribute(name) { return attributes[name] ?? null; },
    removeAttribute(name) { delete attributes[name]; },
    toggleAttribute(name, enabled) { if (enabled) attributes[name] = ""; else delete attributes[name]; },
    focus(options) { this.focusCalls.push(options); },
    getBoundingClientRect() { return this.box || { width: 600, height: 400, top: 50, bottom: 450 }; },
    pause() { this.paused = true; },
  });
  Object.defineProperty(value, "isConnected", {
    get() { return !!(this.rootConnected || this.parentElement?.isConnected || this.shadowHost?.isConnected); },
  });
  if (tag === "iframe") value.contentWindow = {};
  return value;
}

function harness(initialURL = "https://x.com/home") {
  let sequence = 0;
  let descriptors = [];
  let failConnect = false;
  const messages = [], frames = [], ports = [], uis = [], replacements = [];
  const document = node("document"); document.rootConnected = true;
  document.documentElement = node("html"); document.append(document.documentElement);
  document.createElement = tag => { const value = node(tag); if (tag === "iframe") frames.push(value); return value; };
  const location = new URL(initialURL);
  location.replace = url => { replacements.push(url); location.href = url; };
  const sandbox = vm.createContext({
    XMFPolicy: policy, URL: ChromeURL, Event, location, document,
    innerHeight: 800, getComputedStyle: element => ({ position: element.style.position || "static" }),
    crypto: { randomUUID: () => `id-${++sequence}` },
    // Tests explicitly drain controller work; the adapter and modal have independent suites.
    requestAnimationFrame() {},
    XMFAdapter: {
      scan(root) { return descriptors.filter(desc => desc.element.isConnected && (root === document || root === desc.element || root.contains(desc.element))); },
    },
    XMFViewer: { create(callbacks) {
      const host = node("xmf-gallery"), stage = node("div"), closeButton = node("button");
      host.append(closeButton, stage); document.documentElement.append(host);
      const ui = { host, stage, closeButton, callbacks, updates: [],
        update(state) { this.updates.push(state); },
        destroy(options) { this.destroyOptions = options; host.remove(); },
      };
      uis.push(ui); return ui;
    } },
    chrome: { runtime: {
      getURL: path => `${extensionOrigin}/${path.replace(/^\//, "")}`,
      connect() {
        if (failConnect) throw new Error("worker unavailable");
        const port = { messages: [],
          postMessage(message) { this.messages.push(message); messages.push(message); },
          onDisconnect: { addListener(callback) { port.disconnectCallback = callback; } },
          onMessage: { addListener(callback) { port.messageCallback = callback; } },
        };
        ports.push(port); return port;
      },
    } },
  });
  vm.runInContext(testSource, sandbox, { filename: "content.js", timeout: 1000 });
  const api = sandbox.controller;
  function mount(overrides = {}, article = node("article")) {
    if (!article.isConnected) document.documentElement.append(article);
    const anchor = node("a", { href: destination });
    const element = node("div"); anchor.append(element); article.append(anchor);
    const desc = { element, article, kind: "image", poster: image, video: null, mediaId: null,
      postId: "123", attachmentPost: "123", mediaIndex: 0, ...overrides };
    descriptors.push(desc); api.scan(document);
    return { desc, element, article, anchor, get item() { return api.items.get(element); } };
  }
  function metadata(media = attachments, id = "123", extra = {}) {
    api.observeMetadata({ posts: [{ id, author: "author", media, ...extra }] });
  }
  function open(extra = {}, index = 0) {
    api.openViewer({ postId: "123", attachmentPost: "123", ...extra }, index);
    return selected();
  }
  function selected() { return api.items.get(api.surface?.ui.stage); }
  function ticket(item, type = "ticket") {
    return { type, id: item.id, epoch: api.epoch, token: `ticket-${item.id}` };
  }
  function render(item) { assert.equal(item.pending, true); api.message(ticket(item)); assert.ok(item.frame); return item.frame; }
  return { api, document, mount, metadata, open, selected, ticket, render, messages, frames, ports, uis, replacements,
    manualCount: () => [...api.items.values()].filter(item => item.manual).length,
    grants: () => messages.filter(message => message.type === "grant"),
    navigate(url) { location.href = url; api.context(); },
    unavailable(value) { failConnect = value; },
    forget(element) { descriptors = descriptors.filter(desc => desc.element !== element); },
    reverseScanOrder() { descriptors.reverse(); },
  };
}

function imageEvent(item, overrides = {}) {
  return { isTrusted: true, origin: extensionOrigin, source: item.frame.contentWindow,
    data: { type: "xmf-image-state", ready: true }, ...overrides };
}
function assertRevoked(h, ticket) {
  assert.ok(h.messages.some(message => message.type === "revoke" && message.id === ticket.id));
  const count = h.frames.length;
  h.api.message(ticket);
  assert.equal(h.frames.length, count, "a delayed ticket cannot mount a stale renderer");
}

for (const type of ["click", "pointerdown", "mousedown", "keydown"]) {
  test(`slot ${type} isolates blocked/loading/error input, then releases decoded images`, () => {
    const h = harness(), { item } = h.mount();
    function check(stopped) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      item.host.dispatchEvent(event);
      assert.equal(event.cancelBubble, stopped);
      assert.equal(event.defaultPrevented, false);
    }
    check(true);
    item.button.dispatchEvent(new Event("click", { cancelable: true }));
    assert.equal(h.grants().length, 0, "synthetic activation is not authorization");
    h.api.activate(item); check(true);
    h.api.message(h.ticket(item, "denied")); check(true);
    assert.equal(item.button.disabled, false);
    assert.match(item.button.textContent, /retry/);
    h.api.activate(item); h.render(item); check(true);
    h.api.imageState(imageEvent(item)); check(false);
    h.api.imageState(imageEvent(item, { data: { type: "xmf-image-state", ready: false } })); check(true);
  });
}

test("image activation grants only same-occurrence, same-attachment still images with independent tickets", () => {
  const h = harness(), first = h.mount();
  const second = h.mount({ poster: secondImage, mediaIndex: 1 }, first.article);
  const quote = h.mount({ attachmentPost: "456", poster: image }, first.article);
  const video = h.mount({ kind: "video", poster: videoPoster, video: videoURL, mediaId: "1003" }, first.article);
  const duplicate = h.mount({ poster: image });
  const neighbor = h.mount({ postId: "456", attachmentPost: "456" });
  h.api.flush();
  assert.match(first.item.button.textContent, /2 images blocked/);
  h.api.activate(first.item);
  assert.deepEqual(h.grants().map(grant => grant.url), [image, secondImage]);
  assert.equal(new Set(h.grants().map(grant => grant.id)).size, 2);
  for (const grant of h.grants()) {
    assert.equal(grant.kind, "image"); assert.equal(grant.manual, true);
    assert.equal(grant.epoch, h.api.epoch);
    assert.deepEqual(Object.keys(grant).sort(), ["category", "epoch", "id", "kind", "manual", "mediaId", "poster", "type", "url"]);
  }
  for (const other of [quote, video, duplicate, neighbor]) {
    assert.equal(other.item.pending, false); assert.equal(other.item.manual, false);
  }
  h.api.activate(video.item);
  assert.deepEqual(h.grants().map(grant => grant.url), [image, secondImage, videoURL]);
  assert.equal(second.item.pending, true);
});

test("unknown attachment occurrences never share a group or depend on scan order", () => {
  const h = harness(), first = h.mount({ postId: null, attachmentPost: null });
  const second = h.mount({ postId: null, attachmentPost: null }, first.article);
  h.api.flush(); h.api.activate(first.item);
  assert.equal(h.grants().length, 1);
  assert.equal(second.item.pending, false);
  assert.match(first.item.button.textContent, /Loading/);
  const original = first.item;
  h.reverseScanOrder();
  h.api.scan(h.document);
  assert.equal(first.item, original, "scan position is not occurrence identity");
  assert.equal(first.item.manual, true);
  assert.equal(second.item.manual, false);
});

for (const [label, media, ordinal, poster] of [
  ["missing metadata", null, 1, null], ["empty metadata", [], 1, null],
  ["missing ordinal", attachments, 5, null],
  ["video ordinal", [{ type: "video", poster: videoPoster }], 1, null],
  ["GIF ordinal", [{ type: "animated_gif", poster: image }], 1, null],
  ["malformed leading slot", [null, attachments[1]], 1, null],
  ["valid slot after malformed slot", [null, attachments[1]], 2, secondImage],
  ["duplicate asset ordinal", [attachments[0], attachments[0]], 2, image],
  ["zero ordinal", attachments, 0, null],
]) {
  test(`direct photo URL starts blocked and preserves ${label}`, () => {
    const h = harness(destination.replace("photo/1", `photo/${ordinal}`));
    if (media) h.metadata(media);
    h.api.flush();
    const item = h.selected();
    assert.equal(item.mediaIndex, ordinal - 1); assert.equal(item.poster, poster);
    assert.equal(item.kind, "image"); assert.equal(item.video, null);
    assert.equal(h.grants().length, 0, "a route selects content, not permission");
    assert.equal(item.button.isConnected, true);
    if (!poster) {
      h.api.activate(item);
      assert.match(item.button.textContent, /waiting for X metadata/);
      assert.equal(h.grants().length, 0);
    }
  });
}

test("sanitized late metadata preserves ordinals and replaces an unresolved viewer without permission", () => {
  const h = harness(destination.replace("photo/1", "photo/4")); h.api.flush();
  const previous = h.selected(), surface = h.api.surface;
  h.metadata([null, { type: "photo", poster: "https://example.com/private.jpg" },
    { type: "invalid", poster: image }, attachments[1]]);
  const media = h.api.posts.get("123").media;
  assert.equal(media.length, 4); assert.equal(media[0].poster, null);
  assert.equal(media[1].poster, null); assert.equal(media[2].type, null);
  h.api.flush();
  assert.equal(h.api.surface, surface); assert.notEqual(h.selected(), previous);
  assert.equal(previous.host.isConnected, false); assert.equal(previous.manual, false);
  assert.equal(h.selected().mediaIndex, 3); assert.equal(h.selected().poster, secondImage);
  assert.equal(h.grants().length, 0);
});

test("metadata validation rejects invalid posts and keeps video bindings fail-closed", () => {
  const h = harness();
  h.api.observeMetadata({ posts: [null, { id: 123, media: attachments }, { id: "bad", media: attachments }, { id: "12", media: null },
    { id: "123", author: "invalid/name", conversation: "bad", parent: "bad", quote: "bad", media: [
      { type: "video", poster: image, mediaId: "not-numeric", variants: [{ content_type: "video/mp4", url: videoURL }] },
      { type: "video", poster: videoPoster, mediaId: "1004", variants: [{ content_type: "video/mp4", url: videoURL }] },
    ] } ] });
  assert.equal(h.api.posts.size, 2);
  assert.equal(h.api.posts.get("12").media.length, 0);
  const post = h.api.posts.get("123");
  for (const field of ["author", "conversation", "parent", "quote"]) assert.equal(post[field], null);
  assert.equal(post.media[0].mediaId, null);
  assert.ok(post.media.every(entry => entry.video === null));
});

test("only current metadata can establish author-relative eligibility", () => {
  const h = harness("https://x.com/focus/status/123");
  h.metadata([], "123", { author: "focus", conversation: "123" });
  h.metadata(attachments, "456", { author: null, conversation: "123" });
  const mounted = h.mount({ postId: "456", attachmentPost: "456", author: "focus" });
  h.api.applySettings({a: false, c: false, b: true}); h.api.flush();
  assert.equal(h.grants().length, 0, "a rendered-author hint cannot authorize unknown metadata");
  h.metadata(attachments, "456", { author: "focus", conversation: "123" }); h.api.flush();
  assert.equal(h.grants().length, 1); assert.equal(h.grants()[0].category, "C");
  const ticket = h.ticket(mounted.item); h.render(mounted.item);
  h.metadata(attachments, "456", { author: null, conversation: "123" }); h.api.flush();
  assert.equal(mounted.item.frame, null); assertRevoked(h, ticket);
});

test("partial post metadata preserves absent fields but clears explicitly invalid scalar fields", () => {
  const h = harness();
  h.metadata(attachments, "123", { author: "AUTHOR", conversation: "123", parent: "12", quote: "456" });
  const previous = h.api.posts.get("123");
  h.api.observeMetadata({ posts: [{ id: "123" }] });
  assert.deepEqual(h.api.posts.get("123"), previous);
  for (const value of [null, "", "invalid/value", 123]) {
    h.metadata(attachments, "123", { author: "author", conversation: "123", parent: "12", quote: "456" });
    h.api.observeMetadata({ posts: [{ id: "123", author: value, conversation: value, parent: value, quote: value }] });
    const post = h.api.posts.get("123");
    for (const field of ["author", "conversation", "parent", "quote"]) assert.equal(post[field], null, field);
    assert.equal(post.media.length, 3, "omitted media does not withdraw known attachments");
  }
});

test("absent media preserves attachments while explicit invalid or empty lists withdraw them", () => {
  const h = harness(); h.metadata();
  const previous = h.api.posts.get("123");
  h.api.observeMetadata({ posts: [{ id: "123", author: "replacement" }] });
  assert.equal(h.api.posts.get("123").author, "replacement");
  assert.equal(h.api.posts.get("123").media, previous.media);
  for (const media of [null, {}, "", 123, false, []]) {
    h.metadata();
    h.api.observeMetadata({ posts: [{ id: "123", author: "replacement", conversation: "456", media }] });
    const post = h.api.posts.get("123");
    assert.equal(post.media.length, 0, "explicit invalid or empty media withdraws attachments");
    assert.equal(post.author, "replacement", "other provided fields still update");
    assert.equal(post.conversation, "456");
  }
});

const videoMetadata = { type: "video", poster: image, key: "7_1003", mediaId: "1003",
  variants: [{ content_type: "video/mp4", url: videoURL, bitrate: 1000000 }] };

for (const [label, update, expected] of [
  ["omitted fields on the same asset", { poster: image }, { type: "video", key: "7_1003", mediaId: "1003", video: videoURL }],
  ["unchanged attachment key", { poster: image, key: "7_1003" }, { type: "video", key: "7_1003", mediaId: "1003", video: videoURL }],
  ["replacement attachment key", { poster: image, type: "video", key: "7_1004" }, { type: "video", key: "7_1004", mediaId: null, video: null }],
  ["replacement key with explicit media ID", { poster: image, type: "video", key: "7_1004", mediaId: "1003" }, { type: "video", key: "7_1004", mediaId: "1003", video: null }],
  ["replacement key with variants but absent media ID", { poster: image, type: "video", key: "7_1004", variants: videoMetadata.variants }, { type: "video", key: "7_1004", mediaId: null, video: null }],
  ["invalid attachment key", { poster: image, type: "video", key: null }, { type: "video", key: null, mediaId: null, video: null }],
  ["empty attachment key", { poster: image, type: "video", key: "" }, { type: "video", key: null, mediaId: null, video: null }],
  ["non-string attachment key", { poster: image, type: "video", key: 1003 }, { type: "video", key: null, mediaId: null, video: null }],
  ["oversized attachment key", { poster: image, type: "video", key: "7".repeat(101) }, { type: "video", key: null, mediaId: null, video: null }],
  ["another rendition of the same cover", { poster: image.replace("small", "large") }, { type: "video", mediaId: "1003", video: videoURL }],
  ["empty variants", { poster: image, variants: [] }, { type: "video", mediaId: "1003", video: null }],
  ["invalid variants", { poster: image, variants: null }, { type: "video", mediaId: "1003", video: null }],
  ["invalid media ID", { poster: image, mediaId: "bad" }, { type: "video", mediaId: null, video: null }],
  ["empty media ID", { poster: image, mediaId: "" }, { type: "video", mediaId: null, video: null }],
  ["replacement media ID", { poster: image, mediaId: "1004" }, { type: "video", mediaId: "1004", video: null }],
  ["replacement type", { poster: image, type: "photo" }, { type: "photo", mediaId: null, video: null }],
  ["invalid type", { poster: image, type: "unsupported" }, { type: null, mediaId: null, video: null }],
  ["missing poster", {}, { type: null, mediaId: null, video: null }],
  ["invalid poster", { poster: "https://example.com/private.jpg" }, { type: null, mediaId: null, video: null }],
  ["replacement poster", { poster: secondImage }, { type: null, mediaId: null, video: null }],
]) {
  test(`partial video metadata handles ${label} without inheriting incompatible source bindings`, () => {
    const h = harness(); h.metadata([videoMetadata]); h.metadata([update]);
    const entry = h.api.posts.get("123").media[0];
    for (const [key, value] of Object.entries(expected)) assert.equal(entry[key], value, key);
  });
}

test("absent attachment keys preserve bindings and numeric string keys remain supported", () => {
  const h = harness();
  const { key, ...unkeyed } = videoMetadata;
  for (const initial of [unkeyed, { ...videoMetadata, key: "1003" }]) {
    h.metadata([initial]); h.metadata([{ poster: image }]);
    const entry = h.api.posts.get("123").media[0];
    assert.equal(entry.key, initial.key ?? null);
    assert.equal(entry.mediaId, "1003"); assert.equal(entry.video, videoURL);
  }
});

test("replacement attachment keys accept only explicitly supplied matching video bindings", () => {
  const h = harness();
  for (const mediaId of ["1003", "1004", "bad", null]) {
    h.metadata([videoMetadata]);
    h.metadata([{ ...videoMetadata, key: "7_1004", mediaId }]);
    const entry = h.api.posts.get("123").media[0];
    assert.equal(entry.video, mediaId === "1003" ? videoURL : null);
  }
});

test("invalid explicit media IDs cannot retain an old video through an encoded poster", () => {
  const h = harness();
  for (const mediaId of [null, "", "bad", 1003, "1004"]) {
    h.metadata([{ ...videoMetadata, poster: videoPoster }]);
    h.metadata([{ poster: videoPoster, mediaId }]);
    assert.equal(h.api.posts.get("123").media[0].video, null);
  }
});

test("partial video metadata never inherits source bindings from a different ordinal", () => {
  const h = harness(); h.metadata([videoMetadata, attachments[1]]);
  h.metadata([attachments[1], { poster: image }]);
  const entries = h.api.posts.get("123").media;
  assert.equal(entries.length, 2); assert.equal(entries[1].poster, image);
  for (const field of ["type", "mediaId", "video"]) assert.equal(entries[1][field], null, field);
});

test("owned modal inheritance loads only the selected image, never inline duplicates or videos", () => {
  const h = harness(); h.metadata([...attachments, { type: "video", poster: videoPoster }]);
  const duplicate = h.mount();
  h.open({ inheritManual: true }, 1); h.api.flush();
  assert.deepEqual(h.grants().map(grant => grant.url), [secondImage]);
  assert.equal(h.api.surface.entries.length, 3);
  assert.equal(duplicate.item.pending, false); assert.equal(duplicate.item.manual, false);
  assert.equal(h.selected().isViewer, true); assert.equal(h.grants()[0].manual, true);
});

for (const phase of ["pending", "rendered"]) {
  test(`Next/Previous revokes ${phase} selection and rejects delayed tickets without eager sibling loads`, () => {
    const h = harness(destination); h.metadata(); h.api.flush();
    const first = h.selected(); h.api.activate(first);
    const firstTicket = h.ticket(first), frame = phase === "rendered" ? h.render(first) : null;
    assert.deepEqual(h.grants().map(grant => grant.url), [image]);
    h.api.selectViewer(1);
    assert.equal(first.host.isConnected, false); assert.equal(first.pending, false);
    if (frame) assert.equal(frame.isConnected, false);
    assertRevoked(h, firstTicket); h.api.flush();
    const second = h.selected(), secondTicket = h.ticket(second);
    assert.deepEqual(h.grants().map(grant => grant.url), [image, secondImage]);
    h.api.selectViewer(0); assertRevoked(h, secondTicket); h.api.flush();
    assert.deepEqual(h.grants().map(grant => grant.url), [image, secondImage, image]);
    assert.notEqual(h.selected(), first);
    assert.equal(h.api.items.size, 1);
    const current = h.selected();
    for (const index of [-1, 3, 0.5, NaN, "1"]) h.api.selectViewer(index);
    assert.equal(h.selected(), current);
  });
}

for (const action of ["close", "reopen", "route", "same-status photo route"]) {
  test(`${action} invalidates selected and previously selected viewer siblings`, () => {
    const h = harness(action === "same-status photo route" ? "https://x.com/author/status/123" : "https://x.com/home");
    h.metadata(); h.open();
    h.api.activate(h.selected()); const firstTicket = h.ticket(h.selected());
    h.api.selectViewer(1); h.api.flush(); const second = h.selected(), secondTicket = h.ticket(second);
    const frame = h.render(second), epoch = h.api.epoch;
    if (action === "close") { h.api.closeViewer(); h.open(); }
    if (action === "reopen") h.open();
    if (action === "route") h.navigate("https://x.com/other/status/456");
    if (action === "same-status photo route") {
      h.navigate(destination); h.api.flush();
    }
    assert.equal(frame.isConnected, false); assertRevoked(h, firstTicket); assertRevoked(h, secondTicket);
    if (action === "route") assert.notEqual(h.api.epoch, epoch);
    else assert.equal(h.api.epoch, epoch);
    assert.equal(h.manualCount(), 0);
    if (h.api.surface) {
      assert.equal(h.api.surface.allowed.size, 0);
      h.api.selectViewer(1); h.api.flush(); h.api.selectViewer(0); h.api.flush();
      assert.equal(h.selected().pending, false);
    }
    assert.equal(h.grants().length, 2);
  });
}

test("same-status viewer exit preserves inline manual grants but never viewer grants", () => {
  const h = harness("https://x.com/author/status/123"); h.metadata();
  const inline = h.mount(); h.api.activate(inline.item); h.render(inline.item);
  h.open({ inheritManual: true }); h.api.flush(); const old = h.ticket(h.selected());
  const epoch = h.api.epoch;
  h.navigate(destination.replace("photo/1", "photo/2"));
  assert.equal(h.api.epoch, epoch); assertRevoked(h, old);
  assert.equal(inline.item.manual, true); assert.ok(inline.item.frame);
  h.api.flush(); assert.equal(h.selected().pending, false);
});

for (const direct of [false, true]) {
  for (const phase of ["pending", "rendered"]) {
    test(`${direct ? "direct" : "inline-opened"} viewer Close revokes its ${phase} ticket, preserving the inline occurrence`, () => {
      const h = harness(direct ? destination : "https://x.com/author/status/123"); h.metadata();
      const inline = h.mount(); h.api.activate(inline.item);
      const inlineFrame = h.render(inline.item), inlineId = inline.item.id, epoch = h.api.epoch;
      if (!direct) h.open();
      h.api.flush(); h.api.activate(h.selected());
      const selected = h.selected(), old = h.ticket(selected);
      const frame = phase === "rendered" ? h.render(selected) : null;
      h.api.closeViewer(); h.api.flush();
      assert.equal(h.api.surface, null); assert.equal(selected.host.isConnected, false);
      if (frame) assert.equal(frame.isConnected, false);
      assertRevoked(h, old);
      assert.equal(h.api.epoch, epoch); assert.equal(inline.item.id, inlineId);
      assert.equal(inline.item.frame, inlineFrame); assert.equal(inlineFrame.isConnected, true);
      assert.equal(h.manualCount(), 1); assert.equal(inline.item.manual, true);
      assert.equal(h.grants().length, 2);
    });
  }
}

for (const latest of ["eligible", "blocked", "unknown"]) {
  test(`behind-modal media waits for Close and then uses its latest ${latest} classification`, () => {
    const h = harness("https://x.com/author/status/123");
    h.metadata(attachments, "123", { author: "focus", conversation: "123" });
    h.metadata(attachments, "456", { author: "other", conversation: "123" });
    const inline = h.mount({ postId: "456", attachmentPost: "456", author: null });
    h.open(); h.api.applySettings({ a: true, c: false, b: true }); h.api.flush();
    h.metadata(attachments, "456", { author: "focus", conversation: "123" }); h.api.flush();
    assert.equal(inline.item.pending, false, "newly eligible inline media must not load behind the modal");
    if (latest !== "eligible") h.metadata(attachments, "456", { author: latest === "blocked" ? "other" : null });
    h.api.closeViewer(); h.api.flush();
    assert.equal(inline.item.pending, latest === "eligible");
    assert.equal(h.grants().length, latest === "eligible" ? 1 : 0);
    if (latest === "eligible") {
      assert.equal(h.grants()[0].category, "C"); assert.equal(h.grants()[0].manual, false);
    }
  });
}

for (const direct of [false, true]) {
  test(`${direct ? "direct" : "inline-opened"} viewer Close uses settings changed behind the modal`, () => {
    const h = harness(direct ? destination : "https://x.com/author/status/123"); h.metadata();
    const inline = h.mount();
    if (!direct) h.open();
    h.api.flush(); h.api.applySettings({ a: false, c: true, b: true }); h.api.flush();
    assert.equal(inline.item.pending, false);
    const ticket = h.ticket(h.selected()); assert.equal(h.grants().length, 1);
    h.api.applySettings(blocked); h.api.closeViewer(); h.api.flush();
    assertRevoked(h, ticket); assert.equal(inline.item.pending, false); assert.equal(h.grants().length, 1);
    h.api.applySettings({ a: false, c: true, b: true }); h.api.flush();
    assert.equal(inline.item.pending, true); assert.equal(h.grants().length, 2);
  });
}

for (const surface of ["inline", "viewer"]) {
  test(`settings ON revokes a manual ${surface} using metadata received before the next scan`, () => {
    const h = harness("https://x.com/author/status/123");
    h.metadata(attachments, "123", { author: "focus", conversation: "123" });
    h.metadata(attachments, "456", { author: "focus", conversation: "123" });
    const mounted = surface === "inline" ? h.mount({ postId: "456", attachmentPost: "456", author: "focus" }) : null;
    const item = mounted?.item || h.open({ postId: "456", attachmentPost: "456", author: "focus" });
    h.api.activate(item); const old = h.ticket(item), frame = h.render(item);
    h.api.applySettings({ a: true, c: true, b: false }); h.api.flush();
    h.metadata(attachments, "456", { author: "other", conversation: "123" });
    // Storage can turn B ON before the queued metadata scan refreshes manual categories.
    h.api.applySettings(blocked); h.api.flush();
    assert.equal(frame.isConnected, false); assertRevoked(h, old);
    assert.deepEqual({ manual: item.manual, pending: item.pending, grants: h.grants().length },
      { manual: false, pending: false, grants: 1 }, "the old C classification must not preserve or reissue a now-B manual grant");
    if (surface === "viewer") assert.equal(h.api.surface.allowed.size, 0);
  });
}

test("direct Close exits the photo URL, while non-restoring teardown never navigates", () => {
  const h = harness(destination + "?test=1#selection"); h.metadata(); h.api.flush();
  h.api.closeViewer();
  assert.deepEqual(h.replacements, ["https://x.com/author/status/123?test=1#selection"]);
  assert.equal(h.uis[0].destroyOptions.restoreFocus, true);
  const other = harness(destination); other.api.flush(); other.api.closeViewer(false); other.api.flush();
  assert.equal(other.api.surface, null); assert.equal(other.replacements.length, 0);
  assert.equal(other.uis[0].destroyOptions.restoreFocus, false);
});

for (const phase of ["pending", "rendered"]) {
  test(`settings ON revokes ${phase} viewer, including previously selected manually authorized siblings`, () => {
    const h = harness(); h.metadata(); h.open();
    h.api.activate(h.selected()); const first = h.ticket(h.selected());
    h.api.selectViewer(1); h.api.flush(); const second = h.ticket(h.selected());
    if (phase === "rendered") h.render(h.selected());
    h.api.applySettings({ a: false, c: true, b: true }); h.api.flush();
    h.api.applySettings(blocked); h.api.flush();
    assert.equal(h.manualCount(), 0); assert.equal(h.api.surface.allowed.size, 0);
    assertRevoked(h, first); assertRevoked(h, second);
    h.api.selectViewer(0); h.api.flush(); h.api.selectViewer(1); h.api.flush();
    assert.equal(h.selected().pending, false); assert.equal(h.grants().length, 2);
  });
}

test("automatic eligibility loads only selected viewer and stays independent of manual group grants", () => {
  const h = harness(destination); h.metadata();
  h.api.applySettings({ a: false, c: true, b: true }); h.api.flush();
  assert.deepEqual(h.grants().map(grant => grant.url), [image]);
  assert.equal(h.manualCount(), 0); assert.equal(h.api.surface.allowed.size, 0);
  h.api.selectViewer(2); h.api.flush();
  assert.deepEqual(h.grants().map(grant => grant.url), [image, thirdImage]);
  assert.ok(h.grants().every(grant => grant.manual === false && grant.category === "A"));
  h.api.applySettings(blocked); h.api.flush();
  assert.equal(h.selected().pending, false); assert.equal(h.selected().frame, null);
});

for (const category of ["A", "C", "B", "unknown"]) {
  test(`viewer automatic eligibility and quote inheritance use enclosing ${category} category`, () => {
    const h = harness("https://x.com/untrustedHandle/status/123");
    h.metadata([], "123", { author: "focus", conversation: "123" });
    const enclosing = category === "A" ? "123" : "456";
    if (enclosing === "456") h.metadata([], "456", { author: category === "C" ? "focus" : "other",
      conversation: category === "unknown" ? null : "123" });
    h.metadata(attachments, "789", { author: "quoted", conversation: "789" });
    h.open({ postId: enclosing, attachmentPost: "789", author: "misleading" });
    h.api.applySettings({ a: category !== "A", c: category !== "C", b: category !== "B" }); h.api.flush();
    assert.equal(h.grants().length, category === "unknown" ? 0 : 1);
    if (category !== "unknown") assert.equal(h.grants()[0].category, category);
    else {
      h.api.applySettings({ a: false, c: false, b: false }); h.api.flush();
      assert.equal(h.grants().length, 1); assert.equal(h.grants()[0].category, null);
    }
  });
}

test("a manual viewer group does not authorize later-added or replaced metadata assets", () => {
  const h = harness(); h.metadata(attachments.slice(0, 2)); h.open();
  h.api.activate(h.selected()); const old = h.ticket(h.selected());
  h.metadata([attachments[2], attachments[1], attachments[0]]); h.api.flush();
  assertRevoked(h, old);
  assert.equal(h.selected().poster, thirdImage); assert.equal(h.selected().pending, false);
  h.api.selectViewer(2); h.api.flush();
  assert.equal(h.selected().pending, false, "an old asset at a new ordinal is not the authorized attachment");
  h.api.selectViewer(1); h.api.flush();
  assert.equal(h.selected().pending, true, "the unchanged authorized sibling remains eligible");
  assert.deepEqual(h.grants().map(grant => grant.url), [image, secondImage]);
});

test("turning an unrelated filter ON does not revoke an eligible viewer group", () => {
  const h = harness(); h.metadata(); h.open();
  h.api.applySettings({ a: true, c: true, b: false });
  h.api.activate(h.selected()); const frame = h.render(h.selected());
  h.api.applySettings(blocked); h.api.flush();
  assert.equal(h.selected().frame, frame);
  h.api.selectViewer(1); h.api.flush();
  assert.deepEqual(h.grants().map(grant => grant.url), [image, secondImage]);
});

test("current-document epoch is required for tickets, denials and worker revocation", () => {
  const h = harness(); h.metadata(); h.open(); h.api.activate(h.selected());
  const item = h.selected(), id = item.id;
  for (const type of ["ticket", "denied", "revoked"]) {
    h.api.message({ type, id, epoch: "other-document", token: "stale", settings: blocked });
    assert.equal(item.pending, true); assert.equal(item.id, id); assert.equal(item.frame, null);
  }
  h.api.message({ type: "revoked", id, epoch: h.api.epoch, settings: blocked });
  assert.equal(item.pending, false); assert.notEqual(item.id, id);
  assertRevoked(h, { type: "ticket", id, epoch: h.api.epoch, token: "revoked" });
});

test("late classification revokes an automatic renderer when its new category is blocked", () => {
  const h = harness("https://x.com/author/status/123");
  h.metadata([], "123", { author: "author", conversation: "123" });
  h.metadata(attachments, "456", { author: "author", conversation: "123" });
  h.open({ postId: "456", attachmentPost: "456" });
  h.api.applySettings({ a: true, c: false, b: true }); h.api.flush();
  const old = h.ticket(h.selected()), frame = h.render(h.selected());
  h.metadata(attachments, "456", { author: "different", conversation: "123" }); h.api.flush();
  assert.equal(frame.isConnected, false); assert.equal(h.selected().pending, false); assertRevoked(h, old);
});

test("worker disconnect removes live renderers; reconnect uses fresh IDs and ignores stale port messages", () => {
  const h = harness(); h.metadata(); h.open(); h.api.activate(h.selected());
  const item = h.selected(), ticket = h.ticket(item), oldPort = h.ports[0], frame = h.render(item);
  oldPort.disconnectCallback();
  assert.equal(frame.isConnected, false); assert.equal(item.pending, false); assert.notEqual(item.id, ticket.id);
  h.api.flush(); assert.equal(h.ports.length, 2); assert.equal(item.pending, true);
  assert.equal(h.ports[1].messages[0].type, "context");
  assert.equal(h.ports[1].messages[0].epoch, h.api.epoch);
  oldPort.messageCallback(ticket); assert.equal(item.frame, null);
  oldPort.disconnectCallback(); assert.equal(item.pending, true, "stale port cannot disconnect its successor");
  h.render(item);
  const frameCount = h.frames.length;
  h.ports[1].messageCallback(ticket);
  assert.equal(h.frames.length, frameCount, "a stale ticket on the new port cannot recreate the old renderer");
  assertRevoked(h, ticket);
});

test("worker unavailable is recoverable by Retry without granting any other occurrence", () => {
  const h = harness(), first = h.mount(), duplicate = h.mount();
  h.unavailable(true); h.api.activate(first.item);
  assert.equal(first.item.pending, false); assert.match(first.item.button.textContent, /unavailable/);
  assert.equal(h.grants().length, 0);
  h.unavailable(false); h.api.activate(first.item);
  assert.equal(first.item.pending, true); assert.equal(duplicate.item.pending, false);
  assert.equal(h.grants().length, 1);
});

for (const surface of ["inline", "viewer"]) {
  test(`focused ${surface} Retry recovery returns focus, but failure leaves Retry usable`, () => {
    const h = harness(); let item, target;
    if (surface === "inline") { const mounted = h.mount(); item = mounted.item; target = mounted.anchor; }
    else { h.metadata(); item = h.open(); target = h.api.surface.ui.closeButton; }
    h.api.activate(item); const frame = h.render(item); item.shadow.activeElement = frame;
    h.api.imageState(imageEvent(item, { data: { type: "xmf-image-state", ready: false } }));
    assert.equal(frame.style.pointerEvents, "auto"); assert.equal(frame.tabIndex, 0);
    assert.equal(target.focusCalls.length, 0);
    h.api.imageState(imageEvent(item));
    assert.equal(item.imageReady, true); assert.equal(frame.style.pointerEvents, "none"); assert.equal(frame.tabIndex, -1);
    assert.equal(target.focusCalls.length, 1); assert.equal(target.focusCalls[0].preventScroll, true);
  });
  for (const active of [null, "other control"]) {
    test(`background ${surface} readiness does not steal focus from ${active}`, () => {
      const h = harness(); let item, target;
      if (surface === "inline") { const mounted = h.mount(); item = mounted.item; target = mounted.anchor; }
      else { h.metadata(); item = h.open(); target = h.api.surface.ui.closeButton; }
      h.api.activate(item); h.render(item); item.shadow.activeElement = active === null ? null : node("button");
      h.api.imageState(imageEvent(item));
      assert.equal(item.imageReady, true); assert.equal(target.focusCalls.length, 0);
    });
  }
}

for (const [label, override] of [
  ["untrusted", { isTrusted: false }], ["page origin", { origin: "https://x.com" }],
  ["foreign extension", { origin: "chrome-extension://other" }], ["opaque origin", { origin: "null" }],
  ["foreign source", { source: {} }], ["missing source", { source: null }],
  ["wrong type", { data: { type: "other", ready: true } }],
  ["nonboolean readiness", { data: { type: "xmf-image-state", ready: "true" } }],
  ["missing readiness", { data: { type: "xmf-image-state" } }], ["missing data", { data: null }],
]) {
  test(`imageState rejects ${label} without changing readiness, input or focus`, () => {
    for (const ready of [false, true]) {
      const h = harness(), mounted = h.mount(), item = mounted.item;
      h.api.activate(item); h.render(item); item.shadow.activeElement = item.frame;
      item.imageReady = ready; item.frame.style.pointerEvents = ready ? "none" : "auto"; item.frame.tabIndex = ready ? -1 : 0;
      h.api.imageState(imageEvent(item, { data: { type: "xmf-image-state", ready: !ready }, ...override }));
      assert.equal(item.imageReady, ready); assert.equal(item.frame.style.pointerEvents, ready ? "none" : "auto");
      assert.equal(item.frame.tabIndex, ready ? -1 : 0); assert.equal(mounted.anchor.focusCalls.length, 0);
    }
  });
}

for (const invalid of ["untrusted", "origin", "source", "disconnected", "replaced", "inline", "video", "unsupported key"]) {
  test(`forwarded viewer keys reject ${invalid} frames or messages`, () => {
    const h = harness(); h.metadata(); h.open(); h.api.activate(h.selected());
    let item = h.selected(); h.render(item);
    if (invalid === "inline" || invalid === "video") {
      item = h.mount(invalid === "video" ? { kind: "video", poster: videoPoster, video: videoURL, mediaId: "1003" } : {}).item;
      h.api.activate(item); h.render(item);
    }
    const event = imageEvent(item, { data: { type: "xmf-viewer-key", key: "ArrowRight" } });
    if (invalid === "untrusted") event.isTrusted = false;
    if (invalid === "origin") event.origin = "https://x.com";
    if (invalid === "source") event.source = {};
    if (invalid === "disconnected") item.element.remove();
    if (invalid === "replaced") item.frame = node("iframe");
    if (invalid === "unsupported key") event.data.key = "Enter";
    const surface = h.api.surface;
    h.api.imageState(event);
    assert.equal(h.api.surface, surface); assert.equal(surface.index, 0);
  });
}

test("current image frame can forward Next, Previous and Escape; previous frame cannot close its successor", () => {
  const h = harness(); h.metadata(); h.open(); h.api.activate(h.selected()); h.render(h.selected());
  const stale = imageEvent(h.selected(), { data: { type: "xmf-viewer-key", key: "Escape" } });
  h.api.imageState(imageEvent(h.selected(), { data: { type: "xmf-viewer-key", key: "ArrowRight" } }));
  assert.equal(h.api.surface.index, 1); h.api.flush(); h.render(h.selected());
  h.api.imageState(stale); assert.ok(h.api.surface);
  h.api.imageState(imageEvent(h.selected(), { data: { type: "xmf-viewer-key", key: "ArrowLeft" } }));
  assert.equal(h.api.surface.index, 0); h.api.flush(); h.render(h.selected());
  h.api.imageState(imageEvent(h.selected(), { data: { type: "xmf-viewer-key", key: "Escape" } }));
  assert.equal(h.api.surface, null); assert.equal(h.manualCount(), 0);
});

for (const stale of ["disconnected", "replaced", "video"]) {
  test(`${stale} renderer cannot deliver image readiness or focus`, () => {
    const h = harness(), mounted = h.mount(stale === "video" ? { kind: "video", poster: videoPoster, video: videoURL, mediaId: "1003" } : {});
    const item = mounted.item; h.api.activate(item); h.render(item); item.shadow.activeElement = item.frame;
    const event = imageEvent(item);
    if (stale === "disconnected") item.element.remove();
    if (stale === "replaced") item.frame = node("iframe");
    h.api.imageState(event);
    assert.equal(item.imageReady, false); assert.equal(item.frame.style.pointerEvents, undefined);
    assert.equal(mounted.anchor.focusCalls.length, 0);
  });
}

for (const change of ["asset", "owner", "media ID", "removed descriptor", "detached element"]) {
  test(`native media ${change} cleanup revokes grants and removes stale coverage`, () => {
    const h = harness(), mounted = h.mount();
    const previous = mounted.item;
    h.api.activate(previous); const ticket = h.ticket(previous), frame = h.render(previous);
    if (change === "asset") mounted.desc.poster = secondImage;
    if (change === "owner") mounted.desc.postId = "456";
    if (change === "media ID") mounted.desc.mediaId = "999";
    if (change === "removed descriptor") h.forget(mounted.element);
    if (change === "detached element") mounted.element.remove();
    h.api.dirty.add(h.document); h.api.flush();
    assert.equal(previous.host.isConnected, false); assert.equal(frame.isConnected, false);
    assert.equal(previous.manual, false); assertRevoked(h, ticket);
    h.api.activate(previous); assert.equal(h.grants().length, 1);
    if (mounted.item) { assert.notEqual(mounted.item, previous); assert.equal(mounted.item.pending, false); }
    else assert.equal(mounted.element.getAttribute("data-xmf-covered"), null);
  });
}

for (const phase of ["pending", "rendered"]) {
  for (const replacement of ["media ID", "type", "ordinal", "source", "withdrawn source"]) {
    test(`video ${replacement} replacement revokes a ${phase} ticket on a reused element`, () => {
      const h = harness(), mounted = h.mount({ kind: "video", poster: image, video: videoURL, mediaId: "1003" });
      const previous = mounted.item;
      h.api.activate(previous); const ticket = h.ticket(previous);
      const frame = phase === "rendered" ? h.render(previous) : null;
      if (replacement === "media ID") Object.assign(mounted.desc, { mediaId: "1004", video: videoURL.replace("/1003/", "/1004/") });
      if (replacement === "type") Object.assign(mounted.desc, { kind: "image", video: null, mediaId: null });
      if (replacement === "ordinal") mounted.desc.mediaIndex = 1;
      if (replacement === "source") mounted.desc.video = videoURL.replace("640x360", "1280x720");
      if (replacement === "withdrawn source") mounted.desc.video = null;
      h.api.dirty.add(h.document); h.api.flush();
      assert.notEqual(mounted.item, previous); assert.equal(previous.host.isConnected, false);
      if (frame) assert.equal(frame.isConnected, false);
      assert.equal(previous.manual, false); assertRevoked(h, ticket);
      assert.equal(mounted.item.pending, false); assert.equal(h.grants().length, 1);
      h.api.activate(mounted.item);
      if (replacement === "withdrawn source") { assert.equal(h.grants().length, 1); return; }
      assert.equal(h.grants().length, 2, "the replacement needs its own activation");
      assert.equal(h.grants()[1].kind, replacement === "type" ? "image" : "video");
      assert.notEqual(h.grants()[1].id, ticket.id);
    });
  }
}

test("cleanup restores only presentation values owned by the controller and pauses native videos", () => {
  const h = harness(), mounted = h.mount();
  const native = node("video", { autoplay: "" }); mounted.element.append(native);
  h.api.scan(h.document); assert.equal(native.paused, true); assert.equal(native.getAttribute("autoplay"), null);
  mounted.element.style.position = "absolute";
  h.forget(mounted.element); h.api.scan(h.document);
  assert.equal(mounted.element.style.position, "absolute", "do not overwrite a later native style change");
  assert.equal(mounted.element.getAttribute("data-xmf-covered"), null);
});

for (const [label, overrides] of [
  ["missing source", { video: null }], ["malformed source", { video: "https://example.com/private.mp4" }],
  ["mismatched thumbnail", { video: videoURL.replace("/1003/", "/1004/") }],
  ["mismatched metadata ID", { mediaId: "1004" }],
  ["custom cover without ID", { poster: image, mediaId: null }],
]) {
  test(`${label} video never receives a manual or automatic grant`, () => {
    const h = harness(), mounted = h.mount({ kind: "video", poster: videoPoster, video: videoURL, mediaId: "1003", ...overrides });
    h.api.activate(mounted.item);
    assert.match(mounted.item.button.textContent, /source unavailable/);
    assert.equal(h.manualCount(), 0);
    h.api.applySettings({ a: false, c: false, b: false }); h.api.flush();
    assert.equal(h.grants().length, 0); assert.equal(mounted.item.pending, false);
  });
}

test("late valid video metadata recovers only the clicked video, without image-group spillover", () => {
  const h = harness(), video = h.mount({ kind: "video", poster: videoPoster, video: null, mediaId: "1003" });
  const still = h.mount({}, video.article);
  h.api.activate(video.item); assert.equal(h.grants().length, 0);
  video.desc.video = videoURL; h.api.scan(h.document); h.api.activate(video.item);
  assert.deepEqual(h.grants().map(grant => grant.url), [videoURL]); assert.equal(still.item.pending, false);
});
