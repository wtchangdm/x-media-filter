"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise production MAIN-world metadata transport; not live X/network proof.
const source = fs.readFileSync(require.resolve("../extension/bridge.js"), "utf8");
const endpoint = "https://api.x.com/graphql/test/tweetdetail";
const nonce = "12345678-1234-1234-1234-123456789abc";
const image = "https://pbs.twimg.com/media/Selected?format=jpg&name=small";
function photo(id = "1001") { return { type: "photo", id_str: id, media_url_https: image }; }
function tweet(media) {
  return { rest_id: "123", media_entities2: media, legacy: { conversation_id_str: "123", full_text: "private body" },
    core: { user_results: { result: { core: { screen_name: "author" }, privateField: "private user" } } } };
}

function video() {
  return {...photo(), type: "video", video_info: {variants: [{
    url: "https://video.twimg.com/ext_tw_video/1001/pu/vid/clip.mp4", content_type: "video/mp4", bitrate: 100000,
  }]}};
}
function partialTweet(media = [{media_url_https: image, type: "video"}]) {
  return {rest_id: "123", legacy: {possibly_sensitive: false}, media_entities2: media};
}

function script(textContent, external = false) {
  return {nodeType: 1, localName: "script", textContent, hasAttribute: name => name === "src" && external};
}
function stream(data) {
  return `($_R=>$_R[0].next({kind:0,result:{kind:"data",value:${JSON.stringify(JSON.stringify(data))}}}))($_R["stream"]);document.currentScript.remove()`;
}
function harness(initialScripts = []) {
  const listeners = new Map(), broadcasts = [], messages = [], queries = [];
  let metadataPort, mutations, parseCount = 0;
  let fetchResponse;
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
    JSON: { parse(text) { parseCount++; return JSON.parse(text); } },
    MutationObserver: class {
      constructor(callback) { mutations = callback; }
      observe(target, options) {
        assert.equal(target, sandbox.document);
        assert.deepEqual(normalized(options), {subtree: true, childList: true, characterData: true});
      }
    },
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
      querySelector(selector) { queries.push(selector); return null; },
      querySelectorAll(selector) { assert.equal(selector, "script"); return initialScripts; },
    },
  });
  vm.runInContext(source, sandbox, { filename: "bridge.js", timeout: 1000 });
  return { messages, broadcasts, queries, listeners, sandbox,
    get parseCount() { return parseCount; },
    ready(detail = nonce) { listeners.get("xmf-ready-v1")({ detail }); },
    identity(request) { metadataPort.onmessage?.({ data: request }); },
    get portHandler() { return metadataPort.onmessage; },
    mutate(records) { mutations(records); },
    insert(...nodes) { mutations([{type: "childList", target: sandbox.document, addedNodes: nodes}]); },
    textUpdate(node, text, characterData = false) {
      node.textContent = text;
      mutations([{type: characterData ? "characterData" : "childList",
        target: characterData ? {parentNode: node} : node, addedNodes: []}]);
    },
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
  for (const detail of [undefined, null, 42, "short", "x".repeat(36), "x".repeat(37), "-".repeat(36)]) {
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
  assert.equal(Object.hasOwn(observed[0], "width"), false);
  assert.equal(Object.hasOwn(observed[0], "height"), false);
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

for (const url of ["https://example.com/graphql/test/tweetdetail", "https://api.x.com/not-graphql/tweetdetail"]) {
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

test("the channel has no identity request handler or React lookup", () => {
  const h = harness();
  h.identity({ type: "identity", marker: nonce, postId: "123" });
  assert.equal(h.portHandler, undefined);
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.messages, []);
  assert.doesNotMatch(source, /__react|memoizedProps|data-xmf-identity/);
});

for (const url of [
  "https://api.x.com/graphql/hash/tweetdetail",
  "https://api.x.com/graphql/hash/hometimeline",
  "https://api.x.com/graphql/hash/searchtimeline",
  "https://api.x.com/graphql/hash/bookmarks",
  "https://api.x.com/graphql/hash/NotificationsTimeline",
  "https://api.x.com/graphql/hash/communitiesmainpagetimeline",
  "https://api.x.com/graphql/hash/listlatesttweets",
  "https://api.x.com/graphql/hash/postdetail",
  "https://api.x.com/graphql/TweetDetail/UserByScreenName",
  "https://api.x.com/graphql/hash/UserByScreenName?operation=TweetDetail",
  "https://api.x.com/graphql/hash/Viewer",
]) {
  test(`exact X API endpoint is observed: ${url}`, async () => {
    const h = harness();
    h.ready();
    h.observe(tweet([photo()]), {url});
    await h.fetch(tweet([photo()]), {url: new URL(url)});
    assert.equal(h.messages.length, 2);
  });
}

for (const url of [
  "https://x.com/i/api/graphql/hash/TweetDetail",
  "https://x.com/graphql/hash/TweetDetail",
  "http://api.x.com/graphql/hash/TweetDetail",
  "https://api.x.com.evil.example/graphql/hash/TweetDetail",
  "https://other.x.com/graphql/hash/TweetDetail",
  "https://api.x.com:444/graphql/hash/TweetDetail",
  "https://user:password@api.x.com/graphql/hash/TweetDetail",
  "https://api.x.com/proxy/graphql/hash/TweetDetail",
  "https://api.x.com/graphql/hash/TweetDetail/extra",
]) {
  test(`non-approved API endpoint stays unobserved: ${url}`, async () => {
    const h = harness();
    h.ready();
    h.observe(tweet([photo()]), {url});
    await h.fetch(tweet([photo()]), {url});
    assert.deepEqual(h.messages, []);
  });
}

test("initial JSON scripts retain current quote association and conversation metadata", () => {
  const quote = {...tweet([photo("2002")]), rest_id: "456"};
  const post = tweet([photo()]);
  post.legacy.in_reply_to_status_id_str = "100";
  post.quoted_tweet_results = {rest_id: "456", result: quote};
  const h = harness([script(JSON.stringify({data: post}))]);
  assert.deepEqual(h.messages, []);
  h.ready();
  const posts = normalized(h.messages[0].posts);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].id, "123");
  assert.equal(posts[0].parent, "100");
  assert.equal(posts[0].quote, "456");
  assert.equal(posts[1].id, "456");
  assert.equal(posts[1].media[0].mediaId, "2002");
  assert.doesNotMatch(JSON.stringify(posts), /private body|private user/);
});

test("server-streamed scripts removed before observer delivery still yield metadata without execution", () => {
  const h = harness();
  h.ready();
  const node = script(`globalThis.executed = true;${stream({data: tweet([photo()])})}`);
  node.isConnected = false;
  h.mutate([
    {type: "childList", target: h.sandbox.document, addedNodes: [node]},
    {type: "childList", target: h.sandbox.document, addedNodes: [], removedNodes: [node]},
  ]);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].posts[0].id, "123");
  assert.equal(h.sandbox.executed, undefined);
  assert.deepEqual(h.broadcasts.map(entry => entry[0].channel), ["xmf-channel-v1"]);
});

test("initial router literals and scripts inside inserted subtrees are decoded", () => {
  const h = harness();
  const node = script(`self.router.enqueue(${JSON.stringify(JSON.stringify({data: tweet([photo()])}))});`);
  h.insert({nodeType: 1, localName: "div", querySelectorAll: () => [node]});
  h.ready();
  assert.equal(h.messages[0].posts[0].media[0].poster, image);
});

test("partial child-list and character-data updates remain eligible until the literal completes", () => {
  const h = harness();
  h.ready();
  const complete = stream({data: tweet([photo()])});
  const split = complete.indexOf("private body") + 4;
  const node = script(complete.slice(0, split));
  h.insert(node);
  assert.deepEqual(h.messages, []);
  const attempts = h.parseCount;
  h.textUpdate(node, node.textContent, true);
  assert.equal(h.parseCount, attempts, "unchanged partial source must not be reparsed");
  h.textUpdate(node, complete.slice(0, split + 3));
  assert.deepEqual(h.messages, []);
  h.textUpdate(node, complete, true);
  assert.equal(h.messages.length, 1);
  const completedAttempts = h.parseCount;
  h.insert(node, node);
  h.textUpdate(node, complete);
  assert.equal(h.parseCount, completedAttempts);
  assert.equal(h.messages.length, 1);
  h.textUpdate(node, complete.replaceAll("123", "456"));
  assert.equal(h.messages.at(-1).posts[0].id, "456", "same-length changed source must be reconsidered");
});

test("actual JSON can arrive in multiple chunks without early completion", () => {
  const h = harness();
  h.ready();
  const complete = JSON.stringify({data: tweet([photo()])});
  const node = script(complete.slice(0, -1));
  h.insert(node);
  assert.deepEqual(h.messages, []);
  h.textUpdate(node, complete);
  assert.equal(h.messages.length, 1);
});

test("irrelevant, external and oversized scripts are ignored without parsing", () => {
  const h = harness();
  h.ready();
  const external = script(stream(tweet([photo()])), true);
  Object.defineProperty(external, "textContent", {get() { throw new Error("external source read"); }});
  h.insert(script("globalThis.executed = true;"), script('{"data":{"user":{"rest_id":"123"}}}'),
    external, script(`${" ".repeat(2 * 1024 * 1024)}${stream(tweet([photo()]))}`));
  assert.equal(h.parseCount, 0);
  assert.deepEqual(h.messages, []);
  assert.equal(h.sandbox.executed, undefined);
});

test("single-quoted, non-JSON literals and object expressions never execute or authorize", () => {
  const h = harness();
  h.ready();
  h.insert(script(`throw new Error('rest_id legacy conversation_id_str'); globalThis.executed = true;`),
    script(`const data = '{"rest_id":"123","legacy":{"conversation_id_str":"123"}}';`),
    script('const data = {rest_id:"123", legacy:{conversation_id_str:"123"}};'),
    script('const data = "{\\x22rest_id\\x22:123,legacy:conversation_id_str}";'));
  assert.deepEqual(h.messages, []);
  assert.equal(h.sandbox.executed, undefined);
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(/);
});

test("pre-handshake metadata accumulates normalized recent posts with a hard 500-post bound", () => {
  const h = harness();
  for (let batch = 0; batch < 20; batch++) {
    const posts = Array.from({length: 40}, (_, i) => ({...tweet([photo()]), rest_id: String(batch * 40 + i + 1)}));
    h.insert(script(stream({data: posts})));
  }
  assert.deepEqual(h.messages, []);
  h.ready();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].posts.length, 500);
  const retained = new Set(h.messages[0].posts.map(post => Number(post.id)));
  assert.equal(retained.size, 500);
  for (let id = 321; id <= 800; id++) assert.ok(retained.has(id), "the newest complete batches are retained");
  assert.ok([...retained].every(id => id > 280), "oldest batches are evicted regardless of traversal order");
  h.ready();
  assert.equal(h.messages.length, 1);
  h.observe(tweet([photo()]));
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[1].posts.length, 1);
  assert.doesNotMatch(JSON.stringify(h.messages), /private body|private user/);
});

test("duplicate IDs preserve arrival order within the bounded bootstrap queue", () => {
  const h = harness();
  for (let i = 1; i <= 600; i++) h.observe(tweet([photo(String(i))]));
  h.ready();
  assert.equal(h.messages[0].posts.length, 500);
  assert.deepEqual(Array.from(h.messages[0].posts, post => post.media[0].mediaId),
    Array.from({length: 500}, (_, i) => String(i + 101)));
  assert.equal(received(h).media[0].mediaId, "600");
});

test("current Tweet preserves supplied video metadata and absent fields", () => {
  const h = harness();
  h.ready();
  h.observe(tweet([video(), photo()]));
  const post = h.messages[0].posts[0];
  assert.equal(post.author, "author");
  assert.equal(post.conversation, "123");
  assert.equal(Object.hasOwn(post, "parent"), false);
  assert.equal(Object.hasOwn(post, "quote"), false);
  assert.deepEqual(normalized(post.media[0].variants), video().video_info.variants);
  assert.equal(Object.hasOwn(post.media[1], "variants"), false);
});

test("obsolete media, author and quote wrappers supply no fallback metadata", () => {
  const h = harness();
  h.ready();
  h.observe({rest_id: "123", legacy: {extended_entities: {media: [video()]}}});
  assert.deepEqual(h.messages, []);
  h.observe({rest_id: "123", legacy: {conversation_id_str: "123", extended_entities: {media: [video()]}},
    core: {user_results: {result: {legacy: {screen_name: "fallback"}}}},
    quoted_status_result: {result: {tweet: {rest_id: "456"}}}});
  assert.deepEqual(normalized(h.messages[0].posts), [{id: "123", conversation: "123"}]);
  const post = tweet([]);
  post.legacy.quoted_status_id_str = "456";
  post.quoted_status_result = {result: {rest_id: "789"}};
  h.observe(post);
  assert.equal(Object.hasOwn(h.messages.at(-1).posts[0], "quote"), false, "historical quote fields are ignored");
});

test("current quote IDs preserve absence and withdraw malformed or conflicting relationships", () => {
  const invalid = [null, undefined, [], "456", {rest_id: null}, {rest_id: undefined},
    {rest_id: 456}, {rest_id: ""}, {rest_id: "not-an-id"}, {rest_id: "1".repeat(26)},
    {rest_id: "456", result: {rest_id: "789"}}, {rest_id: "456", result: null},
    {rest_id: "456", result: {rest_id: null}}];
  for (const readyFirst of [false, true]) {
    for (const value of invalid) {
      const h = harness();
      if (readyFirst) h.ready();
      h.observe({...tweet([]), quoted_tweet_results: {rest_id: "456", result: {rest_id: "456"}}});
      h.observe(partialTweet([]));
      h.observe({...partialTweet([]), quoted_tweet_results: {}});
      h.ready();
      assert.equal(received(h).quote, "456", "omitted relationship fields preserve metadata");
      h.observe({...partialTweet([]), quoted_tweet_results: value});
      h.observe(partialTweet([]));
      assert.equal(received(h).quote, null, "invalid relationships withdraw without later inheritance");
      assert.equal(h.messages.at(-2).posts[0].quote, null);
    }
  }
  const h = harness();
  h.ready();
  h.observe({...tweet([]), quoted_tweet_results: {rest_id: "456"}});
  assert.equal(received(h).quote, "456", "the current relationship ID does not require expanded post data");
});

test("unrelated IDs with malformed legacy containers do not qualify as posts", () => {
  const h = harness();
  h.ready();
  for (const legacy of [null, [], "wrong", {}]) h.observe({rest_id: "123", legacy});
  assert.deepEqual(h.messages, []);
});

test("current attachments preserve empty and malformed values", () => {
  const h = harness();
  h.ready();
  for (const media of [[photo("2002")], [], undefined, null, {}, "invalid"]) {
    h.observe({...tweet([photo()]), media_entities2: media});
    const observed = h.messages.at(-1).posts[0].media;
    if (Array.isArray(media)) {
      assert.equal(observed.length, media.length);
      if (media.length) assert.equal(observed[0].mediaId, "2002");
    } else assert.equal(observed, null);
  }
});

test("minimal modern SSR nodes qualify without conversation or author, including empty media", () => {
  const h = harness([script(JSON.stringify(partialTweet([])))]);
  h.ready();
  assert.deepEqual(normalized(h.messages[0].posts[0]), {id: "123", media: []});
  h.insert(script(stream(partialTweet())));
  const post = h.messages.at(-1).posts[0];
  for (const key of ["author", "conversation", "parent", "quote"]) assert.equal(Object.hasOwn(post, key), false, key);
  for (const key of ["variants", "mediaId", "key", "width", "height"]) assert.equal(Object.hasOwn(post.media[0], key), false, key);
  h.observe({rest_id: "456", media_entities2: [photo()]});
  assert.equal(h.messages.at(-1).posts[0].id, "456");
});

test("omitted fields differ from malformed supplied fields without leaking raw values", () => {
  const h = harness();
  h.ready();
  h.observe({rest_id: "123", legacy: {conversation_id_str: "123"}});
  const absent = h.messages[0].posts[0];
  for (const key of ["media", "author", "parent", "quote"]) assert.equal(Object.hasOwn(absent, key), false, key);
  const post = tweet([{...video(), id_str: {}, media_key: null, type: {}, video_info: {variants: {}}, original_info: {width: {}, height: "wrong"}}]);
  post.core.user_results.result.core.screen_name = {};
  post.core.user_results.result.legacy = {screen_name: "fallback"};
  post.legacy = {conversation_id_str: {}, in_reply_to_status_id_str: null};
  post.quoted_tweet_results = {rest_id: {private: "secret"}};
  h.observe(post);
  const invalid = h.messages.at(-1).posts[0];
  for (const key of ["author", "conversation", "parent", "quote"]) assert.equal(invalid[key], null, key);
  for (const key of ["variants", "mediaId", "key", "type"]) assert.equal(invalid.media[0][key], null, key);
  for (const value of [null, [], "wrong"]) {
    h.observe({...partialTweet([{...photo(), video_info: value}]), core: value, legacy: value, quoted_tweet_results: value});
    const invalidContainers = h.messages.at(-1).posts[0];
    assert.equal(invalidContainers.author, null);
    assert.equal(invalidContainers.quote, null);
    assert.equal(invalidContainers.media[0].variants, null);
  }
  h.observe(partialTweet([{...photo(), video_info: {}}]));
  assert.equal(Object.hasOwn(h.messages.at(-1).posts[0].media[0], "variants"), false);
  assert.doesNotMatch(JSON.stringify(h.messages), /secret|fallback/);
});

// Exercise the real isolated consumer: bootstrap and live delivery must have
// the same merge semantics, without a second merger in the MAIN-world bridge.
function received(h) {
  const content = fs.readFileSync(require.resolve("../extension/content.js"), "utf8");
  const boundary = content.indexOf("  // Document lifecycle and trusted input.");
  assert.ok(boundary > 0);
  const context = vm.createContext({XMFPolicy: require("../extension/policy.js"),
    location: new URL("https://x.com/author/status/123"), crypto: {randomUUID: () => "test"},
    document: {}, requestAnimationFrame() {}});
  vm.runInContext(content.slice(0, boundary) +
    "globalThis.receive=observeMetadata;globalThis.posts=posts;})();", context);
  for (const message of h.messages) context.receive(message);
  return context.posts.get("123");
}

for (const readyFirst of [false, true]) {
  test(`partial metadata reaches one merger before/after handoff (ready first: ${readyFirst})`, () => {
    for (const reverse of [false, true]) {
      const h = harness();
      if (readyFirst) h.ready();
      const full = tweet([{...video(), media_key: "7_1001"}]);
      full.legacy.in_reply_to_status_id_str = "100";
      full.quoted_tweet_results = {rest_id: "456", result: {rest_id: "456"}};
      const records = [full, partialTweet([{media_url_https: image, type: "video", id_str: "1001"}])];
      if (reverse) records.reverse();
      for (const record of records) h.observe(record);
      h.ready();
      const post = received(h);
      assert.equal(post.author, "author"); assert.equal(post.conversation, "123");
      assert.equal(post.parent, "100"); assert.equal(post.quote, "456");
      assert.equal(post.media[0].key, "7_1001");
      assert.equal(post.media[0].video, video().video_info.variants[0].url);
      assert.equal(h.messages.flatMap(m => m.posts).length, 2, "the bridge preserves updates, not merged state");
      const partial = h.messages.flatMap(m => m.posts).find(p => p.conversation === undefined);
      assert.equal(Object.hasOwn(partial.media[0], "key"), false, "an absent key is not synthesized from id_str");
    }
  });

  test(`empty/invalid/replaced bindings cannot inherit a video (ready first: ${readyFirst})`, () => {
    const partial = changes => [{media_url_https: image, type: "video", ...changes}];
    const cases = [
      ...[[], null, {}].map(media => ({media, ids: []})),
      ...[[], null, {}].map(variants => ({media: partial({video_info: {variants}}), ids: ["1001"]})),
      {media: partial({media_url_https: image.replace("Selected", "Changed")}), ids: [null]},
      {media: partial({type: "photo"}), ids: [null]},
      {media: partial({type: null}), ids: [null]},
      {media: [null, ...partial({})], ids: [null, null]},
      ...["2002", null, {}, undefined].map(id_str => ({media: partial({id_str}),
        ids: [typeof id_str === "string" ? id_str : null]})),
      ...["changed", null, {}].map(media_key => ({media: partial({media_key}), ids: [null]})),
      {media: partial({media_key: "changed", id_str: "1001"}), ids: ["1001"]},
      {media: [...partial({id_str: "2002"}), ...partial({id_str: "1001"})], ids: ["2002", "1001"]},
    ];
    for (const {media, ids} of cases) {
      const h = harness();
      if (readyFirst) h.ready();
      h.observe(tweet([{...video(), media_key: "7_1001"}]));
      h.observe(partialTweet(media));
      h.observe({rest_id: "123", legacy: {conversation_id_str: "123"}});
      h.ready();
      const post = received(h);
      assert.deepEqual(Array.from(post.media, entry => entry.mediaId), ids);
      assert.ok(post.media.every(entry => entry.video === null));
    }
  });
}

test("only sanitized copies survive queued updates; invalid scalars clear known fields", () => {
  const h = harness(), full = tweet([video()]);
  h.observe(full);
  full.core.user_results.result.core.screen_name = "mutated";
  full.media_entities2[0].video_info.variants[0].url = "secret";
  h.observe({...partialTweet([{media_url_https: image, type: "video", id_str: {private: "secret"}}]),
    legacy: {conversation_id_str: null, in_reply_to_status_id_str: null}, quoted_tweet_results: null, core: null});
  h.observe(partialTweet());
  h.ready();
  const post = received(h);
  for (const key of ["author", "conversation", "parent", "quote"]) assert.equal(post[key], null, key);
  assert.equal(post.media[0].mediaId, null); assert.equal(post.media[0].video, null);
  assert.doesNotMatch(JSON.stringify(h.messages), /mutated|secret|private/);
});

test("per-script literal and post budgets also bound multi-payload streams", () => {
  const h = harness();
  h.ready();
  h.insert(script(Array.from({length: 140}, (_, i) => stream({...tweet([]), rest_id: String(i + 1)})).join(";")));
  assert.equal(h.messages.reduce((count, message) => count + message.posts.length, 0), 128);
  h.messages.length = 0;
  const batch = Array.from({length: 400}, (_, i) => ({...tweet([]), rest_id: String(i + 1)}));
  h.insert(script(stream(batch) + ";" + stream(batch)));
  assert.equal(h.messages.reduce((count, message) => count + message.posts.length, 0), 500);
});

test("normalizer bounds each response, handles cycles and rejects malformed array/scalar containers", () => {
  const h = harness();
  h.ready();
  const post = tweet([photo()]);
  post.cycle = post;
  h.observe(post);
  assert.equal(h.messages[0].posts.length, 1);
  h.observe(Array.from({length: 600}, (_, i) => ({...tweet([]), rest_id: String(i + 1)})));
  assert.equal(h.messages[1].posts.length, 500);
  h.observe({data: Array.from({length: 61000}, () => null), post: tweet([])});
  assert.equal(h.messages.length, 3, "a nearby post can be visited before the traversal budget is exhausted");
  h.observe([...Array.from({length: 61000}, () => null), tweet([])]);
  assert.equal(h.messages.length, 3, "the traversal budget stops before the far end of a wide response");
  const malformed = tweet({not: "an array"});
  malformed.legacy.conversation_id_str = {private: "private conversation"};
  malformed.core.user_results.result.core.screen_name = "a".repeat(10000);
  h.observe(malformed);
  assert.equal(h.messages.at(-1).posts[0].media, null);
  assert.equal(h.messages.at(-1).posts[0].author, null);
  assert.equal(h.messages.at(-1).posts[0].conversation, null);
  const attachment = {...photo(), video_info: {variants: [null, {url: {private: "secret"}, content_type: {}, bitrate: {}}]}};
  h.observe(tweet([attachment]));
  assert.deepEqual(normalized(h.messages.at(-1).posts[0].media[0].variants), [{}, {url: null, content_type: null, bitrate: null}]);
  assert.doesNotMatch(JSON.stringify(h.messages), /secret|private conversation/);
});

test("a representative 206 KiB script remains parseable without executing its wrapper", () => {
  const h = harness();
  h.ready();
  const payload = stream({data: tweet([photo()])});
  h.insert(script(`${" ".repeat(206 * 1024 - payload.length)}${payload}`));
  assert.equal(h.messages.length, 1);
});

test("per-script cumulative work is bounded even when source keeps changing", () => {
  const h = harness();
  h.ready();
  const node = script("");
  const padding = " ".repeat(2 * 1024 * 1024 - 2);
  for (let i = 0; i < 10; i++) h.textUpdate(node, `${padding}${i}`);
  assert.equal(h.parseCount, 0);
  h.textUpdate(node, stream(tweet([photo()])));
  assert.deepEqual(h.messages, [], "an exhausted script stays unknown instead of consuming unbounded work");
  h.insert(script(stream(tweet([photo()]))));
  assert.equal(h.messages.length, 1, "other scripts retain an independent work allowance");
});
