// Existing Chrome only: non-post UI remains visible without releasing post media.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-scope', output = '/tmp/xmf-scope.json', mode = 'normal'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/scope.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json] [cold|normal]');
const extensionId = process.env.XMF_EXTENSION_ID || 'pmkikmmocmppigkinihgchopoonpoldi';
const capture = new MediaCapture(ws, target, mode === 'cold');
const report = {version: '0.1.1', mode, routes: ['https://x.com/<test-profile>', 'https://x.com/<test-profile>/photo', 'https://x.com/ArtificialAnlys/status/2110893784422908225/photo/1'], results: []};
const profileRequests = new Map();
let popup, original;
// Retain only request outcomes for excluded profile images, never headers or bodies.
capture.cdp.on('event', event => {
  if (!capture.sessions.has(event.sessionId)) return;
  const p = event.params, key = event.sessionId + ':' + p.requestId;
  if (event.method === 'Network.requestWillBeSent' && /^https:\/\/pbs\.twimg\.com\/profile_(?:images|banners)\//.test(p.request.url))
    profileRequests.set(key, {time: p.wallTime * 1000, status: null});
  const request = profileRequests.get(key);
  if (!request) return;
  if (event.method === 'Network.responseReceived') request.status = p.response.status;
  if (event.method === 'Network.loadingFailed') request.error = p.errorText;
});
async function ab(...args) {
  return (await exec('agent-browser', ['--session', session, '--auto-connect', '--pin-tab', ...args], {timeout: 40000, maxBuffer: 1024 * 1024})).stdout.trim();
}
async function evaluate(code) { return JSON.parse(await ab('eval', '-b', Buffer.from(code).toString('base64'))); }
async function until(fn, name) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 300)); }
  throw new Error('Timed out: ' + name);
}
async function settings(filters) {
  await ab('tab', popup);
  for (const [key, value] of Object.entries(filters)) {
    await until(() => evaluate(`!document.getElementById('${key}').disabled`), 'popup ready');
    await ab(value ? 'check' : 'uncheck', '#' + key);
  }
  await until(() => evaluate(`['a','c','b'].every(k=>!document.getElementById(k).disabled)`), 'settings saved');
  await ab('tab', target);
}
const avatar = () => evaluate(`(()=>{const v=document.querySelector('[data-testid="swipe-to-dismiss"]');const i=v?.querySelector('img');return {route:location.pathname,statusScope:document.documentElement.hasAttribute('data-xmf-status'),visible:!!i&&getComputedStyle(i).visibility==='visible'&&i.getBoundingClientRect().width>0,decoded:!!i&&i.naturalWidth>0,profile:!!i&&i.src.includes('/profile_images/'),covered:!!v&&v.hasAttribute('data-xmf-covered'),slots:v?.querySelectorAll('xmf-slot').length??0}})()`);
async function assertAvatar(name, mark) {
  await until(async () => { const a = await avatar(); return a.route === '/<test-profile>/photo' && a.decoded && a.visible; }, name);
  const state = await avatar();
  assert.equal(state.profile, true); assert.equal(state.statusScope, false);
  assert.equal(state.covered, false); assert.equal(state.slots, 0);
  const requests = [...profileRequests.values()].filter(r => r.time >= mark);
  assert.ok(requests.some(r => r.status === 200), name + ': profile image HTTP response');
  assert.ok(requests.every(r => r.error !== 'net::ERR_BLOCKED_BY_CLIENT'), name + ': profile images must not be blocked');
  report.results.push({name, passed: true, ...state, profileResponses: requests.filter(r => r.status === 200).length});
  console.log('PASS', name);
}
try {
  await ab('tab', target);
  popup = JSON.parse(await ab('tab', 'new', `chrome-extension://${extensionId}/popup.html`, '--json')).data.targetId;
  original = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  await settings({a: true, c: true, b: true});
  report.settings = {a: true, c: true, b: true};
  await capture.start(); report.browser = capture.version; report.observedSiteWorkerTargets = capture.siteWorkerTargets;
  let mark = capture.mark();
  await ab('open', report.routes[0]);
  await until(() => evaluate(`!!document.querySelector('a[href="/<test-profile>/photo"] img')?.naturalWidth`), 'profile avatar');
  // Controlled DOM fixtures exercise selector scope, not network prevention.
  await evaluate(`(()=>{const f=document.createElement('div');f.id='xmf-scope-fixture';f.innerHTML='<div data-testid="tweetPhoto">Non-post photo</div><div data-testid="videoPlayer">Non-post video</div><div data-testid="swipe-to-dismiss">Non-post dialog</div>';document.body.append(f);return true})()`);
  await until(() => evaluate(`[...document.querySelectorAll('#xmf-scope-fixture > div')].every(e=>getComputedStyle(e).visibility==='visible')`), 'non-post selector scope');
  assert.equal(await evaluate(`document.querySelectorAll('#xmf-scope-fixture xmf-slot').length`), 0);
  await evaluate(`(()=>{document.getElementById('xmf-scope-fixture').remove();return true})()`);
  report.results.push({name: 'non-post photo/video/dialog DOM fixtures remain visible', passed: true});
  await ab('click', 'a[href="/<test-profile>/photo"]');
  await assertAvatar('profile avatar click', mark);
  mark = capture.mark(); await ab('reload');
  await assertAvatar('direct avatar startup', mark);

  mark = capture.mark(); await ab('open', report.routes[2]);
  await until(() => evaluate(`!!document.querySelector('[data-testid="swipe-to-dismiss"] > xmf-slot[data-ready="true"]')`), 'post viewer placeholder');
  const before = await evaluate(`(()=>{const v=document.querySelector('[data-testid="swipe-to-dismiss"]');const s=v.querySelector('xmf-slot');return {statusScope:document.documentElement.hasAttribute('data-xmf-status'),nativeHidden:getComputedStyle(v).visibility==='hidden',placeholderVisible:getComputedStyle(s).visibility==='visible',loaded:[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')).length}})()`);
  assert.deepEqual(before, {statusScope: true, nativeHidden: true, placeholderVisible: true, loaded: 0});
  await until(() => capture.since(mark).some(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'), 'post pre-click barrier');
  assert.ok(capture.since(mark).every(r => r.status === null), 'no post payload before click');
  // The first gallery shell precedes X's focused-post/metadata hydration.
  await until(() => evaluate(`!![...document.querySelectorAll('[role="dialog"] article time')].find(t=>t.closest('a')?.pathname==='/ArtificialAnlys/status/2110893784422908225')`), 'viewer focused post hydration');
  await new Promise(r => setTimeout(r, 2500));
  await ab('click', '[data-testid="swipe-to-dismiss"] > xmf-slot');
  await until(async () => (await capture.player()).some(p => p.width > 0), 'authorized viewer image');
  await until(() => capture.since(mark).every(r => r.error || r.finished), 'post request outcomes');
  const requests = capture.since(mark), success = requests.filter(r => r.status >= 200 && r.status < 300);
  const page = requests.filter(r => !r.document?.startsWith('chrome-extension://'));
  assert.ok(page.length > 0 && page.every(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'));
  assert.equal(new Set(success.map(r => policy.assetKey(r.url))).size, 1);
  assert.ok(success.every(r => r.document?.startsWith('chrome-extension://')));
  report.results.push({name: 'direct post viewer blocks until click', passed: true, ...before, pageBlocked: page.length, authorizedAssets: 1});
  console.log('PASS post viewer blocking and selection');

  const timeOrigin = await evaluate('performance.timeOrigin');
  await ab('click', '[role="dialog"] button[aria-label="Close"]');
  await until(() => evaluate(`location.pathname==='/ArtificialAnlys/status/2110893784422908225'`), 'close post viewer');
  mark = capture.mark();
  await ab('click', 'nav[aria-label="Primary"] a[href="/<test-profile>"]');
  await until(() => evaluate(`location.pathname==='/<test-profile>'&&!document.documentElement.hasAttribute('data-xmf-status')&&!!document.querySelector('a[href="/<test-profile>/photo"] img')?.naturalWidth`), 'SPA profile route');
  assert.equal(await evaluate('performance.timeOrigin'), timeOrigin, 'real SPA navigation preserves document');
  await ab('click', 'a[href="/<test-profile>/photo"]');
  await assertAvatar('avatar after post-viewer SPA navigation', mark);
  assert.equal(await evaluate('performance.timeOrigin'), timeOrigin);
  assert.equal(capture.failures.length, 0, capture.failures.join('\n'));
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); process.exitCode = 1; console.error(String(error));
  try {
    report.failureState = await evaluate(`({route:location.pathname,active:document.activeElement?.tagName,viewers:[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] > xmf-slot')].map(s=>({ready:s.dataset.ready,label:s.shadowRoot.querySelector('button')?.textContent,focused:s.shadowRoot.activeElement?.tagName,frame:!!s.shadowRoot.querySelector('iframe')}))})`);
    report.players = await capture.player();
  } catch {}
} finally {
  try { await ab('tab', target); await evaluate(`(()=>{document.getElementById('xmf-scope-fixture')?.remove();return true})()`); } catch {}
  if (original && popup) try { await settings(original); } catch (error) { report.restoreError = String(error); process.exitCode = 1; }
  await capture.stop();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (popup) try { await ab('tab', 'close', popup); await ab('tab', target); } catch {}
}
