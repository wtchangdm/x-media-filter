"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise production MAIN-world metadata transport; not live X/network proof.
const source = fs.readFileSync(require.resolve("../extension/bridge.js"), "utf8");
const endpoint = "https://x.com/i/api/graphql/test/TweetDetail";
const nonce = "12345678-1234-1234-1234-123456789abc";
const image = "https://pbs.twimg.com/media/Selected?format=jpg&name=small";
function photo(id = "1001") { return { type: "photo", id_str: id, media_url_https: image }; }
function tweet(media) {
  return { rest_id: "123", legacy: { conversation_id_str: "123", extended_entities: { media }, full_text: "private body" },
    core: { user_results: { result: { core: { screen_name: "author" }, privateField: "private user" } } } };
}

function harness() {
  const listeners = new Map(), broadcasts = [], messages = [], queries = [];
  let metadataPort;
  let fetchResponse;
  let target = null;
  class XHR {
    open(method, url) { this.method = method; this.url = url; }
    send() { this.sent = true; }
    addEventListener(type, listener, options) {
      assert.equal(type, "load");
      assert.equal(options.once, true);
      this.load = listener;
    }
  }
  const window = {
    postMessage(...args) { broadcasts.push(args); },
    async fetch() { return fetchResponse; },
  };
  const sandbox = vm.createContext({
    URL, location: new URL("https://x.com/author/status/123/photo/1"), window,
    addEventListener(type, callback) { listeners.set(type, callback); },
    MessageChannel: class {
      constructor() {
        this.port1 = metadataPort = { postMessage(message) { messages.push(message); } };
        this.port2 = {};
      }
    },
    XMLHttpRequest: XHR,
    document: {
      addEventListener(type, callback) { listeners.set(type, callback); },
      querySelector(selector) { queries.push(selector); return target; },
    },
  });
  vm.runInContext(source, sandbox, { filename: "bridge.js", timeout: 1000 });
  return { messages, broadcasts, queries, listeners,
    ready(detail = nonce) { listeners.get("xmf-ready-v1")({ detail }); },
    identity(request, element) { target = element; metadataPort.onmessage({ data: request }); },
    observe(data, { url = endpoint, responseType = "json" } = {}) {
      const xhr = new XHR();
      xhr.open("GET", url); xhr.send();
      xhr.responseType = responseType;
      if (responseType === "json") xhr.response = data;
      else xhr.responseText = typeof data === "string" ? data : JSON.stringify(data);
      xhr.load?.();
      return xhr;
    },
    async fetch(data, { url = endpoint, contentType = "application/json", reject = false } = {}) {
      fetchResponse = { headers: { get: () => contentType },
        clone() { return { json: () => reject ? Promise.reject(new Error("bad JSON")) : Promise.resolve(data) }; },
      };
      const original = fetchResponse;
      const response = await window.fetch(url);
      await Promise.resolve();
      assert.equal(response, original, "observation must preserve the original page response");
    },
  };
}

function normalized(value) { return JSON.parse(JSON.stringify(value)); }

test("bridge has no viewer scalar event handler or page DOM lookup", () => {
  const h = harness();
  assert.equal(h.listeners.has("xmf-viewer-v1"), false);
  h.observe(tweet([photo()]));
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.broadcasts, []);
  assert.deepEqual(h.messages, []);
});

test("metadata waits for a one-time channel handoff and never broadcasts post bodies or URLs", () => {
  const h = harness();
  h.observe(tweet([photo()]));
  h.ready();
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.messages.length, 1);
  const [payload, origin, transfers] = h.broadcasts[0];
  assert.deepEqual(normalized(payload), { channel: "xmf-channel-v1", nonce });
  assert.equal(origin, "https://x.com");
  assert.equal(transfers.length, 1);
  h.ready();
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.messages.length, 1);
  const post = h.messages[0].posts[0];
  assert.equal(post.id, "123");
  assert.equal(post.author, "author");
  assert.equal(post.media[0].poster, image);
  assert.doesNotMatch(JSON.stringify(h.messages), /private body|private user|full_text|privateField/);
});

test("invalid ready details cannot hand off a pending metadata channel", () => {
  const h = harness();
  h.observe(tweet([photo()]));
  for (const detail of [undefined, null, 42, "short", "x".repeat(37)]) {
    h.listeners.get("xmf-ready-v1")({ detail });
  }
  assert.deepEqual(h.broadcasts, []);
  assert.deepEqual(h.messages, []);
  h.ready();
  assert.equal(h.messages.length, 1);
  h.observe(tweet([photo("1002")]));
  assert.equal(h.messages.length, 2);
  assert.equal(h.broadcasts.length, 1);
});

for (const malformed of [null, undefined, {}, 42, "invalid", { media_url_https: null }, { media_url_https: 123 }]) {
  test(`malformed attachment ${JSON.stringify(malformed)} retains its ordinal before valid media`, () => {
    const h = harness();
    h.ready();
    h.observe(tweet([malformed, photo(), malformed, photo("1002")]));
    const media = normalized(h.messages[0].posts[0].media);
    assert.equal(media.length, 4);
    assert.deepEqual(media[0], {});
    assert.deepEqual(media[2], {});
    assert.equal(media[1].mediaId, "1001");
    assert.equal(media[3].mediaId, "1002");
    assert.equal(media[3].poster, image);
  });
}

test("attachment and variant bounds retain order while exposing only media metadata", () => {
  const h = harness();
  h.ready();
  const media = Array.from({ length: 20 }, (_, index) => ({ ...photo(String(index + 1)),
    privateField: "private attachment", original_info: { width: 100, height: 200, privateField: "private dimensions" },
    video_info: { variants: Array.from({ length: 20 }, (_, bitrate) => ({
      url: `https://video.twimg.com/ext_tw_video/1001/pu/vid/${bitrate}.mp4`,
      content_type: "video/mp4", bitrate, privateField: "private variant",
    })) },
  }));
  h.observe(tweet(media));
  const observed = h.messages[0].posts[0].media;
  assert.equal(observed.length, 16);
  assert.deepEqual(Array.from(observed, entry => entry.mediaId), media.slice(0, 16).map(entry => entry.id_str));
  assert.equal(observed[0].variants.length, 16);
  assert.equal(observed[0].width, 100);
  assert.equal(observed[0].height, 200);
  assert.doesNotMatch(JSON.stringify(observed), /private/);
});

for (const responseType of ["json", "text", ""]) {
  test(`XHR ${JSON.stringify(responseType)} response retains malformed attachment slots`, () => {
    const h = harness();
    h.ready();
    const xhr = h.observe(tweet([null, photo()]), { responseType });
    assert.equal(xhr.sent, true);
    assert.equal(h.messages[0].posts[0].media.length, 2);
    assert.equal(h.messages[0].posts[0].media[1].mediaId, "1001");
  });
}

test("fetch observation preserves the response and attachment ordinals", async () => {
  const h = harness();
  h.ready();
  await h.fetch(tweet([null, photo()]), { url: { url: endpoint } });
  assert.equal(h.messages.length, 1);
  assert.deepEqual(normalized(h.messages[0].posts[0].media[0]), {});
  assert.equal(h.messages[0].posts[0].media[1].mediaId, "1001");
  await h.fetch(null, { reject: true });
  assert.equal(h.messages.length, 1, "invalid JSON does not publish metadata");
});

for (const url of ["https://example.com/i/api/graphql/test/TweetDetail", "https://x.com/i/api/graphql/test/UserByScreenName", "https://x.com/not-graphql/TweetDetail"]) {
  test(`unrelated endpoint is not observed: ${url}`, async () => {
    const h = harness();
    h.ready();
    h.observe(tweet([photo()]), { url });
    await h.fetch(tweet([photo()]), { url });
    assert.deepEqual(h.messages, []);
  });
}

test("non-JSON fetch and invalid XHR JSON remain unpublished", async () => {
  const h = harness();
  h.ready();
  await h.fetch(tweet([photo()]), { contentType: "text/html" });
  h.observe("invalid JSON", { responseType: "text" });
  assert.deepEqual(h.messages, []);
});

test("remaining occurrence identity port returns only bounded keys tied to the requested post", () => {
  const h = harness();
  const request = { type: "identity", marker: nonce, postId: "123" };
  const element = { __reactFiber$test: { key: "tweet-123", memoizedProps: { privateField: "private props" },
    return: { key: "timeline", memoizedProps: { items: [] } } } };
  h.identity(request, element);
  assert.deepEqual(normalized(h.messages), [{ type: "identity", marker: nonce, keys: ["tweet-123", "timeline"] }]);
  assert.deepEqual(h.queries, [`[data-xmf-identity="${nonce}"]`]);
  h.identity({ ...request, postId: "456" }, element);
  assert.deepEqual(normalized(h.messages.at(-1).keys), []);
  assert.deepEqual(h.broadcasts, []);
  assert.doesNotMatch(JSON.stringify(h.messages), /private props|memoizedProps/);
});

for (const invalid of [null, {}, { type: "viewer" }, { type: "identity", marker: "bad", postId: "123" },
  { type: "identity", marker: nonce, postId: "invalid" }]) {
  test(`invalid identity request does not query the DOM: ${JSON.stringify(invalid)}`, () => {
    const h = harness();
    h.identity(invalid, {});
    assert.deepEqual(h.queries, []);
    assert.deepEqual(h.messages, []);
  });
}
