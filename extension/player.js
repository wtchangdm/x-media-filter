"use strict";
const status = document.getElementById("status");
const retry = document.getElementById("retry");
const port = chrome.runtime.connect({name: "player"});
let media;
let source;
let stopped = false;
function imageState(ready) {
  if (source?.kind === "image") parent.postMessage({type: "xmf-image-state", ready}, "*");
}
function stop() {
  imageState(false);
  stopped = true; source = null;
  if (media) {
    if (media.tagName === "VIDEO") media.pause();
    media.removeAttribute("src");
    if (media.tagName === "VIDEO") media.load();
    media.remove(); media = null;
  }
  status.hidden = false; status.textContent = "Media blocked"; retry.hidden = true;
}
function load() {
  if (stopped || !source) return;
  imageState(false);
  media?.remove();
  media = document.createElement(source.kind === "video" ? "video" : "img");
  // Anonymous CORS excludes cross-origin cookies. The CDN must support CORS.
  media.crossOrigin = "anonymous";
  if (source.kind === "video") {
    media.controls = true; media.preload = "metadata"; media.playsInline = true;
  } else media.alt = "Selected post image";
  media.addEventListener(source.kind === "video" ? "loadedmetadata" : "load", () => {
    status.hidden = true; retry.hidden = true;
    imageState(true);
  });
  media.addEventListener("error", () => {
    imageState(false);
    status.hidden = false; status.textContent = "Could not load selected media."; retry.hidden = false;
  });
  status.textContent = "Loading selected media…"; status.hidden = false; retry.hidden = true;
  document.body.prepend(media);
  media.src = source.url;
}
retry.addEventListener("click", load);
port.onMessage.addListener(msg => {
  if (msg.type === "stop") stop();
  else if (msg.type === "load" && !stopped) { source = msg; load(); }
});
port.onDisconnect.addListener(() => { void chrome.runtime.lastError; stop(); });
port.postMessage({type: "redeem", token: location.hash.slice(1)});
// Messaging keeps an active player's coordinator alive; no durable grants are stored.
setInterval(() => { try { port.postMessage({type: "alive"}); } catch { stop(); } }, 20000);
addEventListener("pagehide", stop);
