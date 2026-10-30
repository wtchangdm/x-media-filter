"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate: nextTurn } = require("node:timers/promises");

async function harness(t) {
  const { CDP } = await import("./cdp.mjs");
  class FakeWebSocket extends EventTarget {
    sent = [];
    closes = 0;
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.closes++; this.dispatchEvent(new Event("close")); }
  }
  const timers = new Map();
  let nextTimer = 0;
  t.mock.method(globalThis, "WebSocket", function () { return new FakeWebSocket(); });
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
  const cdp = new CDP("ws://127.0.0.1/devtools/test");
  return { cdp, timers, fire(id) {
    const timer = timers.get(id);
    assert.ok(timer, "timer is active");
    timers.delete(id);
    timer.callback();
  } };
}

for (const failure of ["error", "timeout"]) {
  test(`CDP handles connection ${failure} before the first caller without hiding rejection`, async t => {
    const { cdp, timers, fire } = await harness(t);
    const [[id, timer]] = timers;
    assert.equal(timer.delay, 10000);
    if (failure === "error") cdp.socket.dispatchEvent(new Event("error"));
    else fire(id);

    // Let unhandled rejections surface before attaching caller rejection handlers.
    await nextTurn();
    const message = failure === "error" ? "CDP connection failed" : "CDP connection timed out";
    let connectionError;
    await assert.rejects(cdp.ready, error => {
      connectionError = error;
      assert.equal(error.message, message);
      return true;
    });
    await assert.rejects(cdp.call("Browser.getVersion"), error => error === connectionError);
    assert.equal(timers.size, 0);
    assert.equal(cdp.pending.size, 0);
    assert.deepEqual(cdp.socket.sent, []);
    assert.equal(cdp.socket.closes, failure === "timeout" ? 1 : 0);
  });
}

test("CDP clears the connection timer on open and rejects pending calls on close", async t => {
  const { cdp, timers } = await harness(t);
  cdp.socket.dispatchEvent(new Event("open"));
  await cdp.ready;
  assert.equal(timers.size, 0);

  const first = cdp.call("Browser.getVersion");
  const second = cdp.call("Target.getTargets");
  const rejected = [
    assert.rejects(first, { message: "CDP closed" }),
    assert.rejects(second, { message: "CDP closed" }),
  ];
  await nextTurn();
  assert.equal(cdp.pending.size, 2);
  assert.equal(cdp.socket.sent.length, 2);
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [15000, 15000]);

  cdp.close();
  await Promise.all(rejected);
  assert.equal(cdp.pending.size, 0);
  assert.equal(timers.size, 0);
});
