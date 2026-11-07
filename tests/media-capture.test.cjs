"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function capture(call = async () => ({result: {value: {width: 100}}})) {
  const {MediaCapture} = await import("./media-capture.mjs");
  return Object.assign(Object.create(MediaCapture.prototype), {
    root: "page", sessions: new Map([["page", 1], ["player", null], ["worker", null]]),
    workerSessions: new Set(["worker"]), requests: new Map(), cdp: {call},
  });
}

test("renderer inspection follows only the current default execution context", async () => {
  const calls = [];
  const c = await capture(async (method, params, session) => {
    calls.push({method, context: params.contextId, session});
    return {result: {value: {width: 100}}};
  });
  const event = (method, params) => c.event({method: "Runtime." + method, params, sessionId: "player"});
  assert.deepEqual(await c.player(), []);
  event("executionContextCreated", {context: {id: 2, auxData: {isDefault: false}}});
  assert.deepEqual(await c.player(), [], "isolated worlds are not renderer contexts");
  event("executionContextCreated", {context: {id: 3, auxData: {isDefault: true}}});
  event("executionContextDestroyed", {executionContextId: 2});
  assert.equal((await c.player()).length, 1);
  assert.deepEqual(calls, [{method: "Runtime.evaluate", context: 3, session: "player"}]);
  event("executionContextDestroyed", {executionContextId: 3});
  assert.deepEqual(await c.player(), []);
  event("executionContextCreated", {context: {id: 4, auxData: {isDefault: true}}});
  event("executionContextsCleared", {});
  assert.deepEqual(await c.player(), []);
});

test("revocation between inspection and evaluation cannot wait for a replacement context", async () => {
  const c = await capture(async (_method, params) => {
    assert.equal(params.contextId, 3);
    throw new Error("Cannot find context with specified id");
  });
  c.sessions.set("player", 3);
  assert.deepEqual(await c.player(), []);
  c.cdp.call = async () => { throw new Error("CDP timeout: Runtime.evaluate"); };
  await assert.rejects(c.player(), /CDP timeout/, "real capture failures are not hidden");
});
