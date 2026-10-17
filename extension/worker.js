"use strict";
importScripts("policy.js");
const P = XMFPolicy;
const sessions = new Map();
const tickets = new Map();
const players = new Map();
// Fail closed until storage succeeds, independently of fresh-install defaults.
let settings = {a: true, c: true, b: true};
let revision = 0;
let loaderSafe = false;
// The first request is authorized; reject redirect responses before following Location.
// This response-stage rule is NOT the page's pre-request barrier (rules.json is).
const redirectGuard = chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [10], addRules: [{
  id: 10, priority: 10, action: {type: "block"},
  condition: {initiatorDomains: [chrome.runtime.id], requestDomains: ["pbs.twimg.com", "video.twimg.com"],
    responseHeaders: [{header: "location"}]},
}]}).then(() => { loaderSafe = true; }).catch(() => {});
const ready = Promise.all([redirectGuard, chrome.storage.local.get("filters").then(raw => {
  if (revision === 0) settings = P.normalizeSettings(raw.filters);
}).catch(() => {})]);

function send(port, message) {
  try { port.postMessage(message); } catch { /* A disconnected document is already revoked. */ }
}
function revoke(session, id, notify = false) {
  session.pending.delete(id);
  const ticket = session.items.get(id);
  if (!ticket) return;
  tickets.delete(ticket.token);
  const player = players.get(ticket.token);
  if (player) { send(player, {type: "stop"}); players.delete(ticket.token); }
  session.items.delete(id);
  if (notify) send(session.port, {type: "revoked", id, epoch: session.epoch, settings});
}
function clear(session) {
  session.pending.clear();
  for (const id of session.items.keys()) revoke(session, id);
}
function isX(url) {
  try { const u = new URL(url); return u.protocol === "https:" && (u.hostname === "x.com" || u.hostname.endsWith(".x.com")); }
  catch { return false; }
}
async function current(session) {
  try {
    const tab = await chrome.tabs.get(session.tab);
    if (sessions.get(session.tab) !== session || !isX(tab.url) || P.routeKey(tab.url) !== session.route) return false;
    const reply = await chrome.tabs.sendMessage(session.tab, {type: "xmf-context", route: session.route, epoch: session.epoch},
      {documentId: session.document});
    return sessions.get(session.tab) === session && reply?.epoch === session.epoch && reply?.route === session.route;
  } catch { return false; }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.filters) return;
  const previous = settings;
  settings = P.normalizeSettings(changes.filters.newValue);
  revision++;
  const turnedOn = category => ["A", "C", "B"].some(candidate =>
    (category === null || category === candidate) && !P.blocked(previous, candidate) && P.blocked(settings, candidate));
  for (const session of sessions.values()) {
    for (const [id, ticket] of session.items) {
      if (turnedOn(ticket.category)) revoke(session, id, true);
    }
    send(session.port, {type: "settings", settings, revision});
  }
});

chrome.runtime.onConnect.addListener(port => {
  const sender = port.sender;
  if (sender?.id !== chrome.runtime.id || !sender.tab || typeof sender.documentId !== "string") { port.disconnect(); return; }
  if (port.name === "coordinator" && sender.frameId === 0 && isX(sender.url)) {
    const previous = sessions.get(sender.tab.id);
    if (previous) clear(previous);
    const session = {port, tab: sender.tab.id, document: sender.documentId, route: null, epoch: null, items: new Map(), pending: new Map()};
    sessions.set(session.tab, session);
    ready.then(() => send(port, {type: "settings", settings, revision}));
    port.onMessage.addListener(async msg => {
      if (!msg || sessions.get(session.tab) !== session) return;
      if (msg.type === "context" && typeof msg.route === "string" && typeof msg.epoch === "string") {
        clear(session); session.route = msg.route; session.epoch = msg.epoch; return;
      }
      if (msg.type === "revoke") { revoke(session, msg.id); return; }
      if (msg.type === "category") {
        const ticket = session.items.get(msg.id);
        if (ticket && msg.epoch === session.epoch && ["A", "C", "B", null].includes(msg.category)) {
          ticket.category = msg.category;
          if (!ticket.manual && P.blocked(settings, ticket.category)) revoke(session, msg.id, true);
        }
        return;
      }
      if (msg.type !== "grant") return;
      if (typeof msg.id !== "string" || msg.id.length > 1000 || session.pending.size >= 300) {
        send(port, {type: "denied", epoch: msg.epoch}); return;
      }
      const request = {};
      session.pending.set(msg.id, request);
      const epoch = session.epoch;
      const version = revision;
      await ready;
      const url = P.mediaURL(msg.url, msg.kind);
      if (!loaderSafe || !url || (msg.kind === "video" && !P.videoMatchesPoster(msg.poster, url, msg.mediaId)) || typeof msg.id !== "string" || msg.id.length > 1000 || msg.epoch !== epoch ||
          typeof msg.manual !== "boolean" || !["A", "C", "B", null].includes(msg.category) ||
          (!msg.manual && P.blocked(settings, msg.category)) || session.items.size >= 300 ||
          !(await current(session)) || session.epoch !== epoch || revision !== version || session.pending.get(msg.id) !== request) {
        if (session.pending.get(msg.id) === request) session.pending.delete(msg.id);
        send(port, {type: "denied", id: msg.id, epoch: msg.epoch}); return;
      }
      revoke(session, msg.id);
      const ticket = {token: crypto.randomUUID(), id: msg.id, url, kind: msg.kind, category: msg.category, manual: msg.manual,
        epoch, session, consumed: false, expires: Date.now() + 15000};
      session.items.set(msg.id, ticket); tickets.set(ticket.token, ticket);
      send(port, {type: "ticket", id: msg.id, token: ticket.token, epoch});
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      clear(session);
      if (sessions.get(session.tab) === session) sessions.delete(session.tab);
    });
  } else if (port.name === "player" && sender.frameId > 0 && sender.url?.startsWith(chrome.runtime.getURL("player.html"))) {
    let token;
    port.onMessage.addListener(async msg => {
      if (token || msg?.type !== "redeem" || typeof msg.token !== "string") return;
      token = msg.token;
      const ticket = tickets.get(token);
      tickets.delete(token);
      if (!ticket || ticket.consumed || ticket.expires < Date.now() || ticket.session.tab !== sender.tab.id ||
          ticket.session.epoch !== ticket.epoch || ticket.session.items.get(ticket.id) !== ticket ||
          !(await current(ticket.session)) || ticket.session.items.get(ticket.id) !== ticket) {
        send(port, {type: "stop"}); return;
      }
      ticket.consumed = true;
      players.set(token, port);
      send(port, {type: "load", kind: ticket.kind, url: ticket.url});
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (players.get(token) === port) players.delete(token);
    });
  } else port.disconnect();
});
