// Real, existing Chrome only. UI actions use agent-browser; CDP observes network/player state.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-user', output = '/tmp/xmf-validation.json', mode = 'cold'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/browser.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json] [cold|normal]');
const id = process.env.XMF_EXTENSION_ID || 'pmkikmmocmppigkinihgchopoonpoldi';
const image = 'https://x.com/ArtificialAnlys/status/2110893784422908225';
const video = 'https://x.com/thsottiaux/status/2111249534072529256';
const customCoverVideo = 'https://x.com/github/status/2111225205309780009';
const quote = 'https://x.com/thsottiaux/status/2111245052513259606';
const report = {version: '0.1.0', mode, results: [], gaps: ['Browser restart', 'Additional surfaces and media families', 'Adaptive HLS/quality switching: uses native progressive MP4 instead']};
const capture = new MediaCapture(ws, target, mode === 'cold');
let popup, original, secondary;
async function ab(...args) {
  const result = await exec('agent-browser', ['--session', session, '--auto-connect', '--pin-tab', ...args], {timeout: 40000, maxBuffer: 1024 * 1024});
  return result.stdout.trim();
}
async function evaluate(code) {
  const result = await exec('agent-browser', ['--session', session, '--auto-connect', '--pin-tab', 'eval', '-b', Buffer.from(code).toString('base64')], {timeout: 30000});
  return JSON.parse(result.stdout);
}
async function until(fn, name) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const value = await fn(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Timed out: ' + name);
}
const state = () => evaluate(`[...document.querySelectorAll('xmf-slot')].map(s=>({category:s.dataset.category,ready:s.dataset.ready==='true',loaded:!!s.shadowRoot?.querySelector('iframe'),pending:!!s.shadowRoot?.querySelector('button')?.disabled,duplicate:!!s.closest('#xmf-duplicate-fixture')}))`);
async function navigate(url) {
  await ab('open', url); await ab('tab', target);
  await until(async () => (await state()).some(s => s.ready), 'media discovery');
}
async function evidence(name, mark, expectedAssets = 0) {
  if (expectedAssets === null) await until(() => capture.since(mark).some(r => r.status >= 200 && r.status < 300), name + ': automatic media response');
  await until(()=>capture.since(mark).filter(r=>!r.document?.startsWith('chrome-extension://')).every(r=>r.error||r.finished), name + ': media outcomes');
  const reqs = capture.since(mark);
  const success = reqs.filter(r => r.status >= 200 && r.status < 300);
  const assets = new Set(success.map(r => policy.assetKey(r.url)));
  if (expectedAssets === null) assert.ok(assets.size > 0, name + ': automatic media did not load');
  else assert.equal(assets.size, expectedAssets, name + ': unexpected successful media');
  assert.ok(success.every(r => r.document?.startsWith('chrome-extension://')), name + ': page-origin payload escaped');
  assert.ok(success.every(r => r.credentialHeaders !== true), name + ': credential header on CDN request');
  const page = reqs.filter(r => !r.document?.startsWith('chrome-extension://'));
  const unexpected = page.filter(r=>r.error!=='net::ERR_BLOCKED_BY_CLIENT').map(r=>({type:r.type,status:r.status,error:r.error,finished:r.finished}));
  assert.equal(unexpected.length, 0, name + ': unexpected page outcome ' + JSON.stringify(unexpected));
  report.results.push({name, requests: reqs.length, pageBlocked: page.length, authorizedAssets: assets.size, authorizedURLVariants: new Set(success.map(r=>r.url)).size,
    statuses: [...new Set(success.map(r => r.status))], credentialChecks: success.filter(r=>r.credentialHeaders!==undefined).length, bytes: success.reduce((sum, r) => sum + r.bytes + (r.finished ? 0 : r.received), 0)});
  console.log('PASS', name);
}
async function settings(a, c, b) {
  await ab('tab', popup);
  for (const [name, value] of [['a', a], ['c', c], ['b', b]]) {
    await until(() => evaluate(`!document.getElementById('${name}').disabled`), 'popup ready');
    await ab(value ? 'check' : 'uncheck', '#' + name);
  }
  await until(() => evaluate(`['a','c','b'].every(name=>!document.getElementById(name).disabled)`), 'settings saved');
  await ab('tab', target);
}
async function clickFirst() {
  await evaluate(`(async()=>{const id=location.pathname.match(/\\/status\\/(\\d+)/)[1];const s=[...document.querySelectorAll('xmf-slot')].find(s=>[...(s.closest('article')?.querySelectorAll('time')||[])].some(t=>t.closest('a')?.pathname.includes('/status/'+id)))||document.querySelector('xmf-slot');s.id='xmf-selected-fixture';await s.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  const snapshot = await ab('snapshot', '-i', '-s', '#xmf-selected-fixture');
  const ref = snapshot.match(/button .*\[ref=(e\d+)\]/)?.[1];
  assert.ok(ref, 'placeholder must be accessible'); await ab('click', '@' + ref);
}
try {
  await ab('tab', target);
  await ab('tab', 'new', `chrome-extension://${id}/popup.html`);
  const tabs = JSON.parse(await ab('tab', 'list', '--json')).data.tabs;
  popup = tabs.find(t => t.active).targetId;
  original = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  await settings(true, true, true);
  await capture.start(); report.browser = capture.version; report.observedSiteWorkerTargets = capture.siteWorkerTargets;
  let mark = capture.mark(); await navigate(image);
  await ab('scroll', 'down', '2400');
  await until(async () => { const slots = await state(); return ['A','C','B'].every(category => slots.some(s=>s.ready&&s.category===category)); }, 'focused post and both conversation authors discovered');
  report.siteWorkerControlled = await evaluate('!!navigator.serviceWorker.controller');
  assert.ok(!report.siteWorkerControlled || capture.siteWorkerTargets > 0, 'active site worker must be included in network observation');
  await evaluate(`(()=>{document.querySelectorAll('xmf-slot').forEach(s=>s.shadowRoot.querySelector('button')?.click());return true})()`);
  assert.ok((await state()).every(s=>!s.loaded&&!s.pending), 'page-synthesized clicks must not grant media');
  report.results.push({name:'synthetic clicks rejected',passed:true});
  await until(()=>evaluate(`(()=>{if(document.getElementById('xmf-other-fixture'))return true;const s=[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.category==='B');const author=[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.category==='C'&&s.dataset.ready==='true');const focused=[...document.querySelectorAll('article')].find(a=>[...a.querySelectorAll('time')].some(t=>t.closest('a')?.pathname==='/ArtificialAnlys/status/2110893784422908225'));if(!s||!author||!focused)return false;for(const [slot,id] of [[s,'xmf-other-fixture'],[author,'xmf-author-fixture']]){const copy=slot.closest('article').cloneNode(true);copy.id=id;copy.querySelectorAll('xmf-slot,[data-testid="tweetText"]').forEach(s=>s.remove());focused.before(copy)}focused.id='xmf-focus-fixture';return true})()`), 'fixture metadata');
  await evidence(mode + ' images before click', mark);
  await clickFirst();
  await until(async () => (await capture.player()).some(p => p.width > 0), 'selected image pixels');
  await evidence('single image click', mark, 1);
  await ab('tab', 'new', 'about:blank');
  secondary = JSON.parse(await ab('tab', 'list', '--json')).data.tabs.find(t=>t.active).targetId;
  const attached = await capture.cdp.call('Target.attachToTarget', {targetId: secondary, flatten: true});
  await capture.setup(attached.sessionId, 'secondary page');
  await ab('open', image); await ab('tab', secondary);
  await until(async()=> (await state()).some(s=>s.ready&&s.category==='A'), 'second tab placeholders');
  assert.ok((await state()).every(s=>!s.loaded), 'manual grants must not cross tabs');
  await evidence('second tab remains blocked', mark, 1);
  await ab('tab', target);
  await evaluate(`(()=>{const a=document.querySelector('#xmf-focus-fixture');const copy=a.cloneNode(true);copy.id='xmf-duplicate-fixture';copy.querySelectorAll('xmf-slot,[data-testid="tweetText"]').forEach(s=>s.remove());a.after(copy);return true})()`);
  await until(async () => (await state()).some(s => s.duplicate), 'duplicate discovered');
  assert.ok((await state()).filter(s => s.duplicate).every(s => !s.loaded), 'duplicate inherited grant');
  const selectedURL = capture.since(mark).find(r => r.status === 200).url;
  await evaluate(`(()=>{const s=document.querySelector('#xmf-other-fixture xmf-slot');const image=document.createElement('img');image.src=${JSON.stringify(selectedURL)};s.parentElement.append(image);return true})()`);
  await until(async () => (await state()).some(s => s.category === 'B' && !s.loaded), 'cross-category duplicate blocked');
  await evidence('duplicate occurrence isolation', mark, 1);
  await evaluate(`(()=>{['xmf-duplicate-fixture','xmf-author-fixture','xmf-other-fixture'].forEach((id,index)=>{const a=document.getElementById(id);document.body.append(a);a.style.cssText='position:fixed;left:'+index*33+'%;bottom:10px;width:30%;max-height:300px;overflow:auto;z-index:9999;background:#15202b';a.querySelector('xmf-slot').scrollIntoView({block:'center',behavior:'instant'})});return true})()`);
  let mixedMark = capture.mark();
  await settings(false, true, true);
  await evaluate(`(async()=>{const s=document.querySelector('#xmf-duplicate-fixture xmf-slot');s.id='xmf-auto-fixture';await s.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await until(()=>evaluate(`!!document.querySelector('#xmf-auto-fixture')?.shadowRoot.querySelector('iframe')`), 'A OFF eligible');
  assert.ok((await state()).filter(s => s.category === 'B' || s.category === 'C').every(s => !s.loaded));
  await evaluate(`(async()=>{const s=document.querySelector('#xmf-other-fixture xmf-slot');const id=s.closest('article').querySelector('time').closest('a').pathname.match(/\\/status\\/(\\d+)/)[1];const posts=[{id,author:'ArtificialAnlys',conversation:'0',media:[{poster:${JSON.stringify(selectedURL)},type:'photo',variants:[]}]}];window.postMessage({channel:'xmf-metadata-v1',posts},location.origin);const ch=new MessageChannel();window.postMessage({channel:'xmf-channel-v1'},location.origin,[ch.port2]);ch.port1.postMessage({posts});await new Promise(r=>setTimeout(r,50));ch.port1.close();return true})()`);
  assert.equal(await evaluate(`(()=>{const s=document.querySelector('#xmf-other-fixture xmf-slot');return s.dataset.category==='B'&&!s.shadowRoot.querySelector('iframe')})()`), true, 'forged metadata must not change eligibility');
  report.results.push({name:'forged window messages rejected',passed:true});
  await ab('tab', secondary);
  await evaluate(`(()=>{document.querySelector('xmf-slot').scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await until(async()=> (await state()).some(s=>s.category==='A'&&s.loaded), 'settings reached second tab');
  await ab('tab', target);
  await evidence('A OFF / C ON / B ON', mixedMark, null);
  mixedMark = capture.mark();
  await settings(true, false, true);
  await until(async () => (await state()).some(s => s.category === 'C' && s.loaded), 'C OFF eligible');
  assert.ok((await state()).filter(s => s.category === 'A' || s.category === 'B').every(s => !s.loaded));
  await evidence('A ON / C OFF / B ON', mixedMark, null);
  mixedMark = capture.mark();
  await settings(true, true, false);
  await evaluate(`(()=>{[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.category==='B').scrollIntoView({block:'center'});return true})()`);
  await until(async () => (await state()).some(s => s.category === 'B' && s.loaded), 'B OFF eligible');
  assert.ok((await state()).filter(s => s.category === 'A' || s.category === 'C').every(s => !s.loaded));
  await ab('tab', secondary);
  await until(async()=> (await state()).filter(s=>s.category==='A').every(s=>!s.loaded), 'ON revoked second tab grants');
  await ab('tab', target);
  await evidence('A ON / C ON / B OFF', mixedMark, null);
  report.results.push({name: 'settings propagate across tabs', passed: true});
  await ab('tab', 'close', secondary); secondary = null; await ab('tab', target);
  await settings(true, true, true);
  await until(async () => (await state()).every(s => !s.loaded && !s.pending), 'all ON revokes grants');
  const matrixMark = capture.mark();
  // Visible copies retain each source post's metadata; they never bypass the page barrier.
  for (const a of [true, false]) for (const c of [true, false]) for (const b of [true, false]) {
    const filters = {a, c, b};
    const name = `A ${a ? 'ON' : 'OFF'} / C ${c ? 'ON' : 'OFF'} / B ${b ? 'ON' : 'OFF'}`;
    await settings(a, c, b);
    await until(() => evaluate(`[['xmf-duplicate-fixture','A','a'],['xmf-author-fixture','C','c'],['xmf-other-fixture','B','b']].every(([id,category,key])=>{const s=document.querySelector('#'+id+' xmf-slot');return s?.dataset.category===category&&s.dataset.ready==='true'&&!s.shadowRoot.querySelector('button')?.disabled&&!!s.shadowRoot.querySelector('iframe')===!${JSON.stringify(filters)}[key]})`), name + ': independent eligibility');
    const slots = await state();
    assert.ok(slots.filter(s => policy.blocked(filters, s.category)).every(s => !s.loaded && !s.pending), name + ': filtered category loaded');
    report.results.push({name: 'independent settings: ' + name, settings: filters, passed: true});
  }
  await evidence('eight settings combinations keep page requests blocked', matrixMark, null);
  await settings(true, true, true);
  await until(async () => (await state()).every(s => !s.loaded && !s.pending), 'settings ON must revoke');
  for (const [name, url] of [['video', video], ['custom-cover video', customCoverVideo]]) {
    mark = capture.mark(); await navigate(url);
    if (url === customCoverVideo) {
      // A second DOM occurrence uses the real post metadata and CDN source.
      await evaluate(`(()=>{const a=[...document.querySelectorAll('article')].find(a=>[...a.querySelectorAll('time')].some(t=>t.closest('a')?.pathname==='/github/status/2111225205309780009'));const copy=a.cloneNode(true);copy.id='xmf-video-duplicate-fixture';copy.querySelectorAll('xmf-slot').forEach(s=>s.remove());a.after(copy);return true})()`);
      await until(()=>evaluate(`!!document.querySelector('#xmf-video-duplicate-fixture xmf-slot[data-ready="true"]')`), 'custom-cover duplicate discovery');
      await evaluate(`(()=>{document.querySelectorAll('xmf-slot').forEach(s=>s.shadowRoot.querySelector('button')?.click());return true})()`);
    }
    await evidence(mode + ' ' + name + ' before click', mark);
    await clickFirst();
    await until(async () => (await capture.player()).some(p => p.kind === 'video' && p.ready >= 1), name + ' metadata');
    await capture.player('play');
    await until(async () => (await capture.player()).some(p => p.time > 1 && !p.paused), name + ' real playback');
    await capture.player('seek');
    await until(async () => (await capture.player()).some(p => p.time >= 40 && p.ready >= 2), name + ' range seek');
    await capture.player('pause');
    if (url === customCoverVideo) assert.equal(await evaluate(`!!document.querySelector('#xmf-video-duplicate-fixture xmf-slot')?.shadowRoot.querySelector('iframe')`), false, 'custom-cover duplicate must stay blocked');
    await evidence('single ' + name + ' playback and seeking', mark, 1);
    if (url === customCoverVideo) {
      const reloadMark = capture.mark();
      await ab('reload');
      await until(async()=> {const slots=await state();return slots.some(s=>s.category==='A'&&s.ready)&&slots.every(s=>!s.loaded&&!s.pending);}, 'custom-cover reload clears manual selection');
      await evidence('custom-cover reload before automatic eligibility', reloadMark, 0);
      const automaticMark = capture.mark();
      await settings(false, true, true);
      await until(async()=> (await state()).some(s=>s.category==='A'&&s.loaded), 'custom-cover automatic eligibility');
      await until(async()=> (await capture.player()).some(p=>p.kind==='video'&&p.ready>=1), 'custom-cover automatic video metadata');
      await evidence('custom-cover automatic video loading', automaticMark, null);
      await settings(true, true, true);
      await until(async()=> (await state()).every(s=>!s.loaded&&!s.pending), 'custom-cover category reblocking');
      report.results.push({name:'custom-cover automatic eligibility and revocation',passed:true});
    }
  }
  mark = capture.mark(); await navigate(quote);
  await evidence('quote before click', mark);
  await clickFirst();
  await until(async () => (await capture.player()).some(p => p.width > 0), 'quoted image');
  await evidence('single quoted image', mark, 1);
  const focusedIndex = await evaluate(`[...document.querySelectorAll('article')].findIndex(a=>[...a.querySelectorAll('time')].some(t=>t.closest('a')?.pathname==='/thsottiaux/status/2111245052513259606'))`);
  assert.equal(focusedIndex, 1, 'regression focus must be the second article');
  // Worker shutdown is scoped to this extension, never the user's site workers.
  const workers = (await capture.cdp.call('Target.getTargets')).targetInfos.filter(t=>t.type==='service_worker'&&t.url===`chrome-extension://${id}/worker.js`);
  assert.equal(workers.length, 1);
  assert.equal((await capture.cdp.call('Target.closeTarget', {targetId: workers[0].targetId})).success, true);
  await until(async () => (await state()).every(s=>!s.loaded), 'worker stopped players');
  await until(async () => (await state()).some(s=>s.loaded), 'worker reconnect retained selected occurrence');
  report.results.push({name: 'worker stop and reconnect', passed: true});
  mark = capture.mark(); await navigate(image); await clickFirst();
  await until(async () => (await capture.player()).some(p => p.width > 0), 'image before SPA transition');
  const timeOrigin = await evaluate('performance.timeOrigin');
  const destination = await evaluate(`(()=>{const links=[...document.querySelectorAll('article time')].map(t=>t.closest('a')).filter(Boolean);const link=links.find(l=>l.pathname!=='/ArtificialAnlys/status/2110893784422908225'&&l.pathname.startsWith('/ArtificialAnlys/status/'));link.click();return link.href})()`);
  await until(()=>evaluate(`location.href===${JSON.stringify(destination)}`), 'SPA route');
  await until(async () => (await state()).every(s=>!s.loaded), 'SPA grants revoked');
  assert.equal(await evaluate('performance.timeOrigin'), timeOrigin, 'must be a same-document navigation');
  await ab('back'); await ab('tab', target);
  await until(async () => (await state()).length>0&&(await state()).every(s=>!s.loaded), 'Back resets grants');
  report.results.push({name: 'SPA and Back reset grants', passed: true});
  assert.equal(capture.failures.length, 0, capture.failures.join('\n'));
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error);
  try { report.ui = await state(); } catch {}
  process.exitCode = 1; console.error(String(error));
} finally {
  try { await ab('tab', target); await evaluate(`(()=>{document.querySelectorAll('#xmf-other-fixture,#xmf-author-fixture,#xmf-duplicate-fixture,#xmf-video-duplicate-fixture').forEach(e=>e.remove());return true})()`); } catch {}
  if (original && popup) {
    try { await settings(original.a, original.c, original.b); } catch (error) { report.restoreError = String(error); }
  }
  await capture.stop();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log('Saved minimal report:', output);
  if (secondary) { try { await ab('tab', 'close', secondary); } catch {} }
  if (popup) { try { await ab('tab', 'close', popup); await ab('tab', target); } catch {} }
}
