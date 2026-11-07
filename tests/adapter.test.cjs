const assert = require("node:assert/strict");
const test = require("node:test");
const adapter = require("../extension/adapter.js");

// Deliberately small DOM double: only standard tree, attribute and selector APIs.
class Element {
  constructor(tag, attrs = {}, ...children) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = { location: { href: "https://x.com/home" } };
    this.text = "";
    for (const child of children.flat()) {
      if (typeof child === "string") this.text += child;
      else this.append(child);
    }
  }
  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  matches(selector) {
    return selector.split(",").some((part) => {
      const [, tag, attr] = part.trim().match(/^([a-z-]+)(?:\[([a-z-]+)\])?$/) || [];
      assert.ok(tag, `Unsupported test selector: ${part}`);
      return this.tagName === tag.toUpperCase() && (!attr || this.getAttribute(attr) !== null);
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
}
const el = (tag, attrs, ...children) => new Element(tag, attrs, ...children);
const imageURL = (name) => `https://pbs.twimg.com/media/${name}?format=jpg&name=small`;
const img = (name, attrs = {}) => el("img", { src: imageURL(name), ...attrs });
const permalink = (id, handle = "alice") => el("a", { href: `/${handle}/status/${id}` }, "Post");
const photo = (id, n, name, ...extra) => el("a", { href: `/alice/status/${id}/photo/${n}` }, img(name), ...extra);
const post = (id, media = [], extra = {}) => ({ id, quote: null, media, ...extra });
const media = (name, extra = {}) => ({ poster: imageURL(name), type: "photo", video: null, mediaId: null, ...extra });
const posts = (...values) => new Map(values.map((value) => [value.id, value]));
const nativePlayer = (name = "custom") => el("div", {},
  el("video", { src: "blob:https://x.com/opaque" }),
  el("div", {}, el("button", {}, "Play"), el("button", {}, "Mute"),
    el("div", {}, img(name), el("div", {}, el("button", {}, "Play video"))),
    el("div", {}, "0:00 / 0:30"), el("div", {})));

test("plain article and direct hidden image need no time, private attributes or successful fetch", () => {
  const attachment = photo("1", 1, "one", el("div", {}, "Something went wrong"));
  attachment.children[0].attrs.hidden = "";
  attachment.children[0].attrs.width = "800";
  attachment.children[0].attrs.height = "600";
  const article = el("article", {}, permalink("1"), attachment);
  const map = posts(post("1", [media("one")]));
  assert.equal(adapter.owner(article, map), "1");
  const [result] = adapter.scan(article, map);
  assert.equal(result.element, attachment);
  assert.equal(result.postId, "1");
  assert.equal(result.attachmentPost, "1");
  assert.equal(result.mediaIndex, 0);
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
  assert.equal(result.kind, "image");
  assert.equal(attachment.children.length, 2, "scan does not mutate DOM");
});

test("quote-before-parent links cannot own the enclosing article", () => {
  for (const container of ["blockquote", "article", "role-link"]) {
    const quoted = el(container === "role-link" ? "div" : container,
      container === "role-link" ? { role: "link" } : {}, permalink("2", "bob"), photo("2", 1, "quoted"));
    const article = el("article", {}, quoted, permalink("1"), photo("1", 1, "own"));
    const map = posts(post("1", [media("own")], { quote: "2" }), post("2", [media("quoted")], { author: "bob" }));
    assert.equal(adapter.owner(article, map), "1");
    const found = adapter.scan(article, map);
    assert.deepEqual(found.map((entry) => [entry.postId, entry.attachmentPost]), [["1", "2"], ["1", "1"]]);
    assert.ok(found.every((entry) => entry.article === article));
  }
});

test("metadata quote relationships disambiguate base permalinks, not media links", () => {
  const article = el("article", {}, permalink("2", "bob"), photo("2", 1, "quoted"), permalink("1"));
  assert.equal(adapter.owner(article, posts()), null);
  assert.equal(adapter.owner(article, posts(post("1", [], { quote: "2" }))), "1");
  assert.equal(adapter.owner(el("article", {}, photo("2", 1, "quoted")), posts(post("2"))), null);
  const cycle = posts(post("1", [], { quote: "2" }), post("2", [], { quote: "1" }));
  assert.equal(adapter.owner(article, cycle), null);
});

test("deduplicated status links and matching avatars identify no author metadata", () => {
  const article = el("article", {}, permalink("1", "Alice"), permalink("1", "Other"), photo("1", 1, "one"));
  const map = posts();
  const assertAssociation = () => {
    assert.equal(adapter.owner(article, map), "1");
    const found = adapter.scan(article, map);
    assert.equal(found.length, 1);
    assert.equal(found[0].postId, "1");
    assert.equal(found[0].attachmentPost, "1");
    assert.equal(Object.hasOwn(found[0], "author"), false);
  };
  assertAssociation();
  article.append(el("blockquote", {}, el("a", { href: "/Alice" }, el("img", { src: "https://pbs.twimg.com/profile_images/1/avatar.jpg" }))));
  assertAssociation();
  article.append(el("a", { href: "/Alice" }, el("img", { src: "https://pbs.twimg.com/profile_images/1/avatar.jpg" })));
  assertAssociation();
  assert.equal(map.size, 0, "DOM association never synthesizes post metadata");
  map.set("1", post("1", [media("one")], { author: "different" }));
  assertAssociation();
});

test("unknown owners remain discoverable as distinct unidentified quote surfaces", () => {
  const article = el("article", {}, permalink("1"), permalink("2"),
    el("blockquote", {}, el("div", {}, img("same"))),
    el("blockquote", {}, el("div", {}, img("same"))));
  const found = adapter.scan(article, posts());
  assert.equal(found.length, 2);
  assert.ok(found.every((entry) => entry.postId === null && entry.attachmentPost === null));
  assert.notEqual(found[0].element, found[1].element);
});

test("same-origin exact status media links work outside articles without guessing owners", () => {
  const root = el("main", {}, photo("1", 2, "two"),
    el("a", { href: "https://evil.example/alice/status/1/photo/1" }, img("bad")),
    el("a", { href: "/alice/status/1/photo/0" }, img("zero")),
    el("a", { href: "/alice/status/1/photo/1/extra" }, img("extra")),
    el("div", {}, img("unscoped")));
  const found = adapter.scan(root, posts(post("1", [media("one"), media("two")])));
  assert.equal(found.length, 1);
  assert.equal(found[0].postId, null);
  assert.equal(found[0].attachmentPost, "1");
  assert.equal(found[0].mediaIndex, 1);
});

test("source families exclude avatars, banners, icons, cards and malformed CDN paths", () => {
  const sources = [
    "https://pbs.twimg.com/profile_images/1/avatar.jpg", "https://pbs.twimg.com/profile_banners/1/2",
    "https://abs.twimg.com/emoji/icon.svg", "https://pbs.twimg.com/card_img/1/image.jpg",
    "https://pbs.twimg.com/media/../media/escaped.jpg", "https://pbs.twimg.com/media/ok.jpg#fragment",
    "https://pbs.twimg.com:443/media/port.jpg", "https://evil.example/media/other.jpg",
  ];
  const article = el("article", {}, permalink("1"),
    ...sources.map((src) => el("div", {}, el("img", { src }))),
    el("a", { href: "https://news.example/story" }, img("card")),
    el("a", { href: "/someone" }, img("profile")));
  assert.deepEqual(adapter.scan(article, posts()), []);
});

test("srcset fallback and canonical poster matching preserve native and metadata ordinals", () => {
  const one = photo("1", 1, "one");
  one.children[0].attrs.src = "data:image/gif;base64,invalid";
  one.children[0].attrs.srcset = `${imageURL("one")} 320w, ${imageURL("one")} 640w`;
  const article = el("article", {}, permalink("1"), one, photo("1", 3, "three"), el("div", {}, img("four")));
  const map = posts(post("1", [media("one", { poster: "https://pbs.twimg.com/media/one.jpg:orig" }), null, media("three"), media("four")]));
  const found = adapter.scan(article, map);
  assert.deepEqual(found.map((entry) => entry.mediaIndex), [0, 2, 3]);
  assert.ok(found.every((entry) => entry.postId === "1"));
});

test("contradictory metadata and ordinals never automatically classify an attachment", () => {
  const article = el("article", {}, permalink("1"), photo("1", 2, "one"), photo("1", 1, "unrelated"), photo("2", 1, "quoted"));
  const found = adapter.scan(article, posts(post("1", [media("one")]), post("2", [media("quoted")])));
  assert.equal(found.length, 3);
  assert.ok(found.every((entry) => entry.postId === null));
});

test("native VIDEO and SOURCE use validated MP4 families, never blob/HLS sources", () => {
  const poster = "https://pbs.twimg.com/ext_tw_video_thumb/77/pu/img/cover.jpg";
  const video = "https://video.twimg.com/ext_tw_video/77/pu/vid/640x360/movie.mp4";
  const native = el("video", { src: "blob:https://x.com/opaque", poster, width: "640", height: "360" },
    el("source", { src: "https://video.twimg.com/ext_tw_video/77/pl/list.m3u8" }), el("source", { src: video }));
  const wrapper = el("div", {}, native);
  const article = el("article", {}, permalink("1"), wrapper);
  const [found] = adapter.scan(article, posts(post("1", [{ poster, video, mediaId: "77", type: "video" }])));
  assert.equal(found.element, wrapper);
  assert.equal(found.kind, "video");
  assert.equal(found.video, video);
  assert.equal(found.mediaId, "77");
  assert.equal(found.width, 640);
  assert.equal(adapter.scan(el("main", {}, el("div", {}, native)), posts()).length, 0);
});

test("custom video covers require their media ID and do not borrow unrelated metadata", () => {
  const video = "https://video.twimg.com/amplify_video/88/vid/movie.mp4";
  const article = el("article", {}, permalink("1"), photo("1", 1, "custom"));
  const entry = media("custom", { type: "video", video, mediaId: "88" });
  assert.equal(adapter.scan(article, posts(post("1", [entry])))[0].video, video);
  for (const mediaId of [null, "1", "bad"]) {
    const [found] = adapter.scan(article, posts(post("1", [{ ...entry, mediaId }])));
    assert.equal(found.video, null);
    assert.equal(found.kind, "video");
  }
  const [other] = adapter.scan(article, posts(post("1", [media("other", { type: "video", video, mediaId: "88" })])));
  assert.equal(other.video, null);
  assert.equal(other.postId, null);
});

test("metadata-matched custom cover selects the whole current native player, not surrounding post content", () => {
  for (const type of ["video", "animated_gif"]) {
    const player = nativePlayer();
    const body = el("div", {}, "Post body");
    const related = el("a", { href: "https://example.com/story" }, "Related story");
    const sibling = photo("1", 2, "other");
    const article = el("article", {}, permalink("1"), el("div", {}, body, player, related, sibling));
    const video = "https://video.twimg.com/amplify_video/88/vid/movie.mp4";
    const entry = media("custom", { poster: "https://pbs.twimg.com/media/custom.jpg:orig", type, video, mediaId: "88" });
    const found = adapter.scan(article, posts(post("1", [entry, media("other")])));
    assert.equal(found.length, 2);
    assert.equal(found[0].element, player);
    assert.equal(found[0].postId, "1");
    assert.equal(found[0].attachmentPost, "1");
    assert.equal(found[0].mediaIndex, 0);
    assert.equal(found[0].kind, "video");
    assert.equal(found[0].video, video);
    assert.ok(found[0].element.contains(player.querySelector("video")), "native video is inside the pause/cover boundary");
    assert.ok(player.querySelectorAll("button").every((button) => found[0].element.contains(button)));
    assert.ok([body, related, sibling].every((node) => !found[0].element.contains(node)));
    assert.equal(found[1].element, sibling);
    assert.equal(player.children.length, 2, "scan does not mutate the native player");
  }
});

test("native control shells need a unique video metadata match and retain strict MP4 binding", () => {
  const player = nativePlayer();
  const article = el("article", {}, permalink("1"), player);
  const video = "https://video.twimg.com/amplify_video/88/vid/movie.mp4";
  const entry = media("custom", { type: "video", video, mediaId: "88" });
  for (const map of [posts(), posts(post("1")), posts(post("1", [media("custom")])),
    posts(post("1", [{ ...entry, poster: imageURL("other") }])), posts(post("1", [entry, entry]))]) {
    assert.deepEqual(adapter.scan(article, map), []);
  }
  for (const changes of [{ mediaId: null }, { mediaId: "99" }, { mediaId: "bad" },
    { video: "blob:https://x.com/opaque" }, { video: "https://video.twimg.com/amplify_video/88/pl/list.m3u8" }]) {
    const [found] = adapter.scan(article, posts(post("1", [{ ...entry, ...changes }])));
    assert.equal(found.element, player);
    assert.equal(found.kind, "video");
    assert.equal(found.video, null);
  }
});

test("native player recognition rejects unrelated links, fields, media and non-direct video wrappers", () => {
  const entry = media("custom", { type: "video" });
  const mutations = [
    (player) => player.append(permalink("1")),
    (player) => player.append(el("a", { href: "https://example.com" }, "Link")),
    (player) => player.append(el("a", {}, "Anchor")),
    ...["article", "blockquote", "form", "input", "textarea", "select"].map((tag) => (player) => player.append(el(tag, {}))),
    (player) => player.append(img("other")),
    (player) => player.append(el("img", { src: "https://pbs.twimg.com/profile_images/1/avatar.jpg" })),
    (player) => player.append(el("video", { src: "blob:https://x.com/second" })),
    (player) => player.append(el("div", {}, el("video", { src: "blob:https://x.com/second" }))),
    (player) => { player.children[0].attrs.poster = imageURL("other"); },
    (player) => { player.children[0].attrs.src = "https://video.twimg.com/amplify_video/99/vid/movie.mp4"; },
    (player) => {
      const video = player.children.shift();
      player.append(el("div", {}, video));
    },
    (player) => { player.children.shift(); },
  ];
  for (const mutate of mutations) {
    const player = nativePlayer();
    mutate(player);
    const article = el("article", {}, permalink("1"), player);
    assert.deepEqual(adapter.scan(article, posts(post("1", [entry]))), []);
  }
  const player = nativePlayer();
  player.children[1].append(img("custom", { src: "https://pbs.twimg.com/media/custom.jpg:large" }));
  const article = el("article", {}, permalink("1"), player);
  assert.equal(adapter.scan(article, posts(post("1", [entry])))[0].element, player);
});

const attributedPlayer = () => {
  const poster = "https://pbs.twimg.com/amplify_video_thumb/88/img/cover?format=webp&name=medium";
  const entry = { poster: "https://pbs.twimg.com/amplify_video_thumb/88/img/cover.jpg",
    type: "video", mediaId: "88", video: "https://video.twimg.com/amplify_video/88/vid/movie.mp4" };
  const credit = permalink("2", "creator");
  const controls = el("div", {}, el("button", {}, "Play"), el("img", { src: poster }), credit);
  const player = el("div", {}, el("video", { poster, src: "blob:https://x.com/opaque" }), controls);
  const article = el("article", {}, permalink("1"), player);
  return { article, player, controls, credit, entry };
};

test("metadata-proven player attribution does not compete with the enclosing permalink", () => {
  for (const representation of ["both", "video", "image"]) {
    const { article, player, controls, entry } = attributedPlayer();
    if (representation === "video") controls.children.splice(1, 1);
    if (representation === "image") delete player.children[0].attrs.poster;
    const body = el("div", {}, "Unrelated post text");
    const related = el("a", { href: "https://example.com/story" }, "Story");
    article.append(body);
    article.append(related);
    const map = posts(post("1", [entry]));
    assert.equal(adapter.owner(article, map), "1");
    const found = adapter.scan(article, map);
    assert.equal(found.length, 1);
    assert.equal(found[0].element, player);
    assert.equal(found[0].postId, "1");
    assert.equal(found[0].attachmentPost, "1");
    assert.equal(found[0].video, entry.video);
    assert.ok(!found[0].element.contains(body) && !found[0].element.contains(related));
    player.append(el("xmf-slot", {}));
    assert.equal(adapter.scan(article, map)[0].element, player, "mounted placeholder must not invalidate the shell");
  }
});

test("player credits allow profile avatars, but never unrelated images or media", () => {
  for (const src of ["https://pbs.twimg.com/profile_images/123/avatar.jpg",
    "https://pbs.twimg.com/media/other.jpg", "https://evil.example/profile_images/123/avatar.jpg"]) {
    const { article, player, credit, entry } = attributedPlayer();
    credit.append(el("img", { src }));
    player.children[1].append(el("div", {}, el("img", { src })));
    const found = adapter.scan(article, posts(post("1", [entry])));
    assert.equal(found.some((result) => result.element === player && result.postId === "1"),
      src === "https://pbs.twimg.com/profile_images/123/avatar.jpg");
  }
});

test("attribution exclusion requires unique matching metadata and preserves outside ambiguity", () => {
  for (const metadata of [[], [post("1")], [post("1", [media("other")])],
    [post("1", [attributedPlayer().entry, attributedPlayer().entry])],
    [post("1", [attributedPlayer().entry]), post("2", [attributedPlayer().entry])]]) {
    const { article } = attributedPlayer();
    assert.equal(adapter.owner(article, posts(...metadata)), null);
    assert.ok(adapter.scan(article, posts(...metadata)).every((result) => result.postId === null));
  }
  const { article, entry } = attributedPlayer();
  article.append(permalink("3"));
  assert.equal(adapter.owner(article, posts(post("1", [entry]))), null);
  assert.ok(adapter.scan(article, posts(post("1", [entry]))).every((result) => result.postId === null));
});

test("player credits cannot admit unrelated links, mismatched posters or invalid MP4 bindings", () => {
  const mutations = [
    ({ credit }) => { credit.attrs.href = "https://example.com/creator/status/2"; },
    ({ credit }) => { credit.attrs.href = "/creator"; },
    ({ credit }) => { credit.attrs.href = "/creator/status/2/video/1"; },
    ({ controls }) => controls.append(permalink("3")),
    ({ player }) => player.append(permalink("3")),
    ({ controls, player, credit }) => { controls.children.pop(); player.append(credit); },
    ({ controls }) => { controls.children.shift(); },
    ({ player }) => { player.children[0].attrs.poster = imageURL("other"); },
    ({ controls }) => { controls.children[1].attrs.src = imageURL("other"); },
    ({ entry }) => { entry.poster = imageURL("other"); },
    ({ entry }) => { entry.video = "https://video.twimg.com/amplify_video/99/vid/movie.mp4"; },
    ({ entry }) => { entry.video = "blob:https://x.com/opaque"; },
  ];
  for (const mutate of mutations) {
    const fixture = attributedPlayer();
    mutate(fixture);
    const found = adapter.scan(fixture.article, posts(post("1", [fixture.entry])));
    assert.ok(found.every((result) => result.element !== fixture.player), "unsafe shell is never replaced");
  }
});

test("attributed players preserve nested quote ownership", () => {
  const { article: quoted, entry, player } = attributedPlayer();
  const article = el("article", {}, permalink("3"), quoted);
  const map = posts(post("3", [], { quote: "1" }), post("1", [entry]));
  assert.equal(adapter.owner(article, map), "3");
  const [found] = adapter.scan(article, map);
  assert.equal(found.element, player);
  assert.equal(found.postId, "3");
  assert.equal(found.attachmentPost, "1");
});

test("native players preserve quote ownership and unknown-owner guarantees", () => {
  const entry = media("custom", { type: "video" });
  for (const container of ["blockquote", "article", "role-link"]) {
    const player = nativePlayer();
    const quote = el(container === "role-link" ? "div" : container,
      container === "role-link" ? { role: "link" } : {}, permalink("2", "bob"), player);
    const article = el("article", {}, permalink("1"), quote);
    const map = posts(post("1", [], { quote: "2" }), post("2", [entry], { author: "bob" }));
    const [found] = adapter.scan(article, map);
    assert.equal(found.element, player);
    assert.equal(found.postId, "1");
    assert.equal(found.attachmentPost, "2");
    map.set("1", post("1", [entry]));
    const changed = adapter.scan(article, map);
    assert.ok(changed.every((result) => result.postId === null));
  }
  const player = nativePlayer();
  const article = el("article", {}, permalink("1"), permalink("2"), player);
  assert.deepEqual(adapter.scan(article, posts(post("1", [entry]), post("2", [entry]))), []);
});

test("contradictory native MP4 bindings stay unknown even with independently valid metadata", () => {
  const poster = "https://pbs.twimg.com/amplify_video_thumb/88/img/cover.jpg";
  const video = "https://video.twimg.com/amplify_video/88/vid/movie.mp4";
  const wrong = "https://video.twimg.com/amplify_video/99/vid/movie.mp4";
  const article = el("article", {}, permalink("1"), el("div", {}, el("video", { poster, src: wrong })));
  for (const [map, expected] of [
    [posts(), null],
    [posts(post("1", [{ poster, video: wrong, mediaId: "88", type: "video" }])), null],
    [posts(post("1", [{ poster, video, mediaId: "88", type: "video" }])), video],
  ]) {
    const [found] = adapter.scan(article, map);
    assert.equal(found.postId, null);
    assert.equal(found.kind, "video");
    assert.equal(found.video, expected, "manual loading may only use an independently validated poster binding");
  }
});

test("duplicate representations collapse, but distinct sibling attachment surfaces remain", () => {
  const poster = "https://pbs.twimg.com/tweet_video_thumb/animated.jpg";
  const video = "https://video.twimg.com/tweet_video/animated.mp4";
  const shared = el("a", { href: "/alice/status/1/video/1" },
    el("img", { src: poster }), el("div", {}, el("video", { poster, src: video })));
  const article = el("article", {}, permalink("1"), shared, photo("1", 2, "same"), photo("1", 3, "same"));
  const found = adapter.scan(article, posts());
  assert.equal(found.length, 3);
  assert.equal(found[0].element, shared);
  assert.equal(found[0].video, video);
  assert.equal(found[0].kind, "video");
  assert.deepEqual(found.map((entry) => entry.mediaIndex), [0, 1, 2]);
});

test("unlinked semantic quote uses only a matching declared quoted post", () => {
  const quote = el("blockquote", {}, el("div", {}, img("quoted")));
  const article = el("article", {}, permalink("1"), quote);
  const map = posts(post("1", [], { quote: "2" }), post("2", [media("quoted")]));
  const [found] = adapter.scan(article, map);
  assert.equal(found.postId, "1");
  assert.equal(found.attachmentPost, "2");
  map.set("2", post("2", [media("other")]));
  const [changed] = adapter.scan(article, map);
  assert.equal(changed.postId, null);
  assert.equal(changed.attachmentPost, null);
});

test("nested unlinked poster/video representations deduplicate without merging sibling wrappers", () => {
  const poster = "https://pbs.twimg.com/tweet_video_thumb/animated.jpg";
  const video = "https://video.twimg.com/tweet_video/animated.mp4";
  const wrapper = el("div", {}, el("img", { src: poster }), el("div", {}, el("video", { poster, src: video })));
  const sibling = el("div", {}, el("img", { src: poster }));
  const article = el("article", {}, permalink("1"), wrapper, sibling);
  const found = adapter.scan(article, posts());
  assert.equal(found.length, 2);
  assert.equal(found[0].element, wrapper);
  assert.equal(found[0].video, video);
  assert.equal(found[1].element, sibling);
});

test("validated source-only video is discoverable; blobs without poster/MP4 are not", () => {
  const video = "https://video.twimg.com/ext_tw_video/77/vid/movie.mp4";
  const wrapper = el("div", {}, el("video", {}, el("source", { src: video })));
  const article = el("article", {}, permalink("1"), wrapper,
    el("div", {}, el("video", { src: "blob:https://x.com/opaque" })));
  const [found] = adapter.scan(article, posts());
  assert.equal(found.element, wrapper);
  assert.equal(found.video, video);
  assert.equal(found.poster, null);
  assert.equal(found.kind, "video");
  assert.equal(adapter.scan(article, posts()).length, 1);
});

test("fallback surface is non-void, media-only and never a text/action/article container", () => {
  const safe = el("div", {}, img("safe"));
  const article = el("article", {}, permalink("1"), safe,
    el("div", {}, "Post body", img("text")), el("button", {}, img("button")),
    el("div", {}, img("actions"), el("button", {}, "Like")), img("direct"));
  const found = adapter.scan(article, posts());
  assert.equal(found.length, 1);
  assert.equal(found[0].element, safe);
});

test("owners are recomputed after DOM and metadata changes, including subtree scans", () => {
  const own = permalink("1");
  const attachment = photo("1", 1, "one");
  const article = el("article", {}, own, attachment);
  const map = posts(post("1", [media("one")]));
  assert.equal(adapter.scan(article, map)[0].postId, "1");
  map.set("1", post("1", [media("other")]));
  assert.equal(adapter.scan(attachment.children[0], map)[0].postId, null);
  map.set("1", post("1", [media("one")]));
  assert.equal(adapter.scan(attachment.children[0], map)[0].postId, "1");
  own.attrs.href = "/bob/status/2";
  assert.equal(adapter.scan(article, map)[0].postId, null);
  attachment.attrs.href = "/bob/status/2/photo/1";
  map.set("2", post("2", [media("one")], { author: "bob" }));
  assert.equal(adapter.scan(article, map)[0].postId, "2");
});
