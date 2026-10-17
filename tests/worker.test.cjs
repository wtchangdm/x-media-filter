"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Protocol tests, not proof of Chrome's network barrier or media playback.
const extension = path.join(__dirname, "../extension");
const workerSource = fs.readFileSync(path.join(extension, "worker.js"), "utf8");
const policySource = fs.readFileSync(path.join(extension, "policy.js"), "utf8");
const extensionId = "xmf-test-extension";
const extensionURL = `chrome-extension://${extensionId}/`;
const routeURL = "https://x.com/author/status/123";
const image = "https://pbs.twimg.com/media/Selected?format=jpg&name=small";
const video = "https://video.twimg.com/amplify_video/123/vid/640x360/Selected.mp4?tag=12";
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    dispatch(...args) { return listeners.map(listener => listener(...args)); },
  };
}

function harness({ raw = {}, storageRead, ruleError = false, documentAlive = true } = {}) {
  const onConnect = event();
  const onChanged = event();
  const tabs = new Map([[1, { id: 1, url: routeURL }], [2, { id: 2, url: routeURL }]]);
  const storageKeys = [];
  const tabReads = [];
  let clock = 100000;
  let tokenCounter = 0;
  let readTab = async id => {
    if (!tabs.has(id)) throw new Error("No such tab");
    return clone(tabs.get(id));
  };
  const chrome = {
    runtime: { id: extensionId, getURL: file => extensionURL + file, onConnect },
    storage: {
      local: {
        get(key) {
          storageKeys.push(key);
          return storageRead ? storageRead(key) : Promise.resolve(raw);
        },
      },
      onChanged,
    },
    tabs: {
      get(id) { tabReads.push(id); return readTab(id); },
      async sendMessage(id, msg, options) {
        assert.equal(typeof options.documentId, 'string');
        if (!documentAlive) throw new Error('The document no longer exists');
        return {route: msg.route, epoch: msg.epoch};
      },
    },
    declarativeNetRequest: {async updateSessionRules(rules) {
      assert.equal(rules.addRules[0].condition.responseHeaders[0].header, 'location');
      assert.equal(rules.addRules[0].condition.initiatorDomains[0], extensionId);
      if (ruleError) throw new Error('Rule installation denied');
    }},
  };
  const context = vm.createContext({
    chrome, URL,
    crypto: { randomUUID: () => `token-${++tokenCounter}` },
    Date: class extends Date { static now() { return clock; } },
    importScripts(file) {
      assert.equal(file, "policy.js");
      vm.runInContext(policySource, context, { filename: "policy.js", timeout: 1000 });
    },
  });
  vm.runInContext(workerSource, context, { filename: "worker.js", timeout: 1000 });

  function connect(name, sender) {
    const port = {
      name, sender, disconnected: false, messages: [],
      onMessage: event(), onDisconnect: event(),
      postMessage(message) {
        if (this.disconnected) throw new Error("Disconnected port");
        this.messages.push(clone(message));
      },
      disconnect() {
        if (this.disconnected) return;
        this.disconnected = true;
        this.onDisconnect.dispatch();
      },
      async send(message) {
        assert.equal(this.disconnected, false, "cannot send on a disconnected mock port");
        await Promise.all(this.onMessage.dispatch(clone(message)));
      },
      ofType(type) { return this.messages.filter(message => message.type === type); },
    };
    onConnect.dispatch(port);
    return port;
  }
  return {
    tabs, storageKeys, tabReads, connect,
    coordinator(overrides = {}) {
      return connect("coordinator", {
        id: extensionId, tab: { id: 1 }, frameId: 0,
        documentId: "document-1", url: routeURL, ...overrides,
      });
    },
    player(overrides = {}) {
      return connect("player", {
        id: extensionId, tab: { id: 1 }, frameId: 1,
        documentId: "player-document", url: `${extensionURL}player.html`, ...overrides,
      });
    },
    async settings(value, area = "local") {
      await Promise.all(onChanged.dispatch({ filters: { newValue: value } }, area));
    },
    setTabReader(reader) { readTab = reader; },
    advance(ms) { clock += ms; },
  };
}

async function coordinator(h, overrides) {
  const port = h.coordinator(overrides);
  await port.send({ type: "context", route: "status:123", epoch: "page-1" });
  await flush();
  return port;
}

function grant(port, overrides = {}) {
  return port.send({
    type: "grant", id: "post-123:image-0:occurrence-1", epoch: "page-1",
    url: image, kind: "image", poster: "https://pbs.twimg.com/amplify_video_thumb/123/img/Poster.jpg", category: "A", manual: true, ...overrides,
  });
}

async function ticket(port, overrides) {
  const before = port.ofType("ticket").length;
  await grant(port, overrides);
  const issued = port.ofType("ticket");
  assert.equal(issued.length, before + 1, "expected one new ticket");
  return issued.at(-1).token;
}

async function redeem(h, token, overrides) {
  const port = h.player(overrides);
  await port.send({ type: "redeem", token });
  return port;
}

function assertStopped(port) {
  assert.deepEqual(port.messages, [{ type: "stop" }]);
}

function assertLoad(port, url = image, kind = "image") {
  assert.deepEqual(port.messages, [{ type: "load", kind, url }]);
}

test("rejects missing/foreign extension senders and senders without a tab", () => {
  const h = harness();
  for (const sender of [
    undefined, {}, { id: "foreign", tab: { id: 1 }, frameId: 0, url: routeURL },
    { id: extensionId, frameId: 0, url: routeURL },
  ]) {
    for (const name of ["coordinator", "player"]) {
      const port = h.connect(name, sender);
      assert.equal(port.disconnected, true);
      assert.deepEqual(port.messages, []);
    }
  }
});

test("coordinator and player ports enforce their frame and origin boundaries", () => {
  const h = harness();
  for (const overrides of [
    { frameId: 1 }, { frameId: -1 }, { frameId: undefined },
    { url: "http://x.com/home" }, { url: "https://x.com.evil.test/home" },
    { url: "https://notx.com/home" }, { url: "https://x.com@evil.test/home" },
  ]) assert.equal(h.coordinator(overrides).disconnected, true, JSON.stringify(overrides));
  for (const overrides of [
    { frameId: 0 }, { frameId: -1 }, { frameId: undefined },
    { url: routeURL }, { url: "https://evil.test/player.html" },
    { url: "chrome-extension://other/player.html" },
  ]) assert.equal(h.player(overrides).disconnected, true, JSON.stringify(overrides));
  assert.equal(h.connect("unknown", {
    id: extensionId, tab: { id: 1 }, frameId: 0, url: routeURL,
  }).disconnected, true);
});

test("initial storage errors retain ON defaults and deny automatic grants", async () => {
  const h = harness({ storageRead: () => Promise.reject(new Error("Storage unavailable")) });
  const port = await coordinator(h);
  assert.deepEqual(h.storageKeys, ["filters"]);
  assert.deepEqual(port.ofType("settings"), [{ type: "settings", settings: { a: true, c: true, b: true }, revision: 0 }]);
  for (const category of ["A", "C", "B", null]) await grant(port, { category, manual: false });
  assert.equal(port.ofType("denied").length, 4);
  assert.equal(port.ofType("ticket").length, 0);
  assertLoad(await redeem(h, await ticket(port)));
});

test("missing and invalid initial settings default each filter independently", async () => {
  for (const [raw, expected] of [
    [{}, { a: false, c: false, b: true }],
    [{ filters: null }, { a: false, c: false, b: true }],
    [{ filters: { a: "false", c: "true", b: 0 } }, { a: false, c: false, b: true }],
    [{ filters: { a: false } }, { a: false, c: false, b: true }],
    [{ filters: { a: true } }, { a: true, c: false, b: true }],
    [{ filters: { a: true, c: null, b: true } }, { a: true, c: false, b: true }],
  ]) {
    const h = harness({ raw });
    const port = await coordinator(h);
    assert.deepEqual(port.ofType("settings")[0].settings, expected);
    for (const [category, blocked] of [["A", expected.a], ["C", expected.c], ["B", expected.b]]) {
      const id = `initial-${category}`;
      await grant(port, { id, manual: false, category });
      assert.equal(port.messages.find(message => message.id === id)?.type, blocked ? "denied" : "ticket");
    }
  }
});

test("grants wait for the initial storage read rather than assuming filters are OFF", async () => {
  const storage = deferred();
  const h = harness({ storageRead: () => storage.promise });
  const port = await coordinator(h);
  const pending = ["A", "C", "B", null].map(category =>
    grant(port, { id: `pending-${category}`, category, manual: false }));
  await flush();
  assert.deepEqual(port.messages, []);
  storage.reject(new Error("Read failed"));
  await Promise.all(pending);
  assert.equal(port.ofType("denied").length, 4);
  assert.equal(port.ofType("ticket").length, 0);
});

for (const a of [true, false]) {
  for (const b of [true, false]) {
    test(`legacy stored A=${a}, B=${b} migrates author replies on reads and changes`, async () => {
      const h = harness({ raw: { filters: { a, b } } });
      const port = await coordinator(h);
      assert.deepEqual(port.ofType("settings")[0].settings, { a, c: a, b });
      await grant(port, { category: "C", manual: false });
      assert.equal(port.ofType(a ? "denied" : "ticket").length, 1);
      await h.settings({ a: !a, b });
      assert.deepEqual(port.ofType("settings").at(-1).settings, { a: !a, c: !a, b });
    });
    for (const c of [true, false]) {
      test(`automatic authorization obeys stored A=${a}, C=${c}, B=${b}; manual grants remain per item`, async () => {
        const h = harness({ raw: { filters: { a, c, b } } });
        const port = await coordinator(h);
        for (const [category, blocked] of [["A", a], ["C", c], ["B", b], [null, a || c || b]]) {
          const id = `automatic-${category}`;
          await grant(port, { id, category, manual: false });
          assert.equal(port.messages.find(message => message.id === id)?.type, blocked ? "denied" : "ticket");
        }
        for (const category of ["A", "C", "B", null]) {
          assertLoad(await redeem(h, await ticket(port, { id: `manual-${category}`, category })));
        }
      });
    }
  }
}

test("manual selection never authorizes a sibling occurrence with an identical URL", async () => {
  const h = harness();
  const port = await coordinator(h);
  const selected = await ticket(port, { id: "selected", category: "A" });
  await grant(port, { id: "duplicate-url-other-post", category: "B", manual: false });
  assert.deepEqual(port.ofType("denied").at(-1), { type: "denied", id: "duplicate-url-other-post", epoch: "page-1" });
  assert.equal(port.ofType("ticket").length, 1);
  assertLoad(await redeem(h, selected));
  assertStopped(await redeem(h, "duplicate-url-other-post"));
});

test("the worker rejects hostile destinations and URL/kind mismatches even for manual grants", async () => {
  const h = harness();
  const port = await coordinator(h);
  const hostile = [
    "https://evil.test/media/Selected", "http://pbs.twimg.com/media/Selected",
    "https://pbs.twimg.com.evil.test/media/Selected", "https://pbs.twimg.com@evil.test/media/Selected",
    "https://evil.test@pbs.twimg.com/media/Selected", "https://pbs.twimg.com:443/media/Selected",
    "https://pbs.twimg.com/media/../media/Selected", "https://pbs.twimg.com/media/%2e%2e/Selected",
    "https://pbs.twimg.com/profile_images/123/avatar.jpg", `${image}#fragment`,
    ` ${image}`, "data:image/png;base64,AA", "blob:https://x.com/123", null, {},
  ];
  for (const url of hostile) await grant(port, { url });
  await grant(port, { url: video, kind: "image" });
  await grant(port, { url: image, kind: "video" });
  await grant(port, { url: video.replace("Selected.mp4", "Selected.m3u8"), kind: "video" });
  assert.equal(port.ofType("denied").length, hostile.length + 3);
  assert.equal(port.ofType("ticket").length, 0);
  assertLoad(await redeem(h, await ticket(port, { url: video, kind: "video" })), video, "video");
});

test("a player without a grant receives no media URL", async () => {
  const h = harness();
  await coordinator(h);
  const player = h.player();
  for (const message of [null, {}, { type: "alive" }, { type: "redeem", token: {} }]) await player.send(message);
  assert.deepEqual(player.messages, []);
  await player.send({ type: "redeem", token: "unissued-token" });
  assertStopped(player);
});

test("a ticket can be redeemed only once, including concurrent player ports", async () => {
  const h = harness();
  const port = await coordinator(h);
  const token = await ticket(port);
  const first = h.player();
  const second = h.player({ frameId: 2 });
  await Promise.all([first.send({ type: "redeem", token }), second.send({ type: "redeem", token })]);
  assertLoad(first);
  assertStopped(second);
  await first.send({ type: "redeem", token });
  assertLoad(first);
  assertStopped(await redeem(h, token));
});

for (const action of ["settings", "context", "revoke"]) {
  test(`a rejected ticket replay disconnect preserves active player revocation via ${action}`, async () => {
    const h = harness({ raw: { filters: { a: false, c: false, b: false } } });
    const port = await coordinator(h);
    const token = await ticket(port);
    const active = await redeem(h, token);
    assertLoad(active);
    const replay = await redeem(h, token, { frameId: 2 });
    assertStopped(replay);
    replay.disconnect();
    if (action === "settings") await h.settings({ a: true, c: false, b: false });
    else if (action === "context") await port.send({ type: "context", route: "status:456", epoch: "page-2" });
    else await port.send({ type: "revoke", id: "post-123:image-0:occurrence-1" });
    assert.deepEqual(active.messages, [{ type: "load", kind: "image", url: image }, { type: "stop" }]);
  });
}

test("a ticket cannot be redeemed by another tab", async () => {
  const h = harness();
  const port = await coordinator(h);
  assertStopped(await redeem(h, await ticket(port), { tab: { id: 2 } }));
});

test("expired tickets cannot be redeemed", async () => {
  const h = harness();
  const port = await coordinator(h);
  const token = await ticket(port);
  h.advance(15001);
  assertStopped(await redeem(h, token));
});

test("missing context, invalid category, and a stale grant epoch fail closed", async () => {
  const h = harness();
  const port = h.coordinator();
  await flush();
  await grant(port);
  await port.send({ type: "context", route: "status:123", epoch: "page-1" });
  await grant(port, { epoch: "old-page" });
  await grant(port, { category: "unclassified" });
  await grant(port, { id: "x".repeat(1001) });
  assert.equal(port.ofType("denied").length, 4);
  assert.equal(port.ofType("ticket").length, 0);
});

test("the current tab URL is checked at both grant and redemption, not just connect", async () => {
  for (const url of ["https://x.com/author/status/456", "https://evil.test/author/status/123"]) {
    const h = harness();
    const port = await coordinator(h);
    const token = await ticket(port);
    h.tabs.set(1, { id: 1, url });
    assertStopped(await redeem(h, token));
    await grant(port, { id: "late-grant" });
    assert.equal(port.ofType("denied").at(-1).id, "late-grant");
    assert.equal(port.ofType("ticket").length, 1);
  }
});

test("a missing tab fails closed during both grant and redemption", async () => {
  const h = harness();
  const port = await coordinator(h);
  const token = await ticket(port);
  h.tabs.delete(1);
  assertStopped(await redeem(h, token));
  await grant(port);
  assert.equal(port.ofType("denied").length, 1);
});

test("a context change stops players and invalidates outstanding tickets", async () => {
  const h = harness();
  const port = await coordinator(h);
  const player = await redeem(h, await ticket(port, { id: "playing" }));
  const outstanding = await ticket(port, { id: "not-yet-loaded" });
  await port.send({ type: "context", route: "status:456", epoch: "page-2" });
  assert.deepEqual(player.messages.at(-1), { type: "stop" });
  assertStopped(await redeem(h, outstanding));
  await grant(port, { epoch: "page-1" });
  assert.equal(port.ofType("denied").length, 1);
});

test("a route epoch change while tabs.get is pending rejects a delayed grant", async () => {
  const h = harness();
  const port = await coordinator(h);
  const tab = deferred();
  h.setTabReader(() => tab.promise);
  const pending = grant(port);
  await flush();
  assert.deepEqual(h.tabReads, [1]);
  await port.send({ type: "context", route: "status:456", epoch: "page-2" });
  tab.resolve({ id: 1, url: "https://x.com/author/status/456" });
  await pending;
  assert.equal(port.ofType("ticket").length, 0);
  assert.equal(port.ofType("denied").length, 1);
});

test("settings updates revoke blocked manual/automatic tickets and notify all X tabs", async () => {
  const h = harness({ raw: { filters: { a: false, b: false } } });
  const first = await coordinator(h);
  const second = await coordinator(h, { tab: { id: 2 }, documentId: "document-2" });
  const autoA = await redeem(h, await ticket(first, { id: "auto-A", manual: false }));
  const manualA = await redeem(h, await ticket(first, { id: "manual-A" }));
  const manualB = await redeem(h, await ticket(first, { id: "manual-B", category: "B" }));
  const outstandingA = await ticket(first, { id: "outstanding-A" });
  const otherTab = await redeem(h, await ticket(second), { tab: { id: 2 } });
  await h.settings({ a: true, b: false });
  for (const player of [autoA, manualA, otherTab]) assert.deepEqual(player.messages.at(-1), { type: "stop" });
  assertLoad(manualB);
  assertStopped(await redeem(h, outstandingA));
  for (const port of [first, second]) {
    assert.deepEqual(port.ofType("settings").at(-1), { type: "settings", settings: { a: true, c: true, b: false }, revision: 1 });
  }
  await h.settings({ a: true, b: true });
  assert.deepEqual(manualB.messages.at(-1), { type: "stop" });
});

test("filter-OFF changes enable automatic grants; non-local changes are ignored", async () => {
  const h = harness({ raw: { filters: { a: true, c: true, b: true } } });
  const port = await coordinator(h);
  await h.settings({ a: false, b: false }, "sync");
  assert.equal(port.ofType("settings").length, 1);
  await grant(port, { manual: false });
  assert.equal(port.ofType("denied").length, 1);
  await h.settings({ a: false, b: true });
  assertLoad(await redeem(h, await ticket(port, { manual: false })));
  await grant(port, { category: "B", manual: false });
  assert.equal(port.ofType("denied").length, 2);
});

test("a settings revision change rejects a grant already awaiting tab validation", async () => {
  const h = harness({ raw: { filters: { a: false, b: false } } });
  const port = await coordinator(h);
  const tab = deferred();
  h.setTabReader(() => tab.promise);
  const pending = grant(port, { manual: false });
  await flush();
  assert.equal(h.tabReads.length, 1);
  await h.settings({ a: true, b: true });
  tab.resolve({ id: 1, url: routeURL });
  await pending;
  assert.equal(port.ofType("ticket").length, 0);
  assert.equal(port.ofType("denied").length, 1);
});

for (const reason of ["settings", "context"]) {
  test(`${reason} revocation during player tab validation cannot deliver a late load`, async () => {
    const h = harness({ raw: { filters: { a: false, b: false } } });
    const port = await coordinator(h);
    const token = await ticket(port);
    const tab = deferred();
    h.setTabReader(() => tab.promise);
    const player = h.player();
    const pending = player.send({ type: "redeem", token });
    await flush();
    assert.equal(h.tabReads.length, 2);
    if (reason === "settings") await h.settings({ a: true, b: true });
    else await port.send({ type: "context", route: "status:456", epoch: "page-2" });
    tab.resolve({ id: 1, url: routeURL });
    await pending;
    assertStopped(player);
  });
}

test("explicit revoke, replacement, and coordinator disconnect invalidate only their own grants", async () => {
  const h = harness();
  const port = await coordinator(h);
  const selected = await redeem(h, await ticket(port, { id: "selected" }));
  const sibling = await ticket(port, { id: "sibling" });
  await port.send({ type: "revoke", id: "selected" });
  assert.deepEqual(selected.messages.at(-1), { type: "stop" });
  const siblingPlayer = await redeem(h, sibling);
  assertLoad(siblingPlayer);
  const replacement = await ticket(port, { id: "sibling" });
  assert.deepEqual(siblingPlayer.messages.at(-1), { type: "stop" });
  const replacementPlayer = await redeem(h, replacement);
  port.disconnect();
  assert.deepEqual(replacementPlayer.messages.at(-1), { type: "stop" });
  assertStopped(await redeem(h, replacement));
});

test("a new coordinator document revokes the old one without old disconnect erasing the new session", async () => {
  const h = harness();
  const old = await coordinator(h);
  const player = await redeem(h, await ticket(old));
  const unredeemed = await ticket(old, { id: "pending-old" });
  const fresh = await coordinator(h, { documentId: "document-reloaded" });
  assert.deepEqual(player.messages.at(-1), { type: "stop" });
  assertStopped(await redeem(h, unredeemed));
  const messagesBefore = old.messages.length;
  await grant(old);
  assert.equal(old.messages.length, messagesBefore);
  old.disconnect();
  assertLoad(await redeem(h, await ticket(fresh)));
});

test("revoking an item while its grant is awaiting tab validation rejects the late ticket", async () => {
  const h = harness(); const port = await coordinator(h); const tab = deferred();
  h.setTabReader(() => tab.promise);
  const pending = grant(port, {id: 'removed-item'});
  await flush(); await port.send({type: 'revoke', id: 'removed-item'});
  tab.resolve({id: 1, url: routeURL}); await pending;
  assert.equal(port.ofType('ticket').length, 0);
});

test("changing only the other filter or writing unchanged settings preserves a manual grant", async () => {
  const h = harness({raw: {filters: {a: true, b: false}}}); const port = await coordinator(h);
  const player = await redeem(h, await ticket(port));
  await h.settings({a: true, b: false}); assertLoad(player);
  await h.settings({a: true, b: true}); assertLoad(player);
});

test("resolved ownership preserves a manual selection when only the other category turns ON", async () => {
  const h = harness({raw: {filters: {a: true, b: false}}}); const port = await coordinator(h);
  const selected = await redeem(h, await ticket(port, {id: 'resolved', category: null}));
  await port.send({type: 'category', id: 'resolved', epoch: 'page-1', category: 'A'});
  await h.settings({a: true, b: true}); assertLoad(selected);
});

test("automatic media is revoked if metadata reclassifies it into a blocked category", async () => {
  const h = harness({raw: {filters: {a: false, b: true}}}); const port = await coordinator(h);
  const selected = await redeem(h, await ticket(port, {id: 'reclassified', manual: false}));
  await port.send({type: 'category', id: 'reclassified', epoch: 'old-page', category: 'B'}); assertLoad(selected);
  await port.send({type: 'category', id: 'reclassified', epoch: 'page-1', category: 'B'});
  assert.deepEqual(selected.messages.at(-1), {type: 'stop'});
  assert.deepEqual(port.ofType('revoked').at(-1).settings, {a: false, c: false, b: true});
});

test("a same-URL replacement document cannot inherit the old coordinator's grant", async () => {
  const h = harness({documentAlive: false}); const port = await coordinator(h);
  await grant(port); assert.equal(port.ofType('ticket').length, 0);
});

test("failure to install the redirect guard denies even manual grants", async () => {
  const h = harness({ruleError: true}); const port = await coordinator(h);
  await grant(port); assert.equal(port.ofType('ticket').length, 0);
  assert.equal(port.ofType('denied').length, 1);
});

test("custom cover video grants require a matching media ID at the worker boundary", async () => {
  const h = harness();
  const port = await coordinator(h);
  for (const mediaId of [undefined, null, "456", 123, {}, "", "1".repeat(26)]) {
    await grant(port, {kind: "video", url: video, poster: image, mediaId});
  }
  assert.equal(port.ofType("ticket").length, 0);
  const token = await ticket(port, {kind: "video", url: video, poster: image, mediaId: "123"});
  assertLoad(await redeem(h, token), video, "video");
});

test("custom cover metadata cannot bypass thumbnail or destination checks", async () => {
  const h = harness();
  const port = await coordinator(h);
  for (const overrides of [
    {poster: "https://pbs.twimg.com/amplify_video_thumb/456/img/Poster.jpg"},
    {poster: "https://pbs.twimg.com/ext_tw_video_thumb/123/img/Poster.jpg"},
    {poster: "https://evil.test/media/Poster.jpg"},
    {url: video.replace("video.twimg.com", "evil.test")},
    {url: video.replace("Selected.mp4", "Selected.m3u8")},
  ]) await grant(port, {kind: "video", url: video, poster: image, mediaId: "123", ...overrides});
  assert.equal(port.ofType("ticket").length, 0);
});

test("custom cover video grants retain single-use, route and settings revocation", async () => {
  const h = harness({raw: {filters: {a: true, c: true, b: true}}});
  const port = await coordinator(h);
  const token = await ticket(port, {kind: "video", url: video, poster: image, mediaId: "123"});
  const player = await redeem(h, token);
  assertLoad(player, video, "video");
  assertStopped(await redeem(h, token));
  await port.send({type: "context", route: "status:456", epoch: "page-2"});
  assert.deepEqual(player.messages.at(-1), {type: "stop"});
  await port.send({type: "context", route: "status:123", epoch: "page-1"});
  await h.settings({a: false, c: true, b: true});
  const next = await ticket(port, {kind: "video", url: video, poster: image, mediaId: "123", manual: false});
  await h.settings({a: true, c: true, b: true});
  assertStopped(await redeem(h, next));
});

test("video grants reject sources unrelated to the selected poster", async () => {
  const h = harness(); const port = await coordinator(h);
  await grant(port, {kind: 'video', url: video, poster: 'https://pbs.twimg.com/amplify_video_thumb/456/img/Poster.jpg'});
  assert.equal(port.ofType('ticket').length, 0);
});

for (const [key, category] of [["a", "A"], ["c", "C"], ["b", "B"]]) {
  test(`turning only ${category} ON revokes its grants and unknown selections, not siblings`, async () => {
    const filters = { a: false, c: false, b: false };
    const h = harness({ raw: { filters } });
    const port = await coordinator(h);
    const active = [];
    const outstanding = [];
    for (const itemCategory of ["A", "C", "B", null]) {
      for (const manual of [true, false]) {
        const id = `${itemCategory}-${manual}`;
        const player = await redeem(h, await ticket(port, { id, category: itemCategory, manual }));
        active.push({ id, category: itemCategory, player });
      }
      const token = await ticket(port, { id: `outstanding-${itemCategory}`, category: itemCategory });
      outstanding.push({ category: itemCategory, token });
    }
    const next = { ...filters, [key]: true };
    await h.settings(next);
    assert.deepEqual(port.ofType("settings").at(-1), { type: "settings", settings: next, revision: 1 });
    for (const item of active) {
      if (item.category === category || item.category === null) {
        assert.deepEqual(item.player.messages.at(-1), { type: "stop" });
        assert.ok(port.ofType("revoked").some(message => message.id === item.id));
      } else assertLoad(item.player);
    }
    for (const item of outstanding) {
      const player = await redeem(h, item.token);
      if (item.category === category || item.category === null) assertStopped(player);
      else assertLoad(player);
    }
    // Rewriting ON is not another revocation; a fresh manual selection survives.
    const selected = await redeem(h, await ticket(port, { id: "selected-again", category }));
    await h.settings(next);
    assertLoad(selected);
    await h.settings(filters);
    assertLoad(selected);
    assertLoad(await redeem(h, await ticket(port, { id: "enabled-again", category, manual: false })));
  });

  test(`unknown manual media is revoked when ${category} turns ON even if already blocked by another filter`, async () => {
    const otherKey = key === "a" ? "b" : "a";
    const filters = { a: false, c: false, b: false, [otherKey]: true };
    const h = harness({ raw: { filters } });
    const port = await coordinator(h);
    const selected = await redeem(h, await ticket(port, { category: null }));
    await h.settings({ ...filters, [key]: true });
    assert.deepEqual(selected.messages.at(-1), { type: "stop" });
  });

  test(`automatic reclassification into blocked ${category} revokes; manual selection survives`, async () => {
    const filters = { a: false, c: false, b: false, [key]: true };
    const h = harness({ raw: { filters } });
    const port = await coordinator(h);
    const from = category === "A" ? "C" : "A";
    const automatic = await redeem(h, await ticket(port, { id: "automatic", category: from, manual: false }));
    const manual = await redeem(h, await ticket(port, { id: "manual", category: from }));
    for (const invalid of ["invalid", undefined, false]) {
      await port.send({ type: "category", id: "automatic", epoch: "page-1", category: invalid });
      assertLoad(automatic);
    }
    await port.send({ type: "category", id: "automatic", epoch: "old-page", category });
    assertLoad(automatic);
    for (const id of ["automatic", "manual"]) {
      await port.send({ type: "category", id, epoch: "page-1", category });
    }
    assert.deepEqual(automatic.messages.at(-1), { type: "stop" });
    assertLoad(manual);
  });
}

test("a late initial storage snapshot cannot overwrite a newer settings event", async () => {
  const storage = deferred();
  const h = harness({ storageRead: () => storage.promise });
  const port = await coordinator(h);
  await h.settings({ a: true, b: true });
  // The read started before this change and resolves with the older OFF snapshot.
  storage.resolve({ filters: { a: false, b: false } });
  await flush();
  await grant(port, { manual: false });
  assert.equal(port.ofType("ticket").length, 0, "newer ON settings must block automatic loading");
  assert.equal(port.ofType("denied").length, 1);
  assert.deepEqual(port.ofType("settings").at(-1), {
    type: "settings", settings: { a: true, c: true, b: true }, revision: 1,
  });
});
