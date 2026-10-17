// Checks existing Chrome only; stores aggregate counts, never post text or API bodies.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-user', output = '/tmp/xmf-surfaces.json'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/surfaces.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json]');
const capture = new MediaCapture(ws, target);
const results = [];
const id = process.env.XMF_EXTENSION_ID || 'pmkikmmocmppigkinihgchopoonpoldi';
let popup, settings;
async function ab(...args) { return (await exec('agent-browser', ['--session', session, '--auto-connect', '--pin-tab', ...args], {timeout: 40000, maxBuffer: 1024 * 1024})).stdout.trim(); }
async function evaluate(code) { return JSON.parse(await ab('eval', '-b', Buffer.from(code).toString('base64'))); }
async function until(fn, name) {
  for (let i = 0; i < 60; i++) { if (await fn()) return; await new Promise(r=>setTimeout(r, 500)); }
  throw new Error('Timed out: ' + name);
}
const routes = [
  ['media viewer', 'https://x.com/ArtificialAnlys/status/2110893784422908225/photo/1'],
  ['home', 'https://x.com/home'],
  ['profile', 'https://x.com/ArtificialAnlys'],
  ['media grid', 'https://x.com/ArtificialAnlys/media'],
  ['search', 'https://x.com/search?q=from%3AArtificialAnlys&src=typed_query&f=live'],
  ['bookmarks', 'https://x.com/i/bookmarks'],
  ['notifications', 'https://x.com/notifications'],
];
let error;
try {
  await ab('tab', target);
  await ab('tab', 'new', `chrome-extension://${id}/popup.html`);
  popup = JSON.parse(await ab('tab', 'list', '--json')).data.tabs.find(t=>t.active).targetId;
  settings = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  assert.deepEqual(settings, {a:true,c:true,b:true}, 'precondition: all three filters must be ON');
  await ab('tab', 'close', popup); popup = null; await ab('tab', target);
  await capture.start();
  for (const [name, url] of routes) {
    const mark = capture.mark();
    await ab('open', url); await ab('tab', target);
    await until(()=>evaluate(`document.readyState==='complete' && !!document.querySelector('main')`), name + ' shell');
    // Scroll is an intended discovery action; a short settle allows delayed API rendering.
    await ab('scroll', 'down', '600');
    await new Promise(r=>setTimeout(r, 2500));
    const state = await evaluate(`({slots:document.querySelectorAll('xmf-slot').length,loaded:[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot?.querySelector('iframe')).length,categories:[...new Set([...document.querySelectorAll('xmf-slot')].map(s=>s.dataset.category))],viewer:!!document.querySelector('[data-testid="swipe-to-dismiss"] > xmf-slot'),avatars:[...document.images].filter(i=>i.src.includes('/profile_images/')&&i.naturalWidth>0).length,siteWorker:!!navigator.serviceWorker.controller})`);
    assert.equal(state.loaded, 0, name + ': all filters ON');
    if (name !== 'media viewer') assert.ok(state.categories.every(c=>c==='A'), name + ': feed must use A');
    const requests = capture.since(mark);
    assert.ok(requests.every(r=>r.status===null && r.error==='net::ERR_BLOCKED_BY_CLIENT'), name + ': unauthorized media transfer');
    const result = {name, ...state, requests: requests.length, outcome: state.slots ? 'blocked placeholders' : 'no media items available; not validated'};
    if (name === 'media viewer') {
      assert.ok(state.viewer, 'selected viewer needs its own placeholder');
      await evaluate(`(async()=>{const s=document.querySelector('[data-testid="swipe-to-dismiss"] > xmf-slot');await s.scrollIntoView({block:'center',behavior:'instant'});s.shadowRoot.querySelector('button').focus();return true})()`);
      await ab('press', 'Enter');
      await until(async()=> (await capture.player()).some(p=>p.width>0), 'viewer image');
      const payloads = capture.since(mark).filter(r=>r.status===200);
      assert.equal(new Set(payloads.map(r=>r.url)).size, 1, 'viewer click cannot authorize neighbors');
      assert.ok(payloads.every(r=>r.document.startsWith('chrome-extension://')));
      result.selectedImageLoaded = true;
    }
    results.push(result); console.log('PASS', name, result.outcome);
  }
} catch (e) { error=String(e); process.exitCode=1; console.error(error); }
finally {
  if (popup) { try {await ab('tab','close',popup);await ab('tab',target);} catch {} }
  await capture.stop();
  await writeFile(output, JSON.stringify({browser:capture.version,observedSiteWorkerTargets:capture.siteWorkerTargets,settings,results,error,failures:capture.failures},null,2)+'\n');
  console.log('Saved aggregate report:', output);
}
