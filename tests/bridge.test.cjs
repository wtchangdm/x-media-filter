"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the real MAIN-world handler with synthetic DOM/React hosts, not live X/browser proof.
const source = fs.readFileSync(require.resolve("../extension/bridge.js"), "utf8");
const swipeSelector = '[data-testid="swipe-to-dismiss"]';

function harness(target) {
  let listener;
  const broadcasts = [], messages = [], queries = [];
  const sandbox = vm.createContext({
    URL, location: new URL("https://x.com/author/status/123/photo/1"),
    window: { postMessage(...args) { broadcasts.push(args); }, fetch() {} },
    addEventListener() {},
    MessageChannel: class {
      constructor() {
        this.port1 = { postMessage(...args) { messages.push(args); } };
        this.port2 = {};
      }
    },
    XMLHttpRequest: class { open() {} send() {} },
    document: {
      addEventListener(type, callback) { assert.equal(type, "xmf-viewer-v1"); listener = callback; },
      querySelector(selector) { queries.push(selector); return target; },
    },
  });
  vm.runInContext(source, sandbox, { filename: "bridge.js", timeout: 1000 });
  assert.equal(typeof listener, "function");
  return { request() {
    listener({ target });
    // Assert outside the handler's catch so a swallowed assertion cannot hide leakage.
    assert.deepEqual(broadcasts, [], "viewer metadata must not be broadcast to the page");
    assert.deepEqual(messages, [], "viewer lookup must not use the metadata port");
    assert.deepEqual(queries, [], "viewer lookup must use the event target, not a DOM marker query");
  } };
}

function element(props, swipe = true, children = []) {
  const node = {
    __reactProps$test: props, id: "1001", writes: [], parentElement: null, children,
    matches(selector) { assert.equal(selector, swipeSelector); return swipe; },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    },
    setAttribute(name, value) { this.writes.push([name, value]); },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function props(mediaId) { return { children: { props: { mediaDetail: { id_str: mediaId } } } }; }
function expected(mediaId) { return [["data-xmf-media-id", mediaId]]; }

test("current host props win over stale alternate fiber metadata", () => {
  const target = element(props("1002"));
  target.__reactFiber$test = {
    memoizedProps: { ...props("1001"), mediaDetail: { id_str: "1001" } },
    return: { memoizedProps: { mediaDetail: { id_str: "1003" } } },
  };
  harness(target).request();
  assert.deepEqual(target.writes, expected("1002"));
});

test("viewer bridge synchronously writes only the nearest attachment scalar without leaking raw props", () => {
  const target = element({ id: "placeholder", text: "private props" });
  const nearest = element({ children: { props: {
    mediaDetail: { id_str: "1002", media_url_https: "private URL", owner: { text: "private owner" } },
    media: [{ id_str: "1001" }, { id_str: "1002" }],
    items: [{ text: "private post body" }],
  } } }, false, [target]);
  const ancestor = element(props("1001"), false, [nearest]);
  harness(target).request();
  assert.deepEqual(target.writes, expected("1002"));
  assert.deepEqual(nearest.writes, []);
  assert.deepEqual(ancestor.writes, []);
});

test("minimal attachment props resolve through unannotated DOM wrappers without shape or count padding", () => {
  const target = element();
  const wrapper = element(undefined, false, [target]);
  element(props("1002"), false, [wrapper]);
  harness(target).request();
  assert.deepEqual(target.writes, expected("1002"));
});

test("DOM IDs, generic prop IDs, direct mediaDetail and attachment lists are not the host attachment", () => {
  const target = element({ id: "1001", id_str: "1001", mediaDetail: { id_str: "1001" } });
  element({ children: { props: {
    id_str: "1001", media: [{ id_str: "1001" }], items: [{ mediaDetail: { id_str: "1002" } }],
  } } }, false, [target]);
  harness(target).request();
  assert.deepEqual(target.writes, []);
});

test("fiber-only attachment metadata stays unresolved", () => {
  const target = element();
  target.__reactFiber$test = { memoizedProps: { ...props("1002"), mediaDetail: { id_str: "1002" } } };
  harness(target).request();
  assert.deepEqual(target.writes, []);
});

test("ambiguous sibling containers stop traversal before reading their props or higher ancestors", () => {
  const target = element();
  const sibling = element(props("1003"));
  const container = element(undefined, false, [element(undefined, false, [target]), sibling]);
  let reads = 0;
  Object.defineProperty(container, "__reactProps$test", { get() { reads++; return props("1002"); } });
  element(props("1001"), false, [container]);
  harness(target).request();
  assert.deepEqual(target.writes, []);
  assert.equal(reads, 0);
  assert.deepEqual(sibling.writes, []);
});

test("a nearest attachment resolves below an ambiguous sibling container", () => {
  const target = element();
  const nearest = element(props("1002"), false, [target]);
  element(props("1001"), false, [nearest, element(props("1003"))]);
  harness(target).request();
  assert.deepEqual(target.writes, expected("1002"));
});

for (const id of [undefined, null, 1002, NaN, true, "", "placeholder", "-1", "1.5", "1e3", " 1002", "1002 ", "1002\n", "１２", "1".repeat(26), { id_str: "1002" }, ["1002"]]) {
  test(`nearest malformed mediaDetail id ${String(id)} cannot borrow a valid ancestor`, () => {
    const target = element();
    const nearest = element(props(id), false, [target]);
    element(props("1001"), false, [nearest]);
    harness(target).request();
    assert.deepEqual(target.writes, []);
  });
}

for (const id of ["1", "0001", "1234567890123456789012345"]) {
  test(`numeric-string scalar ${id} is written unchanged`, () => {
    const target = element(props(id));
    harness(target).request();
    assert.deepEqual(target.writes, expected(id));
  });
}

for (const depth of [19, 20]) {
  test(`viewer bridge bounds traversal at 20 DOM hosts: media at depth ${depth}`, () => {
    const target = element();
    let ancestor = target;
    for (let index = 0; index < depth; index++) ancestor = element(undefined, false, [ancestor]);
    ancestor.__reactProps$test = props("1002");
    harness(target).request();
    assert.deepEqual(target.writes, depth < 20 ? expected("1002") : []);
  });
}

test("inaccessible current host props stay unresolved without consulting fibers or higher attachments", () => {
  const target = element();
  Object.defineProperty(target, "__reactProps$test", { get() { throw new Error("unavailable renderer"); } });
  target.__reactFiber$test = { memoizedProps: { mediaDetail: { id_str: "1002" } } };
  element(props("1001"), false, [target]);
  harness(target).request();
  assert.deepEqual(target.writes, []);
});

test("missing host props stay unresolved", () => {
  const target = element();
  delete target.__reactProps$test;
  harness(target).request();
  assert.deepEqual(target.writes, []);
});

test("only swipe event targets expose a scalar; child and unrelated nodes do not borrow an ancestor", () => {
  const child = element(props("1002"), false);
  const swipe = element(props("1002"), true, [child]);
  child.closest = () => swipe;
  const unrelated = element(props("1002"), false);
  for (const target of [null, {}, child, unrelated]) harness(target).request();
  assert.deepEqual(child.writes, []);
  assert.deepEqual(unrelated.writes, []);
  assert.deepEqual(swipe.writes, []);
  harness(swipe).request();
  assert.deepEqual(swipe.writes, expected("1002"));
});

test("recycled swipe nodes read current ancestor host props on every synchronous event", () => {
  const target = element();
  const host = element(props("1002"), false, [target]);
  target.__reactFiber$test = { memoizedProps: { mediaDetail: { id_str: "1002" } } };
  const h = harness(target);
  h.request();
  host.__reactProps$test = props("1001");
  h.request();
  delete host.__reactProps$test;
  h.request();
  assert.deepEqual(target.writes, [...expected("1002"), ...expected("1001")]);
});
