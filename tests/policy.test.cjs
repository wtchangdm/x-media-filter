"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../extension/policy.js");
const { normalizeSettings, routeKey, statusId, classify, blocked, mediaURL, sameAsset, chooseVideo } = policy;

const image = "https://pbs.twimg.com/media/Abc_123-xyz?format=jpg&name=small";
const video = "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/Abc-123.mp4?tag=12";

test("same frozen API is available to CommonJS and a plain browser global", () => {
  assert.ok(Object.isFrozen(policy));
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(require.resolve("../extension/policy.js"), "utf8"), context);
  assert.deepEqual(Object.keys(context.XMFPolicy).sort(), Object.keys(policy).sort());
  assert.equal(context.XMFPolicy.mediaURL(image, "image"), image);
});

test("invalid or missing settings default independently to fresh OFF/OFF/ON preferences", () => {
  for (const raw of [undefined, null, false, 0, "off", {}, { a: 0, c: "true", b: "false" }]) {
    assert.deepEqual(normalizeSettings(raw), { a: false, c: false, b: true });
  }
  assert.deepEqual(normalizeSettings({ a: true }), { a: true, c: false, b: true });
  assert.deepEqual(normalizeSettings({ c: true }), { a: false, c: true, b: true });
  assert.deepEqual(normalizeSettings({ b: false, extra: true }), { a: false, c: false, b: false });
  for (const c of [undefined, null, 0, "true"]) {
    assert.deepEqual(normalizeSettings({ a: true, c, b: false }), { a: true, c: false, b: false });
  }
});

for (const a of [true, false]) {
  for (const b of [true, false]) {
    test(`legacy settings A=${a}, B=${b} preserve author preferences without mutation`, () => {
      const legacy = Object.freeze({ a, b });
      const migrated = normalizeSettings(legacy);
      assert.deepEqual(migrated, { a, c: a, b });
      assert.deepEqual(normalizeSettings(migrated), migrated);
      assert.equal(blocked(legacy, "C"), a);
    });
    for (const c of [true, false]) {
      test(`settings A=${a}, C=${c}, B=${b}, including unknown classification`, () => {
        const settings = { a, c, b };
        assert.deepEqual(normalizeSettings(settings), settings);
        assert.equal(blocked(settings, "A"), a);
        assert.equal(blocked(settings, "C"), c);
        assert.equal(blocked(settings, "B"), b);
        for (const unknown of [null, undefined, "D", "", "a"]) {
          assert.equal(blocked(settings, unknown), a || c || b);
        }
      });
    }
  }
}

test("status routes retain identity across media viewers and ignore the URL handle", () => {
  for (const suffix of ["", "/", "/photo/2", "/video/1?foo=bar#fragment"]) {
    const url = `https://x.com/notTheVerifiedAuthor/status/1234567890123456789${suffix}`;
    assert.equal(statusId(url), "1234567890123456789");
    assert.equal(routeKey(url), "status:1234567890123456789");
  }
  assert.equal(statusId("https://x.com/i/web/status/123"), "123");
  assert.equal(routeKey("https://x.com/other/status/123"), "status:123");
  for (const path of ["/home", "/search?q=a&f=live", "/alice/media", "/alice/status/nope", "/alice/status/123abc", "/alice/status/123/other", "/alice/status/123/photo/nope"]) {
    assert.equal(statusId(`https://x.com${path}`), null);
    assert.equal(routeKey(`https://x.com${path}#ignored`), `https://x.com${path}`);
  }
  for (const bad of [null, undefined, {}, "not a url", "/alice/status/123"]) {
    assert.equal(statusId(bad), null);
    assert.equal(routeKey(bad), null);
  }
});

test("classification uses the focused post and proven relationship, not position or quotes", () => {
  const focus = { focusId: "200", focusAuthor: "@ActualAuthor" };
  assert.equal(classify({ postId: "1", postAuthor: "any" }), "A");
  assert.equal(classify({ focusId: null, relationship: "conversation" }), "A");
  assert.equal(classify({ ...focus, postId: "200" }), "A");
  // A preceding ancestor is not the focus; its verified author determines its category.
  assert.equal(classify({ ...focus, postId: "100", postAuthor: "ancestor", relationship: "conversation" }), "B");
  assert.equal(classify({ ...focus, postId: "201", postAuthor: "actualauthor", relationship: "conversation" }), "C");
  assert.equal(classify({ ...focus, postId: "100", postAuthor: "ActualAuthor", relationship: "conversation" }), "C");
  assert.equal(classify({ ...focus, postId: "202", postAuthor: "other", relationship: "conversation" }), "B");
  assert.equal(classify({ ...focus, postId: "203", postAuthor: "other", relationship: "independent" }), "A");
  // Nested quote authors are not inputs; the adapter must supply the enclosing post.
  assert.equal(classify({ ...focus, postId: "201", postAuthor: "ActualAuthor", quotedAuthor: "other", relationship: "conversation" }), "C");
  for (const relationship of [undefined, null, "unknown", "reply"]) {
    assert.equal(classify({ ...focus, postAuthor: "ActualAuthor", relationship }), null);
  }
  assert.equal(classify({ ...focus, postAuthor: "", relationship: "conversation" }), null);
  assert.equal(classify({ focusId: "200", postAuthor: "someone", relationship: "conversation" }), null);
});

test("media validator recognizes only the supported image/poster and progressive MP4 families", () => {
  for (const url of [image, "https://pbs.twimg.com/media/Abc.jpg:large", "https://pbs.twimg.com/tweet_video_thumb/Abc.jpg", "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/Abc.jpg", "https://pbs.twimg.com/amplify_video_thumb/123/img/Abc?format=jpg&name=orig"]) {
    assert.equal(mediaURL(url, "image"), url);
    assert.equal(mediaURL(url, "video"), null);
  }
  for (const url of [video, "https://video.twimg.com/tweet_video/Abc.mp4", "https://video.twimg.com/amplify_video/123/vid/640x360/Abc.mp4"]) {
    assert.equal(mediaURL(url, "video"), url);
    assert.equal(mediaURL(url, "image"), null);
  }
  assert.equal(mediaURL("HTTPS://PBS.TWIMG.COM/media/Abc?format=jpg", "image"), "https://pbs.twimg.com/media/Abc?format=jpg");
  assert.equal(mediaURL(image, "unknown"), null);
});

test("hostile, malformed, non-post, playlist, and segment URLs are rejected before normalization", () => {
  const hostile = [
    null, {}, 123, "", "/media/Abc", "//pbs.twimg.com/media/Abc",
    "http://pbs.twimg.com/media/Abc", "https://evil.test/media/Abc",
    "https://pbs.twimg.com.evil.test/media/Abc", "https://pbs.twimg.com@evil.test/media/Abc",
    "https://evil.test@pbs.twimg.com/media/Abc", "https://user:pass@pbs.twimg.com/media/Abc",
    "https://@pbs.twimg.com/media/Abc", "https://pbs.twimg.com:8443/media/Abc",
    "https://pbs.twimg.com:443/media/Abc", "https://pbs.twimg.com./media/Abc",
    `${image}#fragment`, `${image}#`, ` ${image}`, `${image}\n`,
    "https://pbs.twimg.com/media/a/../Abc", "https://pbs.twimg.com/media/./Abc",
    "https://pbs.twimg.com/media/%2e%2e/media/Abc", "https://pbs.twimg.com/media/a%2Fb",
    "https://pbs.twimg.com/media/a\\..\\Abc", "https://pbs.twimg.com/media//Abc",
    "https://pbs.twimg.com/profile_images/123/avatar.jpg", "https://pbs.twimg.com/profile_banners/123/456",
    "https://pbs.twimg.com/card_img/123/preview.jpg", "https://pbs.twimg.com/media/Abc.svg",
    "https://video.twimg.com/amplify_video/123/pl/Abc.m3u8",
    "https://video.twimg.com/amplify_video/123/vid/Abc.m4s", "https://video.twimg.com/unknown/Abc.mp4",
    "https://video.twimg.com/tweet_video/../tweet_video/Abc.mp4",
    "https://user@video.twimg.com/tweet_video/Abc.mp4", `${video}#`,
    "https://video.twimg.com:9999/tweet_video/Abc.mp4",
  ];
  for (const url of hostile) {
    assert.equal(mediaURL(url, "image"), null, String(url));
    assert.equal(mediaURL(url, "video"), null, String(url));
  }
});

test("asset comparison ignores image sizing query but never merges different paths or kinds", () => {
  assert.equal(sameAsset(image, image.replace("small", "orig")), true);
  assert.equal(sameAsset(image, 'https://pbs.twimg.com/media/Abc_123-xyz.jpg'), true);
  assert.equal(sameAsset(image, 'https://pbs.twimg.com/media/Abc_123-xyz.png:orig'), true);
  assert.equal(sameAsset(image, image.replace("Abc_123-xyz", "different")), false);
  assert.equal(sameAsset(video, video.replace("tag=12", "tag=16")), true);
  assert.equal(sameAsset(video, video.replace("1280x720", "640x360")), false);
  assert.equal(sameAsset(image, video), false);
  assert.equal(sameAsset("https://evil.test/media/a", "https://evil.test/media/a"), false);
  assert.equal(sameAsset(null, null), false);
});

test("video sources must belong to the selected poster's media family and ID", () => {
  const poster = 'https://pbs.twimg.com/ext_tw_video_thumb/123/img/Poster.jpg';
  assert.equal(policy.videoMatchesPoster(poster, video), true);
  assert.equal(policy.videoMatchesPoster(poster.replace('/123/', '/124/'), video), false);
  assert.equal(policy.videoMatchesPoster(poster, video.replace('ext_tw_video', 'amplify_video')), false);
  assert.equal(policy.videoMatchesPoster('https://pbs.twimg.com/tweet_video_thumb/Abc.jpg', 'https://video.twimg.com/tweet_video/Abc.mp4'), true);
  assert.equal(chooseVideo([{content_type: 'video/mp4', url: video}], poster).url, video);
  assert.equal(chooseVideo([{content_type: 'video/mp4', url: video}], poster.replace('/123/', '/124/')), null);
});

test("custom video covers bind MP4 variants to the explicit media ID", () => {
  for (const family of ["ext_tw_video", "amplify_video"]) {
    const source = video.replace("ext_tw_video", family);
    assert.equal(policy.videoMatchesPoster(image, source, "123"), true);
    assert.equal(chooseVideo([{content_type: "video/mp4", url: source}], image, "123").url, source);
    for (const id of [undefined, null, "124", 123, {}, "", " 123", "1/123", "1".repeat(26)]) {
      assert.equal(policy.videoMatchesPoster(image, source, id), false);
      assert.equal(chooseVideo([{content_type: "video/mp4", url: source}], image, id), null);
    }
  }
  assert.equal(policy.videoMatchesPoster(image, "https://video.twimg.com/tweet_video/123.mp4", "123"), false);
});

test("metadata cannot override a thumbnail's encoded family or media ID", () => {
  const poster = "https://pbs.twimg.com/amplify_video_thumb/456/img/Poster.jpg";
  assert.equal(policy.videoMatchesPoster(poster, video, "123"), false);
  assert.equal(policy.videoMatchesPoster(poster.replace("456", "123"), video, "123"), false);
  assert.equal(policy.videoMatchesPoster(poster.replace("456", "123"), video.replace("ext_tw_video", "amplify_video"), "456"), false);
  assert.equal(policy.videoMatchesPoster(image, video.replace("https://", "http://"), "123"), false);
  assert.equal(policy.videoMatchesPoster(image, video.replace("video.twimg.com", "evil.test"), "123"), false);
});

test("custom cover video selection rejects unrelated variants before choosing bitrate", () => {
  const selected = {content_type: "video/mp4", bitrate: 950000, url: video};
  const unrelated = {content_type: "video/mp4", bitrate: 2176000, url: video.replace("/123/", "/456/")};
  assert.deepEqual(chooseVideo([unrelated, selected], image, "123"), {url: video, bitrate: 950000});
});

test("video selection prefers the highest valid bitrate at or below 2.5 Mbps", () => {
  const variant = (bitrate, name = String(bitrate)) => ({ content_type: "video/mp4", bitrate, url: `https://video.twimg.com/tweet_video/${name}.mp4` });
  const variants = [variant(4000000), variant(500000), variant(2500000), variant(2000000)];
  assert.deepEqual(chooseVideo(variants), { url: variants[2].url, bitrate: 2500000 });
  assert.deepEqual(chooseVideo([variant(5000000), variant(3000000)]), { url: variant(3000000).url, bitrate: 3000000 });
  assert.deepEqual(chooseVideo([
    { content_type: "application/x-mpegURL", bitrate: 2500000, url: video },
    { content_type: "video/mp4", bitrate: 2500000, url: video.replace("https://", "https://user:pass@") },
    { content_type: "video/mp4", bitrate: 2500000, url: video.replace(".mp4", ".m3u8") },
    variant(1000000),
  ]), { url: variant(1000000).url, bitrate: 1000000 });
  assert.deepEqual(chooseVideo([{ content_type: "video/mp4", url: video }]), { url: video, bitrate: 0 });
  assert.deepEqual(chooseVideo([variant(NaN, "nan"), variant(1000000)]), { url: variant(1000000).url, bitrate: 1000000 });
  for (const input of [null, undefined, {}, [], [null, {}, "bad"], [{ url: video }]]) {
    assert.equal(chooseVideo(input), null);
  }
});
