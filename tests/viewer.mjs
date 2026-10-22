// Existing Chrome only: native photo links, viewer handoff and occurrence isolation.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-enlarge', output = '/tmp/xmf-viewer.json', mode = 'normal', scope = 'all'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/viewer.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json] [cold|normal] [all|home|home-auto|album|single]');
assert.ok(['all', 'home', 'home-auto', 'album', 'single'].includes(scope), 'supported viewer test scope');
const id = process.env.XMF_EXTENSION_ID || 'pmenhkpmhggnjipkgemamaecpoodacah';
const post = 'https://x.com/ArtificialAnlys/status/2110893784422908225';
const album = 'https://x.com/Cloudflare/status/2111522160153882734';
const albumImages = 4;
// Keep user-supplied regression routes out of source control and result records.
const single = process.env.XMF_SINGLE_PHOTO_URL || null;
if (single && !/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(single))
  throw new Error('XMF_SINGLE_PHOTO_URL must be an X status URL without a photo suffix');
if (scope === 'single' && !single) throw new Error('Set XMF_SINGLE_PHOTO_URL for the single-photo regression');
const capture = new MediaCapture(ws, target, mode === 'cold');
const report = {version: '0.1.0', mode, scope, results: []};
let popup, original;
async function ab(...args) {
  return (await exec('agent-browser', ['--session', session, '--cdp', ws, '--pin-tab', ...args], {timeout: 40000, maxBuffer: 1024 * 1024})).stdout.trim();
}
async function evaluate(code) { return JSON.parse(await ab('eval', '-b', Buffer.from(code).toString('base64'))); }
async function until(fn, name) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 200)); }
  let diagnostics;
  try {
    diagnostics = await evaluate(`(()=>{
      const slots=[...document.querySelectorAll('xmf-slot')].filter(s=>s.isConnected);
      const viewer=slots.filter(s=>s.closest('[data-testid="swipe-to-dismiss"]'));
      const visible=viewer.filter(s=>{const r=s.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=-1&&r.right<=innerWidth+1&&r.bottom>0&&r.top<innerHeight});
      const statusId=location.pathname.match(/\\/status\\/(\\d+)/)?.[1];
      return {routeType:location.protocol==='chrome-extension:'?'extension':location.pathname==='/home'?'home':/\\/status\\/\\d+\\/photo\\/\\d+/.test(location.pathname)?'photo':statusId?'status':'other',
        fixtureStatusId:${JSON.stringify([new URL(post).pathname.split('/')[3], new URL(album).pathname.split('/')[3]])}.includes(statusId)?statusId:null,
        connectedSlots:slots.length,readySlots:slots.filter(s=>s.dataset.ready==='true').length,
        pendingControls:slots.filter(s=>!s.shadowRoot?.querySelector('iframe')&&s.shadowRoot?.querySelector('button')?.disabled).length,
        viewerSlots:viewer.length,visibleViewerSlots:visible.length,
        decodedVisibleViewerSlots:visible.filter(s=>s.shadowRoot?.querySelector('iframe')?.style.pointerEvents==='none').length,
        nativeClick:window.__xmfViewerClick||null};
    })()`);
  } catch { diagnostics = {unavailable: true}; }
  throw new Error('Timed out: ' + name + '; ' + JSON.stringify(diagnostics));
}
async function settings(a) {
  await ab('tab', popup);
  for (const [key, value] of Object.entries({a, c: true, b: true})) {
    await until(() => evaluate(`!document.getElementById('${key}').disabled`), 'popup ready');
    await ab(value ? 'check' : 'uncheck', '#' + key);
  }
  await until(() => evaluate(`['a','c','b'].every(k=>!document.getElementById(k).disabled)`), 'settings saved');
  await ab('tab', target);
}
const viewerReady = () => evaluate(`(()=>{const s=[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] xmf-slot')].filter(s=>{const r=s.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&s.shadowRoot.querySelector('iframe')?.style.pointerEvents==='none'});return s.length===1})()`);
const noFrames = () => evaluate(`[...document.querySelectorAll('xmf-slot')].every(s=>!s.shadowRoot.querySelector('iframe'))`);
// Use the visible iframe's CDP frame identity, never a page-provided media URL.
const visibleViewerFrame = `(()=>{
  const slots=[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] xmf-slot')].filter(s=>{const r=s.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=-1&&r.right<=innerWidth+1&&r.bottom>0&&r.top<innerHeight});
  return slots.length===1?slots[0].shadowRoot?.querySelector('iframe'):null;
})()`;
async function rendererForFrame(expression) {
  const owner = await capture.cdp.call('Runtime.evaluate', {expression}, capture.root);
  if (!owner.result.objectId) return null;
  let frameId;
  try {
    ({node: {frameId}} = await capture.cdp.call('DOM.describeNode', {objectId: owner.result.objectId}, capture.root));
  } finally {
    await capture.cdp.call('Runtime.releaseObject', {objectId: owner.result.objectId}, capture.root);
  }
  if (!frameId) return null;
  for (const renderer of capture.sessions.keys()) {
    if (renderer === capture.root || capture.workerSessions.has(renderer)) continue;
    try {
      const {frameTree} = await capture.cdp.call('Page.getFrameTree', {}, renderer);
      if (frameTree.frame.id === frameId) return renderer;
    } catch (error) {
      if (!/Session with given id not found|No target with given id/.test(String(error))) throw error;
    }
  }
  return null;
}
async function selectedViewerAsset() {
  const renderer = await rendererForFrame(visibleViewerFrame);
  if (!renderer) return null;
  const reply = await capture.cdp.call('Runtime.evaluate', {expression: `(()=>{
    if(location.origin!==${JSON.stringify(`chrome-extension://${id}`)}||location.pathname!=='/player.html')return null;
    const img=document.querySelector('img');
    return img?.complete&&img.naturalWidth>0?img.currentSrc:null;
  })()`, returnByValue: true}, renderer);
  assert.ok(!reply.exceptionDetails, 'selected renderer inspection succeeds');
  return reply.result.value ? policy.assetKey(reply.result.value) : null;
}
async function retryFocus(viewer) {
  const frame = viewer ? visibleViewerFrame : `document.querySelector('#xmf-viewer-selected')?.shadowRoot.querySelector('iframe')`;
  const renderer = await until(() => rendererForFrame(frame), 'image renderer for Retry focus');
  // Produce a real local image decode error, without changing URLs accepted by the loader.
  await capture.cdp.call('Runtime.evaluate', {expression: `document.querySelector('img').src='data:image/png;base64,AA=='`}, renderer);
  await until(() => evaluate(`(()=>{const f=${frame};if(!f||f.style.pointerEvents!=='auto'||f.tabIndex!==0)return false;f.getRootNode().host.id='xmf-focus-selected';return true})()`), 'Retry restores iframe input');
  await until(async () => {
    const reply = await capture.cdp.call('Runtime.evaluate', {expression: `!document.getElementById('retry').hidden`, returnByValue: true}, renderer);
    return reply.result.value;
  }, 'visible Retry after decode failure');
  // agent-browser frame selectors do not resolve this shadow-root iframe. Focus its
  // real Retry control through CDP; agent-browser still supplies the trusted key.
  await capture.cdp.call('Runtime.evaluate', {expression: `document.getElementById('retry').focus()`}, renderer);
  const focused = await capture.cdp.call('Runtime.evaluate', {expression: `(()=>{const s=document.querySelector('#xmf-focus-selected');return s.shadowRoot.activeElement===s.shadowRoot.querySelector('iframe')})()`, returnByValue: true}, capture.root);
  assert.equal(focused.result.value, true, 'keyboard focus is inside renderer before retry');
  await ab('press', 'Enter');
  await until(() => evaluate(`(()=>{const s=document.querySelector('#xmf-focus-selected'),f=s?.shadowRoot.querySelector('iframe');return f?.style.pointerEvents==='none'&&document.activeElement===${viewer ? `s.closest('[role="dialog"]').querySelector('button[aria-label="Close"]')` : 's.closest("a")'}})()`), 'ready image returns focus to native ' + (viewer ? 'Close' : 'photo link'));
  await evaluate(`(()=>{document.querySelector('#xmf-focus-selected').id=${JSON.stringify(viewer ? 'xmf-viewer-focused' : 'xmf-viewer-selected')};return true})()`);
  report.results.push({name: 'real decode-error Retry returns keyboard focus to native ' + (viewer ? 'viewer Close' : 'photo link'), passed: true});
}
const imageRequest = r => new URL(r.url).hostname === 'pbs.twimg.com';
async function selectionWindow(before, photo) {
  const selected = await until(selectedViewerAsset, 'trusted decoded renderer for photo ' + photo);
  const requests = () => [...capture.requests.values()].filter(r => !before.has(r));
  await until(() => {
    const images = requests().filter(imageRequest);
    return images.some(r => r.status >= 200 && r.status < 300 && r.finished) && images.every(r => r.finished || r.error);
  }, 'completed image requests for photo ' + photo);
  const observed = requests(), success = observed.filter(r => r.status >= 200 && r.status < 300);
  assert.ok(success.length > 0 && success.every(r => r.finished && policy.assetKey(r.url) === selected &&
    r.document?.startsWith(`chrome-extension://${id}/`) && r.credentialHeaders !== true), 'only the selected renderer asset succeeds for photo ' + photo);
  const page = observed.filter(r => imageRequest(r) && !r.document?.startsWith('chrome-extension://'));
  assert.ok(page.every(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'), 'page image requests remain blocked for photo ' + photo);
  // Persist only counts; renderer URLs and grant tokens remain in memory.
  return {selected, evidence: {photo, successfulResponses: success.length, authorizedAssets: new Set(success.map(r => policy.assetKey(r.url))).size, completedImageRequests: observed.filter(r => imageRequest(r) && r.finished).length, pageBlocked: page.length}};
}
async function choose(route) {
  const path = new URL(route).pathname;
  return until(() => evaluate(`(()=>{const s=[...document.querySelectorAll('xmf-slot')].find(s=>{const a=s.closest('a');return a&&a.pathname.includes('/photo/')&&${path === '/home' ? 'true' : `(a.pathname===${JSON.stringify(path + '/photo/1')}||[...(s.closest('article')?.querySelectorAll('time')||[])].some(t=>t.closest('a')?.pathname===${JSON.stringify(path)}))`}&&s.dataset.ready==='true'&&(s.shadowRoot.querySelector('iframe')?.title==='Selected post image'||s.shadowRoot.querySelector('button')?.textContent.includes('image')||s.shadowRoot.querySelector('button')?.textContent.includes('Image'))});if(!s)return false;s.id='xmf-viewer-selected';s.scrollIntoView({block:'center',behavior:'instant'});return s.closest('a').pathname})()`), 'native image attachment');
}
async function clickPlaceholder() {
  const snapshot = await ab('snapshot', '-i', '-s', '#xmf-viewer-selected');
  const ref = snapshot.match(/button .*\[ref=(e\d+)\]/)?.[1];
  assert.ok(ref, 'visible accessible image placeholder');
  await ab('click', '@' + ref);
}
async function run(route, blocked, keyboard = false) {
  await settings(blocked);
  const start = capture.mark();
  await ab('open', route);
  const destination = await choose(route);
  const timeOrigin = await evaluate('performance.timeOrigin');
  if (blocked) {
    assert.ok(await noFrames(), 'all-ON startup stays blocked');
    await until(() => capture.since(start).some(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'), 'startup request cancellation');
    assert.ok(capture.since(start).every(r => r.status === null), 'no pre-click successful media');
    await clickPlaceholder();
  }
  await until(() => evaluate(`document.querySelector('#xmf-viewer-selected')?.shadowRoot.querySelector('iframe')?.style.pointerEvents==='none'`), 'decoded inline image');
  if (blocked) {
    await evaluate(`(()=>{const a=document.querySelector('#xmf-viewer-selected').closest('article');const copy=a.cloneNode(true);copy.id='xmf-viewer-duplicate';copy.querySelectorAll('xmf-slot').forEach(s=>s.remove());a.after(copy);return true})()`);
    await until(() => evaluate(`!!document.querySelector('#xmf-viewer-duplicate xmf-slot')`), 'duplicate placeholder');
  }
  // A forged ready notification must not make a placeholder navigable or grant it.
  await evaluate(`(()=>{
    const state=()=>{const s=document.querySelector('#xmf-viewer-selected'),f=s?.shadowRoot.querySelector('iframe'),r=s?.getBoundingClientRect();return {selected:!!s,frame:!!f,pointer:f?.style.pointerEvents||null,identity:s?.dataset.identity||null,box:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null}};
    const trace=window.__xmfViewerClick={before:state(),events:[]};
    const record=(phase,e)=>{const s=document.querySelector('#xmf-viewer-selected');trace.events.push({phase,trusted:e.isTrusted,target:e.target.tagName,clientX:e.clientX,clientY:e.clientY,targetTestId:e.target.getAttribute('data-testid'),sameAnchor:!!s&&e.target.closest('a')===s.closest('a'),pointHitsSelected:!!s&&document.elementFromPoint(e.clientX,e.clientY)===s,hitSelected:!!s&&e.composedPath().includes(s),button:e.button,prevented:e.defaultPrevented,home:location.pathname==='/home',...state()})};
    window.addEventListener('pointerdown',e=>record('pointerdown',e),{capture:true,once:true});
    window.addEventListener('pointerup',e=>record('pointerup',e),{capture:true,once:true});
    window.addEventListener('click',e=>record('capture before extension',e),{capture:true,once:true});
    document.addEventListener('click',e=>record('capture after extension',e),{capture:true,once:true});
    window.addEventListener('click',e=>record('bubble after X',e),{once:true});
    window.postMessage({type:'xmf-image-state',ready:true},location.origin);return true;
  })()`);
  if (keyboard) {
    await retryFocus(false);
    await ab('press', 'Enter');
  } else {
    const start = Date.now();
    await until(() => evaluate(`(()=>{const s=document.querySelector('#xmf-viewer-selected');if(!s)return false;const r=s.getBoundingClientRect(),a=s.closest('a'),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!a&&!!hit&&(hit===s||s.contains(hit)||hit.closest('a')===a)})()`), 'native photo receives pointer input');
    report.lastPointerReadinessWaitMs = Date.now() - start;
    await ab('click', '#xmf-viewer-selected');
  }
  await until(() => evaluate(`location.pathname===${JSON.stringify(destination)}`), 'native viewer URL');
  await until(viewerReady, 'selected image decoded in native viewer without second load click');
  assert.equal(await evaluate('performance.timeOrigin'), timeOrigin, 'viewer is a native SPA transition');
  const visible = await until(() => evaluate(`(()=>{const s=[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] xmf-slot')].find(s=>{const r=s.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&s.shadowRoot.querySelector('iframe')?.style.pointerEvents==='none'});if(!s)return false;const r=s.getBoundingClientRect();return {width:r.width,height:r.height,visible:getComputedStyle(s).visibility==='visible',close:!!document.querySelector('[role="dialog"] button[aria-label="Close"]')}})()`), 'decoded native viewer snapshot after rerender');
  assert.ok(visible.visible && visible.width > 500 && visible.close);
  if (blocked) {
    assert.equal(await evaluate(`[...document.querySelectorAll('#xmf-viewer-duplicate xmf-slot')].some(s=>s.shadowRoot.querySelector('iframe'))`), false, 'duplicate occurrence stays blocked');
    assert.equal(await until(() => evaluate(`[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')).length`), 'viewer renderer after native rerender'), 1, 'offscreen slides stay blocked');
  }
  const requests = capture.since(start), success = requests.filter(r => r.status >= 200 && r.status < 300);
  assert.ok(success.length > 0);
  assert.ok(success.every(r => r.document?.startsWith('chrome-extension://') && r.credentialHeaders !== true));
  const page = requests.filter(r => !r.document?.startsWith('chrome-extension://'));
  await until(() => page.every(r => r.error || r.finished), 'page network outcomes');
  assert.ok(page.length > 0 && page.every(r => r.error === 'net::ERR_BLOCKED_BY_CLIENT'));
  report.results.push({name: `${new URL(route).pathname === '/home' ? 'home' : 'image post'} ${blocked ? 'manual' : 'automatic'} native enlargement${keyboard ? ' by keyboard' : ''}`, route: route === single ? 'private-single-photo-fixture' : route, settings: {a: blocked, c: true, b: true}, passed: true, viewport: visible, successfulResponses: success.length, authorizedAssets: new Set(success.map(r => policy.assetKey(r.url))).size, pageBlocked: page.length});
  if (keyboard) { await retryFocus(true); await ab('press', 'Escape'); }
  else await ab('click', '[role="dialog"] button[aria-label="Close"]');
  await until(() => evaluate(`location.pathname===${JSON.stringify(new URL(route).pathname)}`), 'native close returns to source');
  assert.equal(await evaluate('performance.timeOrigin'), timeOrigin);
  await ab('back');
  await ab('forward');
  await until(() => evaluate(`location.pathname===${JSON.stringify(new URL(route).pathname)}`), 'native history remains usable');
  console.log('PASS', report.results.at(-1).name);
  return new Set(success.map(r => policy.assetKey(r.url)));
}
async function singlePhoto() {
  const expected = await run(single, true);
  assert.equal(expected.size, 1, 'reported post has one authorized image');
  await run(single, false, true);
  await settings(true);
  for (const reload of [false, true]) {
    const start = capture.mark();
    await ab(reload ? 'reload' : 'open', ...(!reload ? [single + '/photo/1'] : []));
    await until(() => evaluate(`(()=>{const s=[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] xmf-slot')].find(s=>{const r=s.getBoundingClientRect();return r.width>0&&r.left>=-1&&r.right<=innerWidth+1&&s.dataset.ready==='true'});if(!s)return false;s.id='xmf-viewer-selected';return !!s.shadowRoot.querySelector('button')})()`), 'single-photo visible placeholder');
    assert.ok(await noFrames(), 'direct single-photo startup is blocked');
    await until(() => {const r=capture.since(start);return r.length>0&&r.every(r=>r.error||r.finished);}, 'single-photo startup network outcomes');
    assert.ok(capture.since(start).every(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT'), 'no successful pre-selection media');
    const blocked = capture.since(start).length;
    const before = new Set(capture.requests.values());
    await clickPlaceholder();
    await until(viewerReady, 'single-photo click decodes selected viewer');
    const selection = await selectionWindow(before, 1);
    assert.ok(expected.has(selection.selected), 'direct viewer uses the same asset as the native inline photo');
    assert.equal(await evaluate(`[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')).length`), 1, 'sidebar and navigation sentinels receive no renderer');
    report.results.push({name: `single-photo direct ${reload ? 'reload' : 'startup'} selection`, route: 'private-single-photo-fixture/photo/1', settings: {a:true,c:true,b:true}, passed:true, pageBlocked:blocked, selection:selection.evidence});
  }
}
try {
  await ab('tab', target);
  popup = JSON.parse(await ab('tab', 'new', `chrome-extension://${id}/popup.html`, '--json')).data.targetId;
  original = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  await ab('tab', target);
  await capture.start(); report.browser = capture.version; report.observedSiteWorkerTargets = capture.siteWorkerTargets;
  if (scope === 'all') {
    await run(post, true);
    await run(post, false, true);
  }
  if (scope === 'single' || (scope === 'all' && single)) await singlePhoto();
  else if (scope === 'all') report.singlePhotoSkipped = 'XMF_SINGLE_PHOTO_URL not supplied';
  if (scope !== 'album' && scope !== 'single') {
    if (scope !== 'home-auto') await run('https://x.com/home', true);
    await run('https://x.com/home', false);
  }
  if (!scope.startsWith('home') && scope !== 'single') {
    await settings(true);
    const start = capture.mark();
    await ab('open', album);
    await choose(album);
    assert.ok(await noFrames());
    await clickPlaceholder();
    await until(() => evaluate(`[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')?.style.pointerEvents==='none').length===${albumImages}`), 'all decoded album images');
    const allowed = new Set(capture.since(start).filter(r => r.status >= 200 && r.status < 300).map(r => policy.assetKey(r.url)));
    assert.equal(allowed.size, albumImages);
    await ab('click', '#xmf-viewer-selected');
    await until(viewerReady, 'album native viewer');
    for (let index = 2; index <= albumImages; index++) {
      await ab('press', 'ArrowRight');
      await until(() => evaluate(`location.pathname.endsWith('/photo/${index}')`), 'native next photo ' + index);
      await until(viewerReady, 'decoded gallery photo ' + index);
    }
    for (let index = albumImages - 1; index >= 2; index--) {
      await ab('press', 'ArrowLeft');
      await until(() => evaluate(`location.pathname.endsWith('/photo/${index}')`), 'native previous photo ' + index);
      await until(viewerReady, 'previous photo decoded ' + index);
    }
    assert.ok(capture.since(start).filter(r => r.status >= 200 && r.status < 300).every(r => allowed.has(policy.assetKey(r.url)) && r.document?.startsWith('chrome-extension://')));
    await settings(false); await settings(true);
    await until(noFrames, 'viewer grant revoked by filter ON');
    const reload = capture.mark();
    await ab('reload');
    await until(() => evaluate(`!!document.querySelector('[data-testid="swipe-to-dismiss"] xmf-slot')`), 'direct viewer startup');
    await until(() => evaluate(`location.pathname===${JSON.stringify(new URL(album).pathname + '/photo/2')}`), 'direct reload stays on photo 2');
    assert.ok(await noFrames());
    await until(() => {
      const images = capture.since(reload).filter(imageRequest);
      return images.length > 0 && images.every(r => r.finished || r.error);
    }, 'direct viewer startup image outcomes');
    assert.ok(capture.since(reload).every(r => r.status === null));
    await evaluate(`(()=>{const s=[...document.querySelectorAll('[data-testid="swipe-to-dismiss"] xmf-slot')].find(s=>{const r=s.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1});s.id='xmf-viewer-selected';return true})()`);
    const beforePhoto2 = new Set(capture.requests.values());
    await clickPlaceholder();
    await until(viewerReady, 'direct viewer manual selection');
    const photo2 = await selectionWindow(beforePhoto2, 2);
    // Previously completed, authorized renderers may remain mounted; new payloads may not broaden the selection.
    const beforePhoto3 = new Set(capture.requests.values());
    await ab('press', 'ArrowRight');
    await until(() => evaluate(`location.pathname.endsWith('/photo/3')`), 'direct viewer next image');
    await until(viewerReady, 'direct viewer group remains authorized');
    const photo3 = await selectionWindow(beforePhoto3, 3);
    assert.ok(photo2.selected !== photo3.selected, 'Next selects a different image asset');
    report.results.push({name: `native ${albumImages}-image next/previous, revocation, direct viewer reload and manual group selection`, route: album, settings: {a: true, c: true, b: true}, passed: true, authorizedAssets: allowed.size, directSelections: [photo2.evidence, photo3.evidence]});
  }
  assert.equal(capture.failures.length, 0, capture.failures.join('\n'));
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); process.exitCode = 1; console.error(String(error));
} finally {
  if (original && popup) try {
    await ab('tab', popup);
    for (const [key, value] of Object.entries(original)) await ab(value ? 'check' : 'uncheck', '#' + key);
    await until(() => evaluate(`['a','c','b'].every(k=>!document.getElementById(k).disabled)`), 'original settings restored');
  } catch (error) { report.restoreError = String(error); process.exitCode = 1; }
  await capture.stop();
  if (popup) try { await ab('tab', 'close', popup); await ab('tab', target); } catch {}
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
