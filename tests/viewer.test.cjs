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
const testSource = source.slice(0, source.indexOf(marker)) + `
  globalThis.viewer = {
    items, manual, viewerIdentities, prepareViewer, inheritViewer, applySettings, context, authorize,
    message, imageState, flush, activate, viewerMediaIndex,
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

function harness(initialURL = "https://x.com/home") {
  let clock = 100000;
  let sequence = 0;
  let slides = [];
  const messages = [];
  const frames = [];
  const sandbox = vm.createContext({
    XMFPolicy: policy, URL: ChromeURL,
    chrome: { runtime: {
      getURL: path => `${extensionOrigin}/${path.replace(/^\//, "")}`,
      connect: () => ({
        postMessage(message) { messages.push(message); },
        onDisconnect: { addListener() {} }, onMessage: { addListener() {} },
      }),
    } },
    location: new URL(initialURL), innerWidth: 1000, innerHeight: 800,
    crypto: { randomUUID: () => `id-${++sequence}` },
    Date: class extends Date { static now() { return clock; } },
    // Leave scans queued: these tests exercise production handoff functions directly.
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    document: {
      documentElement: { toggleAttribute() {} },
      querySelectorAll(selector) {
        if (selector === `${dialogSelector} ${swipeSelector}`) return slides;
        assert.ok([ 'article[data-testid="tweet"]', '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="swipe-to-dismiss"]' ].includes(selector));
        return [];
      },
      createElement(tag) {
        assert.equal(tag, "iframe");
        const frame = { style: {}, contentWindow: {}, remove() { this.removed = true; } };
        frames.push(frame);
        return frame;
      },
    },
  });
  vm.runInContext(testSource, sandbox, { filename: "content.js", timeout: 1000 });
  const api = sandbox.viewer;
  function item(overrides = {}, { swipe = false, dialog = null, anchor = null, box = {} } = {}) {
    const style = {};
    const element = {
      isConnected: true,
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
      host: { dataset: {} },
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
    const value = item(overrides, { swipe: true, dialog: { isConnected: true }, ...options });
    slides = [value.element];
    return value;
  }
  return { api, item, add, prepare, navigate, selected, messages, frames,
    show(...values) { slides = values.map(value => value.element); },
    advance(ms) { clock += ms; },
  };
}

function carousel(count, padded = false) {
  const list = { getAttribute: name => name === "role" ? "list" : null };
  list.children = Array.from({ length: count + (padded ? 2 : 0) }, (_, index) => ({
    parentElement: list,
    querySelector(selector) {
      assert.equal(selector, '[aria-label="placeholder"] img[src^="data:image/svg+xml,"]');
      return padded && (index === 0 || index === list.children.length - 1) ? {} : null;
    },
  }));
  return list.children.map(slide => ({ closest: () => slide }));
}

for (const count of [1, 2, 4]) for (const padded of [false, true]) {
  test(`${count}-image ${padded ? "padded" : "unpadded"} carousel maps attachment indices, not navigation sentinels`, () => {
    const h = harness(destination), media = Array(count).fill({ poster: image });
    const elements = carousel(count, padded);
    assert.deepEqual(elements.map(e => h.api.viewerMediaIndex(e, media)),
      padded ? [-1, ...Array.from({ length: count }, (_, i) => i), -1] : Array.from({ length: count }, (_, i) => i));
  });
}

test("unknown carousel shapes and missing metadata cannot borrow the route's image index", () => {
  const h = harness(destination);
  assert.equal(h.api.viewerMediaIndex({ closest: () => null }, [{}]), -1);
  assert.equal(h.api.viewerMediaIndex(carousel(1)[0], []), -1);
  assert.equal(h.api.viewerMediaIndex(carousel(3)[1], [{}]), -1, "extra non-placeholder slides are not padding");
  const elements = carousel(1, true);
  elements[2].closest().querySelector = () => null;
  assert.equal(h.api.viewerMediaIndex(elements[1], [{}]), -1, "both padding markers are required");
  const list = elements[0].closest().parentElement;
  list.getAttribute = () => null;
  assert.equal(h.api.viewerMediaIndex(elements[1], [{}]), -1, "list semantics are required");
});

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

for (const [label, options] of [
  ["offscreen right slide", { box: { left: 1100, right: 1700 } }],
  ["offscreen left slide", { box: { left: -700, right: -100 } }],
  ["partially horizontal offscreen slide", { box: { left: -10, right: 590 } }],
  ["slide below viewport", { box: { top: 800, bottom: 1400 } }],
  ["slide above viewport", { box: { top: -600, bottom: 0 } }],
  ["zero-width slide", { box: { width: 0 } }],
  ["zero-height slide", { box: { height: 0 } }],
  ["sidebar image", { swipe: false }],
  ["viewer outside a dialog", { dialog: null }],
]) {
  test(`viewer inheritance excludes ${label}`, () => {
    const h = opened();
    const viewer = h.selected({}, options);
    h.api.inheritViewer(viewer);
    assert.equal(h.api.manual.has(viewer.identity), false);
    assert.equal(h.api.grant.dialog, null);
  });
}

test("two visible viewer occurrences are ambiguous, but offscreen siblings do not block the selected slide", () => {
  const h = opened();
  const selected = h.selected();
  const duplicate = h.selected();
  h.show(selected, duplicate);
  for (const value of [selected, duplicate]) {
    h.api.inheritViewer(value);
    assert.equal(h.api.manual.has(value.identity), false);
  }
  const offscreen = h.selected({}, { box: { left: 1100, right: 1700 } });
  h.show(selected, offscreen);
  h.api.inheritViewer(selected);
  h.api.inheritViewer(offscreen);
  assert.equal(h.api.manual.get(selected.identity), "A");
  assert.equal(h.api.manual.has(offscreen.identity), false);
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

test("final authorization remembers an explicit viewer group click without fetching offscreen slides", () => {
  const h = opened();
  const viewer = h.selected({frame: null}, {box: {left: 1100, right: 1700}});
  h.api.authorize(viewer, false);
  assert.equal(h.api.manual.has(viewer.identity), false, "automatic eligibility is not a group click");
  h.api.authorize(viewer, true);
  assert.equal(h.api.manual.get(viewer.identity), "A", "direct viewer selection retains group authorization");
  assert.equal(viewer.pending, undefined, "no worker grant was attempted");
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

test("a direct viewer group click tracks selected and offscreen slides and revokes both on exit", () => {
  const h = harness(destination);
  const dialog = { isConnected: true };
  const first = track(h, h.selected({ frame: null }, { dialog }));
  const second = track(h, h.selected({ frame: null, mediaIndex: 1, poster: secondImage },
    { dialog, box: { left: 1100, right: 1700 } }));
  h.show(first, second);
  h.api.activate(first);
  assert.equal(h.api.grant, null, "direct clicks do not need an inherited handoff");
  for (const item of [first, second]) {
    assert.equal(h.api.manual.get(item.identity), "A");
    assert.ok(h.api.viewerIdentities.has(item.identity));
  }
  assert.equal(first.pending, true);
  assert.ok(!second.pending, "offscreen group members must not fetch");
  assert.equal(h.messages.filter(message => message.type === "grant").length, 1);
  h.navigate(destination.replace("/photo/1", ""));
  for (const item of [first, second]) {
    assert.equal(h.api.manual.has(item.identity), false);
    assert.equal(item.pending, false);
    assert.equal(item.frame, null);
  }
  assert.equal(h.api.viewerIdentities.size, 0);
});

test("stable identity upgrades retain viewer tracking so same-status exit revokes the upgraded grant", () => {
  const h = harness(destination);
  const item = track(h, h.selected({ frame: null }, { box: { left: 1100, right: 1700 } }));
  item.identity = `${item.base}|${item.occurrence}`;
  h.api.authorize(item, true);
  const previousIdentity = item.identity;
  item.occurrence = "react:stable-viewer";
  h.api.flush();
  assert.notEqual(item.identity, previousIdentity);
  assert.equal(item.identity, `${item.base}|react:stable-viewer`);
  assert.equal(h.api.manual.has(previousIdentity), false);
  assert.equal(h.api.viewerIdentities.has(previousIdentity), false);
  assert.equal(h.api.manual.get(item.identity), "A");
  assert.ok(h.api.viewerIdentities.has(item.identity));
  h.navigate(destination.replace("/photo/1", ""));
  assert.equal(h.api.manual.has(item.identity), false);
  assert.equal(h.api.viewerIdentities.size, 0);
});

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
