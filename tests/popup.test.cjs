"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../extension/policy.js");
const source = fs.readFileSync(require.resolve("../extension/popup.js"), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const read = deferred();
  const error = { hidden: true, textContent: "" };
  const inputs = ["a", "c", "b"].map(id => ({
    id, checked: true, disabled: true,
    addEventListener(type, listener) { assert.equal(type, "change"); this.change = listener; },
  }));
  let changed;
  let write = async () => {};
  const writes = [];
  vm.runInNewContext(source, {
    XMFPolicy: policy,
    document: {
      querySelectorAll(selector) { assert.equal(selector, "input"); return inputs; },
      getElementById(id) { assert.equal(id, "error"); return error; },
    },
    chrome: { storage: {
      local: {
        get(key) { assert.equal(key, "filters"); return read.promise; },
        set(value) { writes.push(JSON.parse(JSON.stringify(value))); return write(value); },
      },
      onChanged: { addListener(listener) { changed = listener; } },
    } },
  }, { filename: "popup.js" });
  return {
    read, error, inputs, writes,
    settings: () => Object.fromEntries(inputs.map(input => [input.id, input.checked])),
    changed: (changes, area = "local") => changed(changes, area),
    setWriter(fn) { write = fn; },
    toggle(id) {
      const input = inputs.find(input => input.id === id);
      assert.equal(input.disabled, false);
      input.checked = !input.checked;
      return input.change();
    },
  };
}

test("startup stays disabled and ON until saved preferences load", async () => {
  for (const [raw, expected] of [
    [{}, { a: false, c: false, b: true }],
    [{ filters: { a: true, b: false } }, { a: true, c: true, b: false }],
  ]) {
    const h = harness();
    assert.deepEqual(h.settings(), { a: true, c: true, b: true });
    assert.ok(h.inputs.every(input => input.disabled));
    h.read.resolve(raw);
    await flush();
    assert.deepEqual(h.settings(), expected);
    assert.ok(h.inputs.every(input => !input.disabled));
    assert.equal(h.error.hidden, true);
  }
});

for (const a of [false, true]) {
  test(`a newer settings event wins over a delayed initial snapshot with A=${a}`, async () => {
    const h = harness();
    const latest = { a, c: !a, b: a };
    h.changed({ filters: { newValue: latest } });
    assert.deepEqual(h.settings(), latest);
    assert.ok(h.inputs.every(input => input.disabled));
    h.read.resolve({ filters: { a: !a, c: a, b: !a } });
    await flush();
    assert.deepEqual(h.settings(), latest);
    assert.ok(h.inputs.every(input => !input.disabled));
    await h.toggle("b");
    assert.deepEqual(h.writes, [{ filters: { ...latest, b: !a } }]);
  });
}

test("irrelevant storage events do not suppress the initial snapshot; later local updates render", async () => {
  const h = harness();
  h.changed({ filters: { newValue: { a: true, c: true, b: true } } }, "sync");
  h.changed({ unrelated: { newValue: true } });
  h.read.resolve({ filters: { a: false, c: false, b: false } });
  await flush();
  assert.deepEqual(h.settings(), { a: false, c: false, b: false });
  h.changed({ filters: { newValue: { a: true, b: false } } });
  assert.deepEqual(h.settings(), { a: true, c: true, b: false });
});

test("an initial read failure keeps controls disabled and reports the read error", async () => {
  for (const updated of [false, true]) {
    const h = harness();
    if (updated) h.changed({ filters: { newValue: { a: false, c: true, b: true } } });
    h.read.reject(new Error("Unavailable"));
    await flush();
    assert.deepEqual(h.settings(), { a: !updated, c: true, b: true });
    assert.ok(h.inputs.every(input => input.disabled));
    assert.equal(h.error.hidden, false);
    assert.match(h.error.textContent, /Could not read saved filters/);
    assert.deepEqual(h.writes, []);
  }
});

test("save failure restores previous settings and permits a successful retry", async () => {
  const h = harness();
  h.read.resolve({ filters: { a: false, c: false, b: true } });
  await flush();
  const save = deferred();
  h.setWriter(() => save.promise);
  const pending = h.toggle("a");
  assert.ok(h.inputs.every(input => input.disabled));
  save.reject(new Error("Unavailable"));
  await pending;
  assert.deepEqual(h.settings(), { a: false, c: false, b: true });
  assert.ok(h.inputs.every(input => !input.disabled));
  assert.equal(h.error.hidden, false);
  assert.match(h.error.textContent, /Could not save/);
  h.setWriter(async () => {});
  await h.toggle("a");
  assert.deepEqual(h.settings(), { a: true, c: false, b: true });
  assert.equal(h.error.hidden, true);
});
