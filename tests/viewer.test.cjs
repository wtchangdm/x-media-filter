"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../extension/policy.js");

// Offline handoff/state tests only: not browser input, rendering, or network proof.
const source = fs.readFileSync(require.resolve("../extension/content.js"), "utf8");
const marker = "  // Keep X's real anchor";
assert.ok(source.indexOf(marker) > 0, "content startup boundary must exist");
const metadataStart = source.indexOf("  function observeMetadata(data) {");
const metadataEnd = source.indexOf("  chrome.runtime.onMessage.addListener", metadataStart);
assert.ok(metadataStart > 0 && metadataEnd > metadataStart, "metadata observer boundary must exist");
const testSource = source.slice(0, source.indexOf(marker)) + source.slice(metadataStart, metadataEnd) + `
  globalThis.viewer = {
    items, manual, viewerIdentities, prepareViewer, inheritViewer, applySettings, context, authorize,
    message, imageState, flush, activate, make, observeMetadata,
    syncViewer, viewerDescriptor, selectedViewer, removeViewerSurface, posts,
    get surface() { return viewerSurface; },
    set surface(value) { viewerSurface = value; },
    set metadataPort(value) { metadataPort = value; },
    get epoch() { return epoch; },
    get handoff() { return viewerHandoff; },
    get grant() { return viewerGrant; }
  };
})();`;
const image = "https://pbs.twimg.com/media/Selected?format=jpg&name=small";
const secondImage = "https://pbs.twimg.com/media/Second?format=jpg&name=small";
const destination = "https://x.com/author/status/123/photo/1";
const swipeSelector = '[data-testid="swipe-to-dismiss"]';
const dialogSelector = '[role="dialog"]';
const photoSelector = 'a[href*="/photo/"]';
const extensionOrigin = "chrome-extension://test-extension";
// Node's URL treats extension schemes as opaque; Chrome exposes their tuple origin.
class ChromeURL extends URL {
  get origin() { return this.protocol === "chrome-extension:" ? `${this.protocol}//${this.host}` : super.origin; }
}

// A small connected tree: append moves nodes, closest/contains follow ancestry, and
// removing a stage disconnects its descendants just as native DOM replacement does.
function node(tag, attributes = {}) {
  const value = Object.assign(new EventTarget(), {
    tag, attributes, style: {}, dataset: {}, children: [], parentElement: null,
    matches(selector) {
      return selector.split(", ").some(part => part === tag ||
        part === `[role="${attributes.role}"]` || part === `[data-testid="${attributes["data-testid"]}"]`);
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
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    append(...children) {
      for (const child of children) {
        child.remove(); child.parentElement = this; this.children.push(child);
      }
    },
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    getBoundingClientRect() { return { width: 600, height: 600, left: 100, right: 700, top: 50, bottom: 650 }; },
  });
  Object.defineProperty(value, "isConnected", {
    get() { return this.rootConnected || !!this.parentElement?.isConnected; },
  });
  return value;
}

function harness(initialURL = "https://x.com/home") {
  let clock = 100000;
  let sequence = 0;
  let slides = [];
  let nativeDialog = null;
  const messages = [];
  const metadataMessages = [];
  const frames = [];
  const sandbox = vm.createContext({
    XMFPolicy: policy, URL: ChromeURL, Event,
    chrome: { runtime: {
      getURL: path => `${extensionOrigin}/${path.replace(/^\//, "")}`,
      connect: () => ({
        postMessage(message) { messages.push(message); },
        onDisconnect: { addListener() {} }, onMessage: { addListener() {} },
      }),
    } },
    location: new URL(initialURL), innerWidth: 1000, innerHeight: 800,
    getComputedStyle: () => ({ position: "static" }),
    crypto: { randomUUID: () => `id-${++sequence}` },
    Date: class extends Date { static now() { return clock; } },
    // Leave scans queued: these tests exercise production handoff functions directly.
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    document: {
      documentElement: { toggleAttribute() {} },
      querySelectorAll(selector) {
        if (selector === `${dialogSelector} ${swipeSelector}`) return slides.filter(slide => slide.isConnected);
        assert.ok([ 'article[data-testid="tweet"]', '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="swipe-to-dismiss"]' ].includes(selector));
        return selector.startsWith('[data-testid="tweetPhoto"]') ? slides.filter(slide => slide.isConnected) : [];
      },
      createElement(tag) {
        if (tag === "style") return {};
        if (tag === "button") return Object.assign(new EventTarget(), { isConnected: true });
        if (tag === "xmf-viewer") return node(tag);
        if (tag === "xmf-slot") return Object.assign(node(tag), {
          attachShadow() {
            return {
              append(first) { this.firstElementChild = first; },
              replaceChildren(first) { this.firstElementChild = first; },
            };
          },
        });
        assert.equal(tag, "iframe");
        const frame = { style: {}, contentWindow: {}, remove() { this.removed = true; } };
        frames.push(frame);
        return frame;
      },
    },
  });
  vm.runInContext(testSource, sandbox, { filename: "content.js", timeout: 1000 });
  const api = sandbox.viewer;
  api.metadataPort = { postMessage(message) { metadataMessages.push(message); } };
  function item(overrides = {}, { swipe = false, dialog = null, anchor = null, box = {} } = {}) {
    const style = {};
    const element = {
      isConnected: true,
      remove() { this.isConnected = false; },
      removeAttribute() {},
      matches(selector) { assert.equal(selector, swipeSelector); return swipe; },
      closest(selector) {
        if (selector === photoSelector) return anchor;
        assert.equal(selector, dialogSelector); return dialog;
      },
      getBoundingClientRect() {
        return { width: 600, height: 600, left: 100, right: 700, top: 50, bottom: 650, ...box };
      },
    };
    return {
      id: `item-${++sequence}`, identity: `occurrence-${sequence}`,
      kind: "image", poster: image, mediaIndex: 0, attachmentPost: "123",
      postId: "123", author: "author", boundaryNonce: 1,
      base: `base-${sequence}`, occurrence: "dom:1", localIdentity: `local-${sequence}`,
      host: { dataset: {}, remove() { this.removed = true; } },
      imageReady: true, frame: { style: {}, contentWindow: {}, remove() { this.removed = true; } }, element, style,
      button: { isConnected: true, disabled: false, textContent: "" },
      shadow: { firstElementChild: style, replaceChildren() {} },
      ...overrides,
    };
  }
  function add(overrides, options) {
    const value = item(overrides, options);
    api.items.set(value.element, value);
    return value;
  }
  function prepare(value, url = destination) { api.prepareViewer(value, new URL(url)); }
  function navigate(url) { sandbox.location = new URL(url); api.context(); }
  function selected(overrides, options = {}) {
    const dialog = Object.hasOwn(options, "dialog") ? options.dialog : { isConnected: true };
    const value = item({ isViewer: true, ...overrides }, { swipe: false, ...options, dialog });
    if (options.owned !== false) api.surface = { element: value.element, dialog, postId: value.postId, nonce: ++sequence };
    return value;
  }
  return { api, item, add, prepare, navigate, selected, messages, metadataMessages, frames,
    mount({ list = true, count = 1, dialog = nativeDialog } = {}) {
      if (!dialog) { dialog = node("div", { role: "dialog" }); dialog.rootConnected = true; }
      nativeDialog = dialog;
      const stage = node("div"); dialog.append(stage);
      const container = list ? node("div", { role: "list" }) : stage;
      if (list) stage.append(container);
      const mounted = Array.from({ length: count }, () => node("div", { "data-testid": "swipe-to-dismiss" }));
      container.append(...mounted); slides = mounted;
      return { dialog, stage, container, slides: mounted };
    },
    show(...values) { slides = values.map(value => value.element || value); },
    advance(ms) { clock += ms; },
  };
}

for (const type of ["pointerdown", "mousedown", "keydown"]) {
  test(`production slot ${type} stops blocked/loading/error input but passes decoded images to X`, () => {
    const h = harness();
    const desc = h.item();
    const element = Object.assign(desc.element, {
      style: {}, setAttribute() {}, append() {},
    });
    const item = h.api.make(element, desc);
    function check(stopped, state) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      item.host.dispatchEvent(event);
      assert.equal(event.cancelBubble, stopped, state);
      assert.equal(event.defaultPrevented, false, `${state}: preserve native default behavior`);
    }
    check(true, "blocked placeholder");
    h.api.authorize(item, true);
    assert.equal(item.pending, true);
    check(true, "pending grant");
    h.api.message({ type: "denied", id: item.id, epoch: h.api.epoch });
    assert.match(item.button.textContent, /retry/);
    check(true, "denied grant error");
    h.api.authorize(item, true);
    h.api.message({ type: "ticket", id: item.id, epoch: h.api.epoch, token: "test-ticket" });
    assert.ok(item.frame);
    check(true, "renderer loading before decode");
    h.api.imageState(imageEvent(item));
    assert.equal(item.imageReady, true);
    check(false, "decoded image allows native enlargement");
    h.api.imageState(imageEvent(item, { data: { type: "xmf-image-state", ready: false } }));
    assert.equal(item.imageReady, false);
    check(true, "renderer error restores input isolation");
  });
}

const attachments = [
  { type: "photo", poster: image, mediaId: "1001" },
  { type: "photo", poster: secondImage, mediaId: "1002" },
  { type: "video", poster: "https://pbs.twimg.com/ext_tw_video_thumb/1003/pu/img/Video.jpg", mediaId: "1003" },
];

for (const list of [true, false]) {
  for (const count of [1, 3, 5]) {
    test(`one owned surface uses the native stage (list=${list}, slides=${count}), not slide identity`, () => {
      const h = harness(destination.replace("photo/1", "photo/2"));
      h.api.observeMetadata({ posts: [{ id: "123", media: attachments }] });
      const native = h.mount({ list, count });
      // Native slides may be errors, sentinels, duplicates, or recycled assets.
      native.slides.forEach((slide, index) => {
        slide.__reactProps$test = { children: { props: { mediaDetail: { id_str: String(1001 + index) } } } };
        const img = node("img", { src: index % 2 ? image : "data:image/svg+xml,placeholder" });
        slide.append(img);
      });
      h.api.flush();
      const surface = h.api.surface;
      const item = h.api.items.get(surface.element);
      assert.equal(surface.element.tag, "xmf-viewer");
      assert.equal(surface.element.parentElement, native.stage);
      assert.equal(surface.dialog, native.dialog);
      assert.equal(surface.postId, "123");
      assert.equal(h.api.items.size, 1);
      assert.equal(item.mediaIndex, 1);
      assert.equal(item.poster, secondImage);
      assert.equal(item.isViewer, true);
      assert.equal(item.occurrence, `viewer:${surface.nonce}`);
      assert.equal(item.imageCount, 2);
      assert.match(item.button.textContent, /2 images blocked/);
      assert.equal(h.api.selectedViewer(surface.element, 1), true);
      for (const slide of native.slides) {
        assert.equal(h.api.items.has(slide), false);
        assert.equal(h.api.selectedViewer(slide, 1), false);
        assert.equal(slide.children.some(child => child.tag === "xmf-slot"), false);
      }
      assert.equal(h.metadataMessages.length, 0, "owned surface never requests a React identity");
      assert.equal(h.messages.filter(message => message.type === "grant").length, 0);
      native.container.append(...[...native.slides].reverse());
      h.api.flush();
      assert.equal(h.api.surface, surface);
      assert.equal(h.api.items.get(surface.element), item);
      assert.equal(item.poster, secondImage);
    });
  }
}

test("selection requires the owned element, current status, route ordinal and connected dialog, never geometry", () => {
  const h = harness(destination);
  const item = h.selected();
  item.element.getBoundingClientRect = () => assert.fail("selection is not a geometry decision");
  assert.equal(h.api.selectedViewer(item.element, 0), true);
  assert.equal(h.api.selectedViewer(h.item().element, 0), false);
  assert.equal(h.api.selectedViewer(item.element, 1), false);
  h.api.surface.postId = "456";
  assert.equal(h.api.selectedViewer(item.element, 0), false);
  h.api.surface.postId = "123";
  h.api.surface.dialog.isConnected = false;
  assert.equal(h.api.selectedViewer(item.element, 0), false);
});

for (const [label, media, ordinal, poster] of [
  ["missing post", null, 1, null],
  ["empty metadata", [], 1, null],
  ["missing ordinal", attachments, 4, null],
  ["video at photo ordinal", attachments, 3, null],
  ["malformed leading slot", [{}, attachments[1]], 1, null],
  ["valid slot after malformed slot", [{}, attachments[1]], 2, secondImage],
  ["duplicate assets keep their ordinals", [attachments[0], attachments[0]], 2, image],
]) {
  test(`route-owned descriptor handles ${label} without borrowing native slide metadata`, () => {
    const h = harness(destination.replace("photo/1", `photo/${ordinal}`));
    if (media) h.api.posts.set("123", { media });
    h.mount();
    h.api.flush();
    const item = h.api.items.get(h.api.surface.element);
    assert.equal(item.mediaIndex, ordinal - 1);
    assert.equal(item.poster, poster);
    assert.equal(item.kind, "image");
    assert.equal(item.video, null);
    if (!poster) {
      h.api.activate(item);
      assert.match(item.button.textContent, /waiting for X metadata/);
      assert.equal(h.messages.filter(message => message.type === "grant").length, 0);
    }
  });
}

test("metadata sanitization preserves malformed slots and late metadata replaces unresolved descriptors", () => {
  const h = harness(destination.replace("photo/1", "photo/4"));
  h.mount();
  h.api.flush();
  const surface = h.api.surface;
  const unresolved = h.api.items.get(surface.element);
  assert.equal(unresolved.poster, null);
  h.api.observeMetadata({ posts: [{ id: "123", media: [
    null, { type: "photo", poster: "https://example.com/private.jpg" },
    { type: "invalid", poster: image }, attachments[1],
  ] }] });
  const media = h.api.posts.get("123").media;
  assert.equal(media.length, 4);
  assert.equal(media[0].poster, null);
  assert.equal(media[1].poster, null);
  assert.equal(media[2].type, null);
  assert.equal(media[3].poster, secondImage);
  h.api.flush();
  const resolved = h.api.items.get(surface.element);
  assert.equal(h.api.surface, surface);
  assert.notEqual(resolved, unresolved);
  assert.equal(unresolved.host.isConnected, false);
  assert.equal(resolved.mediaIndex, 3);
  assert.equal(resolved.poster, secondImage);
  assert.equal(resolved.occurrence, unresolved.occurrence);
  assert.equal(h.messages.filter(message => message.type === "grant").length, 0);
});

test("stage replacement and lazy/reordered slides keep one owned identity without native slide grants", () => {
  const h = harness(destination);
  h.api.posts.set("123", { media: attachments });
  const first = h.mount({ count: 3 });
  h.api.flush();
  const surface = h.api.surface;
  const selected = h.api.items.get(surface.element);
  h.api.activate(selected);
  const oldId = selected.id;
  const ticket = { type: "ticket", id: oldId, epoch: h.api.epoch, token: "stale-stage" };
  first.stage.remove();
  const next = h.mount({ list: false, count: 1, dialog: first.dialog });
  h.api.flush();
  assert.equal(h.api.surface, surface);
  assert.equal(surface.element.parentElement, next.stage);
  assert.equal(h.api.items.size, 1);
  assert.equal(h.api.items.get(surface.element), selected);
  assert.notEqual(selected.id, oldId);
  assert.equal(selected.pending, true, "the retained selected grant may obtain a fresh ticket");
  h.api.message(ticket);
  assert.equal(h.frames.length, 0, "replaced-stage ticket cannot create a frame");
  const lazy = node("div", { "data-testid": "swipe-to-dismiss" });
  next.container.append(lazy);
  h.show(lazy, ...next.slides);
  h.api.flush();
  assert.equal(h.api.items.size, 1);
  assert.equal(h.api.items.get(surface.element), selected);
  assert.equal(h.api.items.has(lazy), false);
  assert.equal(h.messages.filter(message => message.type === "grant").length, 2);
});

test("a replacement dialog revokes the previous owned occurrence instead of inheriting it", () => {
  const h = harness(destination);
  h.api.posts.set("123", { media: attachments });
  const first = h.mount();
  h.api.flush();
  const oldSurface = h.api.surface;
  const oldItem = h.api.items.get(oldSurface.element);
  h.api.activate(oldItem);
  first.dialog.rootConnected = false;
  h.mount({ dialog: null });
  h.api.flush();
  assert.notEqual(h.api.surface.nonce, oldSurface.nonce);
  assert.equal(h.api.grant, null);
  assert.equal(h.api.manual.has(oldItem.identity), false);
  assert.equal(oldItem.pending, false);
  assert.equal(oldSurface.element.isConnected, false);
  assert.equal(h.api.items.size, 1);
  assert.equal(h.messages.filter(message => message.type === "grant").length, 1);
});

test("a detached dialog with no replacement removes its surface and revokes pending grants", () => {
  const h = harness(destination);
  h.api.posts.set("123", { media: attachments });
  const native = h.mount();
  h.api.flush();
  const item = h.api.items.get(h.api.surface.element);
  h.api.activate(item);
  const ticket = { type: "ticket", id: item.id, epoch: h.api.epoch, token: "closed-dialog" };
  native.dialog.rootConnected = false;
  h.api.flush();
  assert.equal(h.api.surface, null);
  assert.equal(h.api.grant, null);
  assert.equal(h.api.items.size, 0);
  assert.equal(h.api.manual.has(item.identity), false);
  assert.equal(item.pending, false);
  h.api.message(ticket);
  assert.equal(h.frames.length, 0);
});

test("automatic loading requests only the route selection and disabling eligibility revokes it", () => {
  const h = harness(destination);
  h.api.posts.set("123", { media: attachments });
  h.mount({ count: 5 });
  h.api.applySettings({ a: false, c: true, b: true });
  h.api.flush();
  const surface = h.api.surface;
  const first = h.api.items.get(surface.element);
  assert.equal(first.pending, true);
  assert.equal(h.api.grant, null, "automatic eligibility does not create a manual viewer group grant");
  assert.equal(h.api.manual.size, 0);
  h.navigate(destination.replace("photo/1", "photo/2"));
  assert.equal(first.pending, false);
  h.api.flush();
  const second = h.api.items.get(surface.element);
  assert.equal(second.pending, true);
  assert.deepEqual(h.messages.filter(message => message.type === "grant").map(message => message.url), [image, secondImage]);
  assert.ok(h.messages.filter(message => message.type === "grant").every(message => message.manual === false));
  h.api.applySettings({ a: true, c: true, b: true });
  h.api.flush();
  assert.equal(second.pending, false);
  assert.equal(second.frame, null);
  assert.equal(h.messages.filter(message => message.type === "grant").length, 2);
});

test("swipe elements in a tweet article do not locate a viewer stage", () => {
  const h = harness(destination);
  const native = h.mount();
  const article = node("article");
  native.stage.append(article);
  article.append(...native.slides);
  h.api.flush();
  assert.equal(h.api.surface, null);
  assert.equal(h.api.items.size, 0);
});

test("ambiguous native stages cannot create or authorize an owned surface", () => {
  const h = harness(destination);
  h.api.posts.set("123", { media: attachments });
  const first = h.mount();
  const second = h.mount();
  h.show(...first.slides, ...second.slides);
  h.api.flush();
  assert.equal(h.api.surface, null);
  assert.equal(h.api.items.size, 0);
  assert.equal(h.messages.filter(message => message.type === "grant").length, 0);
});

for (const stages of ["ambiguous", "absent"]) {
  for (const state of ["pending", "live"]) {
    test(`${stages} stages remove an existing ${state} manual viewer and reject delayed tickets`, () => {
      const h = harness(destination);
      h.api.posts.set("123", { media: attachments });
      const first = h.mount();
      h.api.flush();
      const surface = h.api.surface;
      const item = h.api.items.get(surface.element);
      h.api.activate(item);
      const ticket = { type: "ticket", id: item.id, epoch: h.api.epoch, token: "stale-selection" };
      assert.equal(item.pending, true);
      assert.equal(h.api.manual.get(item.identity), "A");
      if (state === "live") h.api.message(ticket);
      const frame = item.frame;
      const frameCount = h.frames.length;
      let second;
      if (stages === "ambiguous") {
        second = h.mount();
        h.show(...first.slides, ...second.slides);
      } else {
        for (const slide of first.slides) slide.remove();
      }
      assert.equal(surface.element.isConnected, true, "the old stage and dialog remain connected");
      h.api.flush();
      assert.equal(h.api.surface, null);
      assert.equal(surface.element.isConnected, false);
      assert.equal(h.api.items.size, 0);
      assert.equal(h.api.grant, null);
      assert.equal(h.api.manual.has(item.identity), false);
      assert.equal(h.api.viewerIdentities.size, 0);
      assert.equal(item.pending, false);
      assert.equal(item.frame, null);
      if (frame) assert.equal(frame.removed, true);
      assert.ok(h.messages.some(message => message.type === "revoke" && message.id === ticket.id));
      h.api.message(ticket);
      assert.equal(h.frames.length, frameCount, "a delayed ticket cannot recreate the removed renderer");
      assert.equal(h.messages.at(-1).type, "revoke");
      assert.equal(h.messages.at(-1).id, ticket.id);
      h.api.authorize(item, true);
      h.api.activate(item);
      assert.equal(h.messages.filter(message => message.type === "grant").length, 1);

      // A later unambiguous stage starts a fresh, blocked occurrence, not the old group grant.
      second?.stage.remove();
      h.show(...first.slides);
      if (stages === "absent") first.container.append(...first.slides);
      h.api.flush();
      const replacement = h.api.items.get(h.api.surface.element);
      assert.notEqual(h.api.surface.nonce, surface.nonce);
      assert.equal(replacement.pending, false);
      assert.equal(h.api.manual.has(replacement.identity), false);
      assert.equal(h.messages.filter(message => message.type === "grant").length, 1);
    });
  }
}

function opened() {
  const h = harness();
  const sourceItem = h.add();
  h.api.manual.set(sourceItem.identity, "A");
  h.prepare(sourceItem);
  h.navigate(destination);
  assert.ok(h.api.grant);
  return h;
}

test("decoded selected image hands off only on navigation to its exact destination", () => {
  const h = harness();
  const sourceItem = h.add();
  h.api.manual.set(sourceItem.identity, "A");
  h.prepare(sourceItem);
  h.api.context();
  assert.ok(h.api.handoff);
  assert.equal(h.api.grant, null, "preparing a click is not a viewer grant");
  h.navigate(destination);
  assert.equal(h.api.handoff, null);
  assert.equal(h.api.grant.path, new URL(destination).pathname);
  assert.equal(h.api.manual.has(sourceItem.identity), false, "route change clears source grants");
  const viewer = h.selected();
  h.api.inheritViewer(viewer);
  assert.equal(h.api.manual.get(viewer.identity), "A");
});

for (const [label, overrides, url] of [
  ["video", { kind: "video" }, destination],
  ["undecoded image", { imageReady: false }, destination],
  ["missing renderer", { frame: null }, destination],
  ["foreign origin", {}, destination.replace("x.com", "example.com")],
  ["different post", {}, destination.replace("123", "456")],
  ["different attachment index", {}, destination.replace("photo/1", "photo/2")],
  ["video destination", {}, destination.replace("photo/1", "video/1")],
]) {
  test(`handoff preparation rejects ${label}`, () => {
    const h = harness();
    h.prepare(h.add(overrides), url);
    assert.equal(h.api.handoff, null);
  });
}

test("handoff snapshots only authorized images in the selected occurrence and attachment group", () => {
  const h = harness();
  const selected = h.add();
  const sibling = h.add({ mediaIndex: 1, poster: secondImage });
  const excluded = [
    h.add({ mediaIndex: 2, poster: "https://pbs.twimg.com/media/Blocked.jpg" }),
    h.add({ mediaIndex: 3, attachmentPost: "456", poster: "https://pbs.twimg.com/media/Quote.jpg" }),
    h.add({ mediaIndex: 4, boundaryNonce: 2, poster: "https://pbs.twimg.com/media/Duplicate.jpg" }),
    h.add({ mediaIndex: 5, kind: "video", poster: "https://pbs.twimg.com/media/Video.jpg" }),
    h.add({ mediaIndex: 6, poster: null }),
  ];
  for (const value of [selected, sibling, ...excluded.slice(1)]) h.api.manual.set(value.identity, "A");
  h.prepare(selected);
  assert.deepEqual([...h.api.handoff.assets].sort(), [
    `0|${policy.assetKey(image)}`, `1|${policy.assetKey(secondImage)}`,
  ]);
});

test("unblocked images can hand off without a manual grant; unknown classification remains blocked", () => {
  const h = harness("https://x.com/author/status/123");
  h.api.applySettings({ a: false, c: true, b: true });
  const selected = h.add();
  h.add({ postId: "456", mediaIndex: 1, poster: secondImage });
  h.prepare(selected);
  assert.deepEqual([...h.api.handoff.assets], [`0|${policy.assetKey(image)}`]);
});

for (const [label, url] of [
  ["another index on the same route", destination.replace("photo/1", "photo/2")],
  ["another handle on the same status route", destination.replace("author", "other")],
  ["another status", destination.replace("123", "456")],
  ["the status without its viewer", destination.replace("/photo/1", "")],
]) {
  test(`pending handoff is consumed without authorization on ${label}`, () => {
    const h = harness();
    const sourceItem = h.add();
    h.api.manual.set(sourceItem.identity, "A");
    h.prepare(sourceItem);
    h.navigate(url);
    assert.equal(h.api.handoff, null);
    assert.equal(h.api.grant, null);
    h.navigate(destination);
    assert.equal(h.api.grant, null, "later navigation cannot revive a mismatched handoff");
  });
}

test("pending handoff and unmounted viewer grant expire after five seconds", () => {
  const pending = harness();
  pending.prepare(pending.add());
  pending.advance(5001);
  pending.navigate(destination);
  assert.equal(pending.api.handoff, null);
  assert.equal(pending.api.grant, null);
  const mountedLate = opened();
  mountedLate.advance(5001);
  mountedLate.api.context();
  assert.equal(mountedLate.api.grant, null);
  const viewer = mountedLate.selected();
  mountedLate.api.inheritViewer(viewer);
  assert.equal(mountedLate.api.manual.has(viewer.identity), false);
});

for (const [label, overrides, options] of [
  ["native swipe slide", { isViewer: false }, { swipe: true, owned: false }],
  ["sidebar copy", { isViewer: false }, { owned: false }],
  ["unowned duplicate surface", {}, { owned: false }],
  ["disconnected dialog", {}, { dialog: { isConnected: false } }],
  ["viewer outside a dialog", {}, { dialog: null }],
]) {
  test(`viewer inheritance excludes ${label}`, () => {
    const h = opened();
    h.selected();
    const viewer = h.selected(overrides, options);
    h.api.inheritViewer(viewer);
    assert.equal(h.api.manual.has(viewer.identity), false);
    assert.equal(h.api.grant.dialog, null);
  });
}

test("owned viewer inherits despite empty or animated geometry; visible native duplicates cannot", () => {
  const h = opened();
  const selected = h.selected({}, { box: { width: 0, height: 0, left: 1100, right: 1700 } });
  const duplicate = h.selected({}, { owned: false });
  h.api.inheritViewer(duplicate);
  h.api.inheritViewer(selected);
  assert.equal(h.api.manual.get(selected.identity), "A");
  assert.equal(h.api.manual.has(duplicate.identity), false);
});

test("gallery permits only snapshotted asset/index pairs in the original live dialog", () => {
  const h = harness();
  const first = h.add();
  const second = h.add({ mediaIndex: 1, poster: secondImage });
  for (const value of [first, second]) h.api.manual.set(value.identity, "A");
  h.prepare(first);
  h.navigate(destination);
  const dialog = { isConnected: true };
  const initial = h.selected({}, { dialog });
  h.api.inheritViewer(initial);
  assert.equal(h.api.manual.get(initial.identity), "A");
  h.advance(6000);
  h.navigate(destination.replace("photo/1", "photo/2"));
  assert.ok(h.api.grant, "a bound live dialog survives the pending timeout and gallery navigation");
  const next = h.selected({ mediaIndex: 1, poster: secondImage.replace("small", "orig") }, { dialog });
  h.api.inheritViewer(next);
  assert.equal(h.api.manual.get(next.identity), "A", "renditions of the authorized asset are equivalent");
  for (const overrides of [
    { mediaIndex: 1, poster: image },
    { mediaIndex: 0, poster: secondImage },
    { mediaIndex: 2, poster: "https://pbs.twimg.com/media/Other.jpg" },
    { attachmentPost: "456" },
    { kind: "video" },
    { poster: null },
  ]) {
    const rejected = h.selected(overrides, { dialog });
    h.api.inheritViewer(rejected);
    assert.equal(h.api.manual.has(rejected.identity), false, JSON.stringify(overrides));
  }
  const otherDialog = h.selected();
  h.api.inheritViewer(otherDialog);
  assert.equal(h.api.manual.has(otherDialog.identity), false);
  dialog.isConnected = false;
  h.api.context();
  assert.equal(h.api.grant, null);
});

for (const url of ["https://x.com/author/status/123", "https://x.com/author/status/123/video/1", "https://x.com/other/status/456/photo/1"]) {
  test(`leaving the photo viewer revokes handoff state: ${new URL(url).pathname}`, () => {
    const h = opened();
    h.api.inheritViewer(h.selected());
    h.navigate(url);
    assert.equal(h.api.grant, null);
  });
}

test("final authorization cannot fetch an unowned surface even with an explicit manual grant", () => {
  const h = opened();
  h.selected();
  const viewer = h.selected({ frame: null }, { owned: false });
  h.api.authorize(viewer, false);
  assert.equal(h.api.manual.has(viewer.identity), false);
  h.api.authorize(viewer, true);
  assert.equal(h.api.manual.get(viewer.identity), "A");
  assert.equal(viewer.pending, undefined, "no worker grant was attempted");
  assert.equal(h.messages.filter(message => message.type === "grant").length, 0);
});

test("a still-visible previous slide cannot inherit the next photo's authorization during animation", () => {
  const h = opened();
  h.api.inheritViewer(h.selected());
  h.navigate(destination.replace("photo/1", "photo/2"));
  const previous = h.selected();
  h.api.inheritViewer(previous);
  assert.equal(h.api.manual.has(previous.identity), false);
});

for (const phase of ["pending", "bound"]) {
  test(`enabling the relevant filter revokes ${phase} viewer authorization`, () => {
    const h = harness();
    h.api.applySettings({ a: false, c: false, b: false });
    const sourceItem = h.add();
    h.prepare(sourceItem);
    let viewer;
    if (phase === "bound") {
      h.navigate(destination);
      viewer = track(h, h.selected());
      h.api.inheritViewer(viewer);
      assert.equal(h.api.manual.get(viewer.identity), "A");
    }
    h.api.applySettings({ a: false, c: false, b: true });
    assert.ok(phase === "pending" ? h.api.handoff : h.api.grant, "unrelated filter leaves A authorization intact");
    h.api.applySettings({ a: true, c: false, b: true });
    assert.equal(h.api.handoff, null);
    assert.equal(h.api.grant, null);
    if (viewer) {
      assert.equal(h.api.manual.has(viewer.identity), false);
      assert.equal(h.api.viewerIdentities.size, 0);
      assert.equal(viewer.frame, null);
      assert.equal(viewer.imageReady, false);
    }
    h.navigate(destination);
    const later = h.selected();
    h.api.inheritViewer(later);
    assert.equal(h.api.manual.has(later.identity), false);
  });
}

function track(h, item) {
  h.api.items.set(item.element, item);
  return item;
}

function imageEvent(item, overrides = {}) {
  return { isTrusted: true, origin: extensionOrigin, source: item.frame.contentWindow,
    data: { type: "xmf-image-state", ready: true }, ...overrides };
}

function focusTarget() {
  return { calls: [], focus(options) { this.calls.push(options); } };
}

for (const state of ["live", "pending"]) {
  test(`closing to the same status revokes a ${state} inherited viewer without revoking inline manual media`, () => {
    const statusURL = destination.replace("/photo/1", "");
    const h = harness(statusURL);
    const inline = h.add();
    const inlineFrame = inline.frame;
    h.api.manual.set(inline.identity, "A");
    h.prepare(inline);
    const epoch = h.api.epoch;
    h.navigate(destination);
    const viewer = track(h, h.selected({ frame: null, imageReady: false }));
    h.api.inheritViewer(viewer);
    assert.ok(h.api.viewerIdentities.has(viewer.identity));
    h.api.authorize(viewer);
    assert.equal(viewer.pending, true);
    const ticket = { type: "ticket", id: viewer.id, epoch, token: "old-ticket" };
    if (state === "live") h.api.message(ticket);
    const viewerFrame = viewer.frame;
    const frameCount = h.frames.length;
    h.navigate(statusURL);
    assert.equal(h.api.epoch, epoch, "this must exercise same-route cleanup, not epoch invalidation");
    assert.equal(h.api.grant, null);
    assert.equal(h.api.viewerIdentities.size, 0);
    assert.equal(h.api.manual.has(viewer.identity), false);
    assert.equal(h.api.manual.get(inline.identity), "A");
    assert.equal(inline.frame, inlineFrame);
    assert.equal(inlineFrame.removed, undefined);
    assert.equal(viewer.frame, null);
    assert.equal(viewer.pending, false);
    assert.equal(viewer.imageReady, false);
    assert.equal(viewer.button.disabled, false);
    assert.notEqual(viewer.id, ticket.id);
    if (viewerFrame) assert.equal(viewerFrame.removed, true);
    assert.ok(h.messages.some(message => message.type === "revoke" && message.id === ticket.id));
    h.api.message(ticket);
    assert.equal(h.frames.length, frameCount, "a delayed old ticket must not create an iframe");
    assert.equal(viewer.frame, null);
    assert.equal(h.messages.at(-1).type, "revoke");
    assert.equal(h.messages.at(-1).id, ticket.id);
  });
}

for (const revoke of ["exit", "settings"]) {
  test(`direct group click requests only the route-selected asset, including lazy navigation; revoked on ${revoke}`, () => {
    const h = harness(destination);
    h.api.posts.set("123", { media: attachments });
    const native = h.mount({ count: 3 });
    h.api.flush();
    const surface = h.api.surface;
    const first = h.api.items.get(surface.element);
    h.api.activate(first);
    assert.deepEqual([...h.api.grant.assets], attachments.slice(0, 2).map((media, index) => `${index}|${policy.assetKey(media.poster)}`));
    assert.equal(h.api.grant.dialog, native.dialog);
    assert.equal(h.api.items.size, 1);
    assert.equal(h.messages.filter(message => message.type === "grant").length, 1);
    assert.equal(h.messages.find(message => message.type === "grant").url, image);
    const oldTicket = { type: "ticket", id: first.id, epoch: h.api.epoch, token: "previous-photo" };

    h.navigate(destination.replace("photo/1", "photo/2"));
    assert.equal(first.pending, false, "route change revokes the preceding selection synchronously");
    h.api.message(oldTicket);
    assert.equal(h.frames.length, 0);
    // No matching native asset is needed: X may retain only a previous slide or SVG sentinel.
    native.slides[0].__reactProps$test = { children: { props: { mediaDetail: { id_str: "1001" } } } };
    h.show(native.slides[0]);
    h.api.flush();
    const second = h.api.items.get(surface.element);
    assert.notEqual(second, first);
    assert.equal(second.poster, secondImage);
    assert.equal(second.mediaIndex, 1);
    assert.equal(second.pending, true);
    assert.ok(h.api.viewerIdentities.has(second.identity));
    assert.equal(h.api.items.size, 1);
    assert.deepEqual(h.messages.filter(message => message.type === "grant").map(message => message.url), [image, secondImage]);

    // Returning to a photo still creates a ticket for that single selection, not its siblings.
    h.navigate(destination);
    h.api.flush();
    const returned = h.api.items.get(surface.element);
    assert.equal(returned.mediaIndex, 0);
    assert.deepEqual(h.messages.filter(message => message.type === "grant").map(message => message.url), [image, secondImage, image]);
    if (revoke === "exit") h.navigate(destination.replace("/photo/1", ""));
    else {
      h.api.applySettings({ a: false, c: true, b: true });
      h.api.applySettings({ a: true, c: true, b: true });
    }
    assert.equal(h.api.grant, null);
    assert.equal(h.api.viewerIdentities.size, 0);
    for (const item of [first, second, returned]) {
      assert.equal(h.api.manual.has(item.identity), false);
      assert.equal(item.pending, false);
      assert.equal(item.frame, null);
    }
    if (revoke === "exit") assert.equal(h.api.surface, null);
    else {
      h.api.flush();
      assert.equal(h.messages.filter(message => message.type === "grant").length, 3);
    }
  });
}

for (const state of ["blocked", "pending", "live"]) {
  test(`cross-status navigation at the same ordinal removes a ${state} viewer before queued scans`, () => {
    const h = harness(destination);
    h.api.posts.set("123", { media: attachments });
    h.api.posts.set("456", { media: [attachments[1]] });
    h.mount();
    h.api.flush();
    const surface = h.api.surface;
    const item = h.api.items.get(surface.element);
    if (state !== "blocked") h.api.activate(item);
    const ticket = { type: "ticket", id: item.id, epoch: h.api.epoch, token: "previous-status" };
    if (state === "live") h.api.message(ticket);
    const frame = item.frame;
    const frameCount = h.frames.length;
    const grantCount = h.messages.filter(message => message.type === "grant").length;
    h.navigate(destination.replace("/123/", "/456/"));
    assert.equal(h.api.surface, null, "context removes the old surface synchronously, without flush");
    assert.equal(surface.element.isConnected, false);
    assert.equal(h.api.items.size, 0);
    assert.equal(h.api.selectedViewer(item.element, 0), false);
    assert.equal(h.api.grant, null);
    assert.equal(h.api.manual.has(item.identity), false);
    assert.equal(h.api.viewerIdentities.size, 0);
    assert.equal(item.pending, false);
    assert.equal(item.frame, null);
    if (frame) assert.equal(frame.removed, true);
    h.api.authorize(item, true);
    h.api.message(ticket);
    assert.equal(h.frames.length, frameCount);
    assert.equal(h.messages.filter(message => message.type === "grant").length, grantCount,
      "a manual authorization before the queued scan cannot fetch the previous status asset");
    h.api.flush();
    const replacement = h.api.items.get(h.api.surface.element);
    assert.notEqual(h.api.surface.nonce, surface.nonce);
    assert.equal(h.api.surface.postId, "456");
    assert.equal(replacement.poster, secondImage);
    assert.equal(replacement.mediaIndex, 0);
    assert.equal(replacement.pending, false);
    h.api.activate(item);
    assert.equal(h.messages.filter(message => message.type === "grant").length, grantCount,
      "a stale click cannot authorize the new occurrence either");
  });
}

for (const surface of ["inline anchor", "dialog Close"]) {
  test(`validated ready state restores focused renderer to the native ${surface}`, () => {
    const h = harness(destination);
    const target = focusTarget();
    const item = h.add({ imageReady: false }, surface === "inline anchor"
      ? { anchor: target }
      : { dialog: { querySelector(selector) {
        assert.equal(selector, 'button[aria-label="Close"]'); return target;
      } } });
    item.shadow.activeElement = item.frame;
    h.api.imageState(imageEvent(item));
    assert.equal(item.imageReady, true);
    assert.equal(item.frame.style.pointerEvents, "none");
    assert.equal(item.frame.tabIndex, -1);
    assert.equal(target.calls.length, 1);
    assert.equal(target.calls[0].preventScroll, true);
    h.api.imageState(imageEvent(item, { data: { type: "xmf-image-state", ready: false } }));
    assert.equal(item.imageReady, false);
    assert.equal(item.frame.style.pointerEvents, "auto");
    assert.equal(item.frame.tabIndex, 0);
    assert.equal(target.calls.length, 1, "failed images restore Retry access without moving focus");
  });
}

for (const active of [null, "other control"]) {
  test(`background image readiness does not steal focus when shadow focus is ${active}`, () => {
    const h = harness();
    const target = focusTarget();
    const item = h.add({ imageReady: false }, { anchor: target });
    item.shadow.activeElement = active === null ? null : {};
    h.api.imageState(imageEvent(item));
    assert.equal(item.imageReady, true);
    assert.equal(item.frame.style.pointerEvents, "none");
    assert.equal(item.frame.tabIndex, -1);
    assert.equal(target.calls.length, 0);
  });
}

for (const [label, override, itemOverride] of [
  ["untrusted event", { isTrusted: false }],
  ["page origin", { origin: "https://x.com" }],
  ["foreign extension origin", { origin: "chrome-extension://other-extension" }],
  ["opaque origin", { origin: "null" }],
  ["foreign source", { source: {} }],
  ["missing source", { source: null }],
  ["wrong message type", { data: { type: "xmf-other", ready: true } }],
  ["nonboolean readiness", { data: { type: "xmf-image-state", ready: "true" } }],
  ["missing readiness", { data: { type: "xmf-image-state" } }],
  ["missing data", { data: null }],
  ["video renderer", {}, { kind: "video" }],
]) {
  test(`image state rejects ${label} without changing readiness, input, or focus`, () => {
    for (const ready of [false, true]) {
      const h = harness();
      const target = focusTarget();
      const item = h.add({ imageReady: ready, ...itemOverride }, { anchor: target });
      item.shadow.activeElement = item.frame;
      item.frame.style.pointerEvents = ready ? "none" : "auto";
      item.frame.tabIndex = ready ? -1 : 0;
      const before = { ready: item.imageReady, pointer: item.frame.style.pointerEvents, tab: item.frame.tabIndex };
      h.api.imageState(imageEvent(item, { data: { type: "xmf-image-state", ready: !ready }, ...override }));
      assert.deepEqual({ ready: item.imageReady, pointer: item.frame.style.pointerEvents, tab: item.frame.tabIndex }, before);
      assert.equal(target.calls.length, 0);
    }
  });
}

test("disconnected and replaced image renderers cannot deliver readiness or focus", () => {
  for (const stale of ["disconnected", "replaced"]) {
    const h = harness();
    const target = focusTarget();
    const item = h.add({ imageReady: false }, { anchor: target });
    item.shadow.activeElement = item.frame;
    const event = imageEvent(item);
    if (stale === "disconnected") item.element.isConnected = false;
    else item.frame = { style: {}, contentWindow: {} };
    h.api.imageState(event);
    assert.equal(item.imageReady, false);
    assert.equal(item.frame.style.pointerEvents, undefined);
    assert.equal(item.frame.tabIndex, undefined);
    assert.equal(target.calls.length, 0);
  }
});
