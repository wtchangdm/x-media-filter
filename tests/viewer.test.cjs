"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../extension/viewer.js"), "utf8");

// These DOM doubles exercise control flow, not native focus trapping or trusted input.
function harness({ showError = false } = {}) {
  const document = {};
  const elements = [];
  function element(tag) {
    const listeners = new Map();
    const value = {
      tag, children: [], attributes: {}, parent: null, listeners, focusCalls: [], open: false,
      get isConnected() { return this === document.documentElement || !!this.parent?.isConnected; },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...children) {
        for (const child of children) {
          child.remove();
          child.parent = this;
          this.children.push(child);
        }
      },
      contains(node) {
        for (let current = node; current; current = current.parent) if (current === this) return true;
        return false;
      },
      remove() {
        if (this.contains(document.activeElement)) document.activeElement = document.body;
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
      },
      attachShadow(options) {
        this.shadowOptions = options;
        this.shadow = element("#shadow-root");
        this.shadow.parent = this;
        return this.shadow;
      },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      fire(type, options = {}) {
        const event = {
          type, target: this, isTrusted: true, defaultPrevented: false, stopped: false,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.stopped = true; },
          ...options,
        };
        for (const listener of listeners.get(type) || []) listener(event);
        return event;
      },
      focus(options) { this.focusCalls.push(options); document.activeElement = this; },
      showModal() {
        assert.ok(this.isConnected);
        if (showError) throw new Error("showModal failed");
        this.open = true;
        this.children[0].children[0].focus();
      },
      close() { this.open = false; this.closeCalls = (this.closeCalls || 0) + 1; this.fire("close"); },
    };
    elements.push(value);
    return value;
  }
  document.createElement = element;
  document.documentElement = element("html");
  document.body = element("body");
  document.documentElement.append(document.body);
  const opener = element("a");
  document.body.append(opener);
  document.activeElement = opener;
  const sandbox = vm.createContext({ document, module: { exports: {} } });
  vm.runInContext(source, sandbox, { filename: "viewer.js" });
  assert.equal(sandbox.XMFViewer, sandbox.module.exports);
  const selected = [];
  let closed = 0;
  function create(options = {}) {
    const api = sandbox.XMFViewer.create({
      onSelect(index) { selected.push(index); }, onClose() { closed++; }, opener, ...options,
    });
    const dialog = elements.findLast(value => value.tag === "dialog");
    const [closeButton, previous, counter, next] = dialog.children[0].children;
    return { ...api, dialog, previous, next, counter, closeButton };
  }
  return { create, document, opener, elements, selected, get closed() { return closed; } };
}

test("owned modal exposes a non-void stage and accessible controls", () => {
  const h = harness();
  const viewer = h.create();
  assert.equal(viewer.host.tag, "xmf-gallery");
  assert.equal(viewer.host.parent, h.document.documentElement);
  assert.equal(viewer.host.shadowOptions.mode, "closed");
  assert.equal(viewer.dialog.open, true);
  assert.equal(viewer.dialog.attributes["aria-label"], "Media viewer");
  assert.equal(viewer.stage.tag, "div");
  assert.equal(viewer.stage.parent, viewer.dialog);
  assert.equal(viewer.closeButton.attributes["aria-label"], "Close media viewer");
  assert.equal(viewer.previous.attributes["aria-label"], "Previous image");
  assert.equal(viewer.next.attributes["aria-label"], "Next image");
  assert.equal(viewer.counter.attributes.role, "status");
  assert.equal(h.document.activeElement, viewer.closeButton);
  assert.equal(viewer.counter.textContent, "Image 0 of 0");
  assert.equal(viewer.previous.disabled, true);
  assert.equal(viewer.next.disabled, true);
});

test("navigation respects zero-based boundaries and waits for update without moving focus", () => {
  const h = harness();
  const viewer = h.create();
  const click = target => viewer.dialog.fire("click", { target });
  viewer.update({ index: 0, count: 3 });
  assert.equal(viewer.counter.textContent, "Image 1 of 3");
  click(viewer.previous);
  click(viewer.next);
  assert.deepEqual(h.selected, [1]);
  assert.equal(viewer.counter.textContent, "Image 1 of 3", "selection belongs to the caller");
  viewer.next.focus();
  viewer.update({ index: 1, count: 3 });
  assert.equal(h.document.activeElement, viewer.next);
  assert.equal(viewer.previous.disabled, false);
  assert.equal(viewer.next.disabled, false);
  click(viewer.previous);
  click(viewer.next);
  viewer.update({ index: 2, count: 3 });
  assert.equal(viewer.next.disabled, true);
  click(viewer.next);
  click(viewer.previous);
  assert.deepEqual(h.selected, [1, 0, 2, 1]);
  viewer.update({ index: 0, count: 1 });
  assert.equal(viewer.previous.disabled, true);
  assert.equal(viewer.next.disabled, true);
  viewer.update({ index: 8, count: 3 });
  assert.equal(viewer.counter.textContent, "Image 3 of 3");
  viewer.update({ index: -8, count: 3 });
  assert.equal(viewer.counter.textContent, "Image 1 of 3");
  viewer.update({ index: NaN, count: -1 });
  assert.equal(viewer.counter.textContent, "Image 0 of 0");
});

test("only trusted buttons and arrow keys request selection; keys do not bubble", () => {
  const h = harness();
  const viewer = h.create();
  viewer.update({ index: 1, count: 3 });
  viewer.dialog.fire("click", { target: viewer.next, isTrusted: false });
  viewer.dialog.fire("click", { target: viewer.stage });
  viewer.dialog.fire("keydown", { key: "ArrowRight", isTrusted: false });
  assert.deepEqual(h.selected, []);
  for (const key of ["ArrowLeft", "ArrowRight"]) {
    const event = viewer.dialog.fire("keydown", { key });
    assert.equal(event.stopped, true);
    assert.equal(event.defaultPrevented, true);
  }
  assert.deepEqual(h.selected, [0, 2]);
  for (const type of ["keydown", "keyup", "keypress"]) {
    const event = viewer.dialog.fire(type, { key: "Tab" });
    assert.equal(event.stopped, true);
    assert.equal(event.defaultPrevented, false, "preserve native Tab focus traversal");
  }
  viewer.dialog.fire("keyup", { key: "ArrowRight" });
  viewer.update({ index: 0, count: 3 });
  viewer.dialog.fire("keydown", { key: "ArrowLeft" });
  viewer.update({ index: 2, count: 3 });
  viewer.dialog.fire("keydown", { key: "ArrowRight" });
  assert.deepEqual(h.selected, [0, 2]);
});

test("Close and native Escape cancel request closure, without closing independently", () => {
  const h = harness();
  const viewer = h.create();
  viewer.dialog.fire("click", { target: viewer.closeButton, isTrusted: false });
  const untrusted = viewer.dialog.fire("cancel", { isTrusted: false });
  assert.equal(untrusted.defaultPrevented, true);
  assert.equal(h.closed, 0);
  viewer.dialog.fire("click", { target: viewer.closeButton });
  const cancel = viewer.dialog.fire("cancel");
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(cancel.stopped, true);
  assert.equal(h.closed, 2);
  assert.equal(viewer.dialog.open, true);
  viewer.destroy();
  assert.equal(h.closed, 2, "teardown must not recursively call onClose");
});

test("destroy removes listeners and host, closes once, and restores connected opener", () => {
  const h = harness();
  const viewer = h.create();
  viewer.destroy();
  assert.equal(viewer.host.isConnected, false);
  assert.equal(viewer.dialog.open, false);
  assert.equal(viewer.dialog.closeCalls, 1);
  assert.equal(h.document.activeElement, h.opener);
  assert.equal(h.opener.focusCalls.length, 1);
  assert.equal(h.opener.focusCalls[0].preventScroll, true);
  for (const listeners of viewer.dialog.listeners.values()) assert.equal(listeners.size, 0);
  viewer.dialog.fire("cancel");
  viewer.dialog.fire("click", { target: viewer.closeButton });
  viewer.update({ index: 1, count: 3 });
  viewer.destroy();
  assert.equal(viewer.counter.textContent, "Image 0 of 0");
  assert.equal(viewer.dialog.closeCalls, 1);
  assert.equal(h.opener.focusCalls.length, 1);
  assert.equal(h.closed, 0);
});

for (const mode of ["disabled", "disconnected", "missing"]) {
  test(`destroy skips opener restoration when ${mode}`, () => {
    const h = harness();
    const viewer = h.create(mode === "missing" ? { opener: null } : {});
    if (mode === "disconnected") h.opener.remove();
    viewer.destroy({ restoreFocus: mode !== "disabled" });
    assert.equal(h.opener.focusCalls.length, 0);
    assert.equal(viewer.host.isConnected, false);
  });
}

test("showModal failure leaves no host or listeners and preserves the original error", () => {
  const h = harness({ showError: true });
  assert.throws(() => h.create(), /showModal failed/);
  assert.deepEqual(h.document.documentElement.children, [h.document.body]);
  const dialog = h.elements.find(value => value.tag === "dialog");
  for (const listeners of dialog.listeners.values()) assert.equal(listeners.size, 0);
  assert.equal(h.opener.focusCalls.length, 0);
  assert.equal(h.closed, 0);
});
