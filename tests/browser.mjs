// Current-X regression: trusted agent-browser input and scoped Chrome network evidence.
// No page text, API bodies, headers or browser-control URLs are written to reports.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws, target, session, output = '/tmp/xmf-validation.json', mode = 'cold'] = process.argv.slice(2);
const id = process.env.XMF_EXTENSION_ID;
assert.ok(ws && target && session && /^[a-p]{32}$/.test(id || '') && ['cold', 'normal'].includes(mode),
  'Usage: XMF_EXTENSION_ID=<id> node tests/browser.mjs <browser-ws> <owned-target> <attached-session> [report.json] [cold|normal]');
const fixtures = {
  thread: 'https://x.com/ArtificialAnlys/status/2110893784422908225',
  album: 'https://x.com/Cloudflare/status/2111522160153882734',
  customVideo: 'https://x.com/github/status/2111225205309780009',
  encodedVideo: 'https://x.com/thsottiaux/status/2111249534072529256',
  attributedVideo: 'https://x.com/ctatedev/status/2118853661040295997',
};
const allOn = {a: true, c: true, b: true};
const report = {mode, results: [], gaps: ['All eight settings on live surfaces', 'Quote/mixed/GIF fixtures',
  'Home/search/profile/account-dependent surfaces', 'Cross-tab and worker/browser restart',
  'Native BFCache', 'Adaptive HLS playback (fixed MP4 only)']};
const capture = new MediaCapture(ws, target, mode === 'cold');
let popup, popupSession, original;
async function ab(...args) {
  try { return (await exec('agent-browser', ['--session', session, '--cdp', ws, '--pin-tab', ...args],
    {timeout: 40000, maxBuffer: 1024 * 1024})).stdout.trim(); }
  catch (error) {
    const kind = String(error.stderr || '').match(/covered|not found|strict mode|timeout|detached/i)?.[0] || 'command error';
    throw new Error(`agent-browser ${args[0]} failed: ${kind} (arguments redacted)`);
  }
}
async function evaluate(expression, sessionId = capture.root) {
  const reply = await capture.cdp.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId);
  assert.ok(!reply.exceptionDetails, 'browser evaluation failed'); return reply.result.value;
}
async function until(check, name) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value; }
    catch (error) { if (!/Cannot find context with specified id|Execution context was destroyed/.test(String(error))) throw error; }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Timed out: ' + name);
}
async function settings(value) {
  await evaluate(`chrome.storage.local.set({filters:${JSON.stringify(value)}})`, popupSession);
  await until(async () => {
    const saved = await evaluate('chrome.storage.local.get("filters").then(r=>r.filters)', popupSession);
    return ['a', 'c', 'b'].every(key => saved[key] === value[key]);
  }, 'saved settings');
}
const slots = () => evaluate(`[...document.querySelectorAll('xmf-slot')].map(s=>({post:s.dataset.post,index:s.dataset.index,
  category:s.dataset.category,ready:s.dataset.ready==='true',loaded:!!s.shadowRoot.querySelector('iframe'),
  pending:!!s.shadowRoot.querySelector('button')?.disabled,duplicate:!!s.closest('#xmf-test-duplicate'),
  visible:(()=>{const r=s.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(s).visibility==='visible'})()}))`);
const gallery = () => evaluate('!!document.querySelector("xmf-gallery")');
async function navigate(alias, suffix = '') {
  const mark = capture.mark(); await ab('open', fixtures[alias] + suffix);
  await until(async () => await evaluate('location.href') === fixtures[alias] + suffix, alias + ' route');
  const controlled = await evaluate('!!navigator.serviceWorker.controller');
  report.siteWorkerControlled ||= controlled;
  assert.ok(mode === 'cold' || !controlled || capture.siteWorkerTargets > 0, 'site-worker-controlled delivery needs an observed worker');
  if (suffix) await until(gallery, 'owned gallery');
  else await until(async () => (await slots()).some(s => s.post === policy.statusId(fixtures[alias]) && s.ready && s.visible), alias + ' visible ready placeholder');
  return mark;
}
async function evidence(name, mark, expectedAssets, expectedKeys = null) {
  await until(() => capture.since(mark).filter(r => !r.document?.startsWith('chrome-extension://')).every(r => r.error || r.finished), name + ' page request outcomes');
  const requests = capture.since(mark), success = requests.filter(r => r.status >= 200 && r.status < 300);
  const assets = new Set(success.map(r => policy.assetKey(r.url)));
  assert.equal(assets.size, expectedAssets, name + ': authorized asset count');
  if (expectedKeys) assert.ok(expectedKeys.length === assets.size && expectedKeys.every(key => assets.has(key)), name + ': selected canonical asset');
  assert.ok(success.every(r => r.document?.startsWith(`chrome-extension://${id}/`)), name + ': page-origin media response');
  assert.ok(success.every(r => r.credentialHeaders !== true), name + ': credential-bearing media request');
  const page = requests.filter(r => !r.document?.startsWith('chrome-extension://'));
  assert.ok(page.every(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'), name + ': page request not canceled by barrier');
  assert.equal(capture.failures.length, 0, 'capture setup failure');
  const blockedFamilies = {};
  for (const request of page) {
    const url = new URL(request.url);
    const family = url.hostname === 'pbs.twimg.com' ? 'image/poster'
      : url.pathname.endsWith('.m3u8') ? 'playlist' : url.pathname.endsWith('.m4s') ? 'segment'
        : url.pathname.endsWith('.mp4') ? 'MP4/init' : 'other video';
    blockedFamilies[family] = (blockedFamilies[family] || 0) + 1;
  }
  report.results.push({name, requests: requests.length, pageBlocked: page.length, blockedFamilies, authorizedAssets: assets.size,
    statuses: [...new Set(success.map(r => r.status))], credentialChecks: success.filter(r => r.credentialHeaders !== undefined).length});
  console.log('PASS', name);
}
async function clickSlot(post, index = '0') {
  await evaluate('document.getElementById("xmf-test-selected")?.removeAttribute("id")');
  let stableSince = Date.now();
  await until(async () => {
    const stable = await evaluate(`(()=>{const s=[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.post===${JSON.stringify(post)}&&s.dataset.index===${JSON.stringify(index)}&&!s.closest('#xmf-test-duplicate'));if(!s)return false;const same=s.id==='xmf-test-selected';s.id='xmf-test-selected';s.scrollIntoView({block:'center',behavior:'instant'});return same})()`);
    if (!stable) stableSince = Date.now();
    return stable && Date.now() - stableSince >= 1000;
  }, 'stable selected occurrence');
  await ab('click', '#xmf-test-selected');
}
// Closed shadow DOM remains accessible. Resolve only the named extension control, not page text.
async function control(name, click = true) {
  const {result: host} = await capture.cdp.call('Runtime.evaluate', {expression: 'document.querySelector("xmf-gallery")'}, capture.root);
  if (!host.objectId) return false;
  let nodes;
  try {
    const {node: element} = await capture.cdp.call('DOM.describeNode', {objectId: host.objectId, depth: 2, pierce: true}, capture.root);
    const dialog = element.shadowRoots?.[0]?.children?.find(node => node.nodeName === 'DIALOG');
    if (!dialog) return false;
    ({nodes} = await capture.cdp.call('Accessibility.queryAXTree', {backendNodeId: dialog.backendNodeId, accessibleName: name, role: 'button'}, capture.root));
  } finally { await capture.cdp.call('Runtime.releaseObject', {objectId: host.objectId}, capture.root); }
  const node = nodes.find(n => !n.ignored && n.role?.value === 'button' && n.name?.value === name);
  if (!node) return false;
  const {object} = await capture.cdp.call('DOM.resolveNode', {backendNodeId: node.backendDOMNodeId}, capture.root);
  try {
    const {result} = await capture.cdp.call('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true,
      functionDeclaration: 'function(){const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0&&r.height>0,focused:this.getRootNode().activeElement===this}}'}, capture.root);
    if (!click) return result.value;
    assert.ok(result.value.visible, 'visible accessible control');
    await ab('mouse', 'move', String(Math.round(result.value.x)), String(Math.round(result.value.y)));
    await ab('batch', 'mouse down', 'mouse up'); return true;
  } finally {
    try { await capture.cdp.call('Runtime.releaseObject', {objectId: object.objectId}, capture.root); }
    catch (error) { if (!/Cannot find context|Could not find object|Execution context was destroyed/.test(String(error))) throw error; }
  }
}
async function imageCount(count) { return until(async () => (await capture.player()).filter(p => p.width > 0).length === count, 'decoded image count ' + count); }
async function blocked() { return until(async () => (await capture.player()).length === 0 && (await slots()).every(s => !s.loaded && !s.pending), 'revoked renderers'); }
async function duplicate(post) {
  await until(() => evaluate(`(()=>{const s=[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.post===${JSON.stringify(post)});const a=s?.closest('article');if(!a)return false;const copy=a.cloneNode(true);copy.id='xmf-test-duplicate';copy.querySelectorAll('xmf-slot').forEach(n=>n.remove());copy.querySelectorAll('[data-xmf-covered]').forEach(n=>n.removeAttribute('data-xmf-covered'));document.body.append(copy);return true})()`), 'current duplicate source');
  await until(async () => (await slots()).some(s => s.duplicate), 'duplicate occurrence');
}
try {
  await capture.start(); report.browser = capture.version; report.siteWorkerTargets = capture.siteWorkerTargets;
  // Refuse a missing/wrong target; never adopt a neighboring tab.
  await ab('tab', target);
  ({targetId: popup} = await capture.cdp.call('Target.createTarget', {url: `chrome-extension://${id}/popup.html`, background: true}));
  ({sessionId: popupSession} = await capture.cdp.call('Target.attachToTarget', {targetId: popup, flatten: true}));
  await until(() => evaluate('typeof chrome.storage?.local === "object"', popupSession), 'settings helper');
  original = process.env.XMF_ORIGINAL_FILTERS_FILE
    ? JSON.parse(await readFile(process.env.XMF_ORIGINAL_FILTERS_FILE, 'utf8')).filters
    : await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))', popupSession);
  assert.ok(['a', 'c', 'b'].every(k => typeof original?.[k] === 'boolean'), 'original preferences must be recorded');
  // Save before mutation for interruption recovery. Never overwrite a supplied original record.
  if (!process.env.XMF_ORIGINAL_FILTERS_FILE) await writeFile(output + '.original.json', JSON.stringify({filters: original}), {mode: 0o600, flag: 'wx'});
  await settings(allOn);
  let mark = await navigate('thread');
  const threadId = policy.statusId(fixtures.thread);
  assert.ok((await slots()).some(s => s.post === threadId && s.category === 'A'));
  assert.ok((await slots()).some(s => s.category === 'C'));
  await evaluate(`document.querySelectorAll('xmf-slot').forEach(s=>s.shadowRoot.querySelector('button')?.click())`);
  assert.ok((await slots()).every(s => !s.loaded && !s.pending), 'synthetic clicks rejected');
  await evidence('thread startup A/C placeholders and synthetic-click rejection', mark, 0);
  await duplicate(threadId);
  await clickSlot(threadId); await imageCount(1);
  assert.ok((await slots()).filter(s => s.duplicate).every(s => !s.loaded));
  await evidence('thread trusted image click and duplicate isolation', mark, 1);
  const inlineURL = await evaluate('location.href');
  mark = capture.mark(); await ab('click', '#xmf-test-selected'); await until(gallery, 'inline owned viewer'); await imageCount(2);
  assert.equal(await evaluate('location.href'), inlineURL, 'inline enlargement leaves route unchanged');
  assert.ok((await control('Close media viewer', false)).focused, 'modal focuses Close');
  await evidence('owned inline enlargement', mark, 1);
  await ab('press', 'Escape'); await until(async () => !await gallery(), 'Escape closes viewer');
  assert.ok(await evaluate('document.activeElement===document.getElementById("xmf-test-selected").closest("a")'), 'Close restores link focus');
  await imageCount(1);
  await ab('press', 'Enter'); await until(gallery, 'keyboard enlargement'); await imageCount(2);
  await ab('press', 'Escape'); await until(async () => !await gallery(), 'keyboard close');
  await settings({a: false, c: true, b: true}); await settings(allOn); await blocked();
  await evaluate('document.getElementById("xmf-test-duplicate")?.remove()');
  mark = capture.mark(); await settings({a: false, c: true, b: true}); await imageCount(1);
  assert.ok((await slots()).filter(s => s.category === 'C').every(s => !s.loaded && !s.pending));
  await evidence('A OFF automatic loading leaves C blocked', mark, 1);
  await settings(allOn); await blocked();

  mark = await navigate('album'); const albumId = policy.statusId(fixtures.album);
  const count = 4;
  await until(async () => (await slots()).filter(s => s.post === albumId).length === count, 'four album placeholders');
  const albumKeys = await until(async () => {
    const keys = (await evaluate(`(()=>{const slots=[...document.querySelectorAll('xmf-slot')].filter(s=>s.dataset.post===${JSON.stringify(albumId)});return slots.sort((a,b)=>Number(a.dataset.index)-Number(b.dataset.index)).map(s=>s.parentElement.querySelector('img')?.getAttribute('src'))})()`)).map(policy.assetKey);
    return keys.length === count && keys.every(Boolean) && keys;
  }, 'current album attachment sources');
  assert.equal(new Set(albumKeys).size, count, 'distinct canonical album attachments');
  await evidence('album startup', mark, 0); await clickSlot(albumId); await imageCount(count);
  await evidence('album grouped still-image authorization', mark, count);
  await ab('click', '#xmf-test-selected'); await until(gallery, 'album inline viewer'); await imageCount(count + 1);
  await control('Next image'); await imageCount(count + 1);
  await ab('press', 'ArrowLeft'); await imageCount(count + 1);
  assert.ok(await control('Close media viewer')); await until(async () => !await gallery(), 'Close button');

  mark = await navigate('album', '/photo/2');
  assert.ok(await control('4 images blocked — click to load all images', false), 'visible direct gallery placeholder');
  await evidence('direct photo startup', mark, 0);
  await control('4 images blocked — click to load all images'); await imageCount(1);
  await evidence('direct selection only', mark, 1, [albumKeys[1]]);
  mark = capture.mark(); await control('Next image'); await imageCount(1);
  await evidence('direct Next selects one attachment', mark, 1, [albumKeys[2]]);
  mark = capture.mark(); await ab('press', 'ArrowLeft'); await imageCount(1);
  await evidence('direct Previous selects one attachment', mark, 1, [albumKeys[1]]);
  assert.equal(await evaluate('location.href'), fixtures.album + '/photo/2', 'owned navigation does not invoke X shortcuts');
  await settings({a: false, c: true, b: true}); await settings(allOn); await blocked();
  assert.ok(await control('4 images blocked — click to load all images', false));
  await evaluate('globalThis.__xmfReloadMarker=true'); mark = capture.mark();
  await capture.cdp.call('Page.reload', {ignoreCache: mode === 'cold'}, capture.root);
  await until(async () => await evaluate('globalThis.__xmfReloadMarker===undefined') && await control('4 images blocked — click to load all images', false), 'direct gallery reload');
  await evidence('direct photo reload loses grants', mark, 0);
  await control('Close media viewer'); await until(async () => !(await evaluate('location.pathname.includes("/photo/")')), 'direct Close replaces photo route');
  await until(async () => (await slots()).some(s => s.ready), 'base post after Close');
  // A semantic status link, not a private X selector, exercises native SPA routing.
  await navigate('thread');
  const reply = await evaluate(`(()=>{const s=[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.category==='C');const a=[...s.closest('article').querySelectorAll('a[href]')].find(a=>a.pathname.endsWith('/status/'+s.dataset.post));a.id='xmf-test-route';a.scrollIntoView({block:'center',behavior:'instant'});return s.dataset.post})()`);
  mark = capture.mark(); await ab('click', '#xmf-test-route');
  await until(async () => await evaluate(`location.pathname.endsWith('/status/${reply}')`), 'status SPA route');
  await until(async () => (await slots()).some(s => s.post === reply && s.category === 'A'), 'new route focus');
  await evidence('status SPA focus and revoked grants', mark, 0);

  for (const alias of ['attributedVideo', 'customVideo', 'encodedVideo']) {
    mark = await navigate(alias); const post = policy.statusId(fixtures[alias]);
    await duplicate(post); await evidence(alias + ' startup poster/playlist barrier', mark, 0);
    await clickSlot(post);
    await until(async () => (await capture.player()).some(p => p.kind === 'video' && p.ready >= 1), alias + ' metadata');
    await capture.player('play'); await until(async () => (await capture.player()).some(p => p.time > 1 && !p.paused), alias + ' playback');
    await capture.player('seek');
    await until(async () => (await capture.player()).some(p =>
      p.time >= Math.min(40, p.duration / 2) - 0.5 && p.ready >= 2), alias + ' seek');
    assert.ok((await slots()).filter(s => s.duplicate).every(s => !s.loaded));
    await evidence(alias + ' MP4 playback/seek and duplicate isolation', mark, 1);
    await settings({a: false, c: true, b: true}); await settings(allOn); await blocked();
    mark = capture.mark(); await new Promise(resolve => setTimeout(resolve, 1000));
    await evidence(alias + ' no new media during one-second post-revocation window', mark, 0);
    await evaluate('globalThis.__xmfReloadMarker=true');
    mark = capture.mark(); await capture.cdp.call('Page.reload', {ignoreCache: mode === 'cold'}, capture.root);
    await until(() => evaluate('globalThis.__xmfReloadMarker===undefined'), alias + ' new document');
    await until(async () => (await slots()).some(s => s.ready && !s.loaded), alias + ' reload');
    await evidence(alias + ' reload revokes authorization', mark, 0);
  }
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = String(error.message).replaceAll(ws, '[CDP]'); process.exitCode = 1;
  console.error(report.failure);
} finally {
  try {
    if (original && popupSession) { await settings(original); report.preferencesRestored = true; }
  } catch { report.preferencesRestored = false; process.exitCode = 1; }
  try { if (popup) await capture.cdp.call('Target.closeTarget', {targetId: popup}); }
  finally { await capture.stop(); }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
}
