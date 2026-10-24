// Existing Chrome only: hard-refresh and SPA regression for the native viewer sidebar.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-layout', output = '/tmp/xmf-layout.json', mode = 'normal'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/layout.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json] [cold|normal]');
const extensionId = process.env.XMF_EXTENSION_ID || 'pmkikmmocmppigkinihgchopoonpoldi';
const route = 'https://x.com/ArtificialAnlys/status/2110893784422908225';
const photo = '/ArtificialAnlys/status/2110893791951675416/photo/1';
const slot = `[role="dialog"] article a[href="${photo}"] xmf-slot`;
const capture = new MediaCapture(ws, target, mode === 'cold');
const report = {version: '0.1.1', route: route + '/photo/1', mode, settings: {a: true, c: true, b: true}, results: []};
let popup, original;
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
async function inspect(name) {
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(slot)})?.shadowRoot.querySelector('button')`), name + ' sidebar placeholder');
  const state = await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(slot)});s.scrollIntoView({block:'center',behavior:'instant'});const b=s.shadowRoot.querySelector('button'),a=s.closest('a'),p=s.parentElement;const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};return {slot:rect(s),button:rect(b),media:rect(p),link:rect(a),border:getComputedStyle(b).borderTopWidth,visible:getComputedStyle(s).visibility==='visible',nativeHidden:getComputedStyle(p).visibility==='hidden',loaded:[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')).length}})()`);
  assert.ok(state.visible && state.nativeHidden);
  assert.equal(state.loaded, 0);
  assert.equal(state.border, '0px');
  assert.ok(state.slot.width <= state.link.width + 1, name + ': placeholder fits sidebar link');
  assert.ok(state.slot.left >= state.link.left - 1 && state.slot.right <= state.link.right + 1);
  assert.ok(Math.abs(state.button.width - state.slot.width) < 1);
  assert.ok(Math.abs(state.media.width - state.slot.width) < 1);
  report.results.push({name, passed: true, ...state});
  console.log('PASS', name, 'slot/link widths', state.slot.width, state.link.width);
}
try {
  await ab('tab', target);
  popup = JSON.parse(await ab('tab', 'new', `chrome-extension://${extensionId}/popup.html`, '--json')).data.targetId;
  original = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  await settings(report.settings);
  await capture.start(); report.browser = capture.version; report.observedSiteWorkerTargets = capture.siteWorkerTargets;
  const mark = capture.mark();
  await ab('open', report.route);
  await capture.cdp.call('Page.reload', {ignoreCache: true}, capture.root);
  await inspect('direct viewer hard refresh');
  const origin = await evaluate('performance.timeOrigin');
  await ab('click', '[role="dialog"] button[aria-label="Close"]');
  await until(() => evaluate(`location.pathname===${JSON.stringify(new URL(route).pathname)}`), 'viewer closed');
  // Activate X's native link with a trusted key, not a synthetic navigation event.
  await until(() => evaluate(`(()=>{const a=document.querySelector('a[href="/ArtificialAnlys/status/2110893784422908225/photo/1"]');if(!a)return false;a.focus();return document.activeElement===a})()`), 'native photo link focus');
  await ab('press', 'Enter');
  await until(() => evaluate(`location.pathname.endsWith('/2110893784422908225/photo/1')`), 'native viewer SPA navigation');
  await inspect('post-to-viewer SPA');
  assert.equal(await evaluate('performance.timeOrigin'), origin, 'SPA preserves document');
  await capture.cdp.call('Page.reload', {ignoreCache: true}, capture.root);
  await inspect('hard refresh after SPA');
  // A duplicate uses the real attachment URL but must not inherit selection.
  await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(slot)}),a=s.closest('article'),copy=a.cloneNode(true);copy.id='xmf-layout-duplicate';copy.querySelectorAll('xmf-slot').forEach(s=>s.remove());a.after(copy);s.id='xmf-layout-selected';return true})()`);
  await until(() => evaluate(`!!document.querySelector('#xmf-layout-duplicate xmf-slot')`), 'duplicate placeholder');
  await until(() => capture.since(mark).some(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'), 'pre-click media blocking');
  assert.ok(capture.since(mark).every(r => r.status === null), 'no media success before selection');
  const click = capture.mark();
  await ab('click', '#xmf-layout-selected');
  await until(async () => (await capture.player()).some(p => p.width > 0), 'selected sidebar image decoded');
  assert.equal(await evaluate(`!!document.querySelector('#xmf-layout-duplicate xmf-slot').shadowRoot.querySelector('iframe')`), false);
  await until(() => capture.since(mark).every(r => r.error || r.finished), 'request outcomes');
  const requests = capture.since(mark), success = requests.filter(r => r.status >= 200 && r.status < 300);
  assert.equal(success.length, 1);
  assert.ok(success.every(r => r.time >= click && r.document?.startsWith('chrome-extension://')));
  const page = requests.filter(r => !r.document?.startsWith('chrome-extension://'));
  assert.ok(page.length > 0 && page.every(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'));
  report.results.push({name: 'sidebar selection and duplicate isolation', passed: true, pageBlocked: page.length, authorizedResponses: success.length, statuses: success.map(r => r.status)});
  assert.equal(capture.failures.length, 0, capture.failures.join('\n'));
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); process.exitCode = 1; console.error(String(error));
} finally {
  try { await ab('tab', target); await evaluate(`(()=>{document.getElementById('xmf-layout-duplicate')?.remove();return true})()`); } catch {}
  if (original && popup) try { await settings(original); } catch (error) { report.restoreError = String(error); process.exitCode = 1; }
  await capture.stop();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (popup) try { await ab('tab', 'close', popup); await ab('tab', target); } catch {}
}
