// Existing Chrome only: native album plus controlled duplicate/quote isolation fixtures.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-next', output = '/tmp/xmf-groups.json', mode = 'cold'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/groups.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json] [cold|normal]');
const id = process.env.XMF_EXTENSION_ID || 'pmkikmmocmppigkinihgchopoonpoldi';
const route = 'https://x.com/OpenAIDevs/status/2110855382444704190';
const capture = new MediaCapture(ws, target, mode === 'cold');
const report = {version:'0.1.0', mode, route, results:[]};
let popup, original, second;
async function ab(...args) { return (await exec('agent-browser', ['--session',session,'--auto-connect','--pin-tab',...args], {timeout:40000,maxBuffer:1024*1024})).stdout.trim(); }
async function evaluate(code) { return JSON.parse(await ab('eval','-b',Buffer.from(code).toString('base64'))); }
async function until(fn, name) {
  const end = Date.now()+30000;
  while (Date.now()<end) { const value = await fn(); if(value) return value; await new Promise(r=>setTimeout(r,300)); }
  throw new Error('Timed out: '+name);
}
async function settings(filters) {
  await ab('tab',popup);
  for (const [key,value] of Object.entries(filters)) {
    await until(()=>evaluate(`!document.getElementById('${key}').disabled`),'popup ready');
    await ab(value?'check':'uncheck','#'+key);
  }
  await until(()=>evaluate(`['a','c','b'].every(k=>!document.getElementById(k).disabled)`),'saved');
  await ab('tab',target);
}
const state = () => evaluate(`({album:[...document.querySelectorAll('#xmf-album xmf-slot')].filter(s=>!s.closest('#xmf-quote')).map(s=>({loaded:!!s.shadowRoot.querySelector('iframe'),label:s.shadowRoot.querySelector('button')?.textContent})),outside:[...document.querySelectorAll('xmf-slot')].filter(s=>!s.closest('#xmf-album')||s.closest('#xmf-quote')).map(s=>({loaded:!!s.shadowRoot.querySelector('iframe')}))})`);
try {
  await ab('tab',target); await ab('tab','new',`chrome-extension://${id}/popup.html`);
  popup = JSON.parse(await ab('tab','list','--json')).data.tabs.find(t=>t.active).targetId;
  original = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  await settings({a:true,c:true,b:true});
  await capture.start(); report.browser=capture.version; report.observedSiteWorkerTargets=capture.siteWorkerTargets;
  const mark=capture.mark();
  await ab('open',route); await ab('tab',target);
  const count = await until(()=>evaluate(`(()=>{const a=[...document.querySelectorAll('article')].find(a=>[...a.querySelectorAll('time')].some(t=>t.closest('a')?.pathname==='/OpenAIDevs/status/2110855382444704190'));const slots=[...(a?.querySelectorAll('xmf-slot')||[])];if(slots.length<2||slots.some(s=>s.dataset.ready!=='true'))return false;a.id='xmf-album';return slots.length})()`),'native multi-image post');
  report.nativeImages=count;
  assert.equal((await state()).album.filter(s=>s.loaded).length,0);
  await until(()=>capture.since(mark).some(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT'),'pre-click barrier');
  assert.ok(capture.since(mark).every(r=>r.status===null),'no pre-click success');
  // Real asset URLs and requests, not network mocks. Fixtures test occurrence/quote boundaries.
  const fixtureImage = capture.since(mark).find(r=>new URL(r.url).pathname.startsWith('/media/'))?.url;
  assert.ok(fixtureImage, 'captured native image URL');
  await evaluate(`(()=>{const a=document.getElementById('xmf-album');const copy=a.cloneNode(true);copy.id='xmf-album-duplicate';copy.querySelectorAll('xmf-slot').forEach(s=>s.remove());a.after(copy);const q=document.createElement('div');q.id='xmf-quote';q.setAttribute('role','link');q.innerHTML='<div data-testid="User-Name"></div><a href="https://x.com/Gavmn/status/2111136119945396436/photo/1"><div data-testid="tweetPhoto" style="height:100px"><img></div></a>';q.querySelector('img').src=${JSON.stringify(fixtureImage)};a.append(q);return true})()`);
  await until(()=>evaluate(`document.querySelectorAll('#xmf-album-duplicate xmf-slot').length===${count}&&!!document.querySelector('#xmf-quote xmf-slot')`),'isolation fixtures');
  await evaluate(`(()=>{document.querySelectorAll('xmf-slot').forEach(s=>s.shadowRoot.querySelector('button')?.click());return true})()`);
  assert.ok((await state()).album.every(s=>!s.loaded),'synthetic clicks rejected');
  await ab('tab','new',route);
  second=JSON.parse(await ab('tab','list','--json')).data.tabs.find(t=>t.active).targetId;
  await until(()=>evaluate(`document.querySelectorAll('xmf-slot').length>=${count}`),'second tab');
  await ab('tab',target);
  await evaluate(`(()=>{const s=document.querySelector('#xmf-album xmf-slot');s.id='xmf-album-selected';s.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  const snapshot=await ab('snapshot','-i','-s','#xmf-album-selected');
  const ref=snapshot.match(/button .*\[ref=(e\d+)\]/)?.[1];assert.ok(ref,'accessible album control');
  const clickTime=capture.mark();await ab('click','@'+ref);
  await until(async()=> (await state()).album.every(s=>s.loaded),'one click loads every native image');
  await until(async()=> (await capture.player()).filter(p=>p.width>0).length===count,'decoded album images');
  assert.ok((await state()).outside.every(s=>!s.loaded),'quote, duplicate and other posts remain blocked');
  await until(()=>capture.since(mark).every(r=>r.error||r.finished),'network outcomes');
  const requests=capture.since(mark), success=requests.filter(r=>r.status>=200&&r.status<300);
  assert.equal(new Set(success.map(r=>policy.assetKey(r.url))).size,count,'exactly the selected album assets');
  assert.ok(success.every(r=>r.time>=clickTime&&r.document?.startsWith('chrome-extension://')&&r.credentialHeaders!==true));
  const page=requests.filter(r=>!r.document?.startsWith('chrome-extension://'));
  assert.ok(page.length>0&&page.every(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT'),'page media never released');
  await ab('tab',second);assert.equal(await evaluate(`[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')).length`),0,'cross-tab isolation');
  await ab('tab',target);
  report.results.push({name:'native album single click with duplicate/quote/tab isolation',passed:true,decodedImages:count,authorizedAssets:count,pageBlocked:page.length,successfulURLVariants:new Set(success.map(r=>r.url)).size,statuses:[...new Set(success.map(r=>r.status))]});
  await settings({a:false,c:true,b:true});await settings({a:true,c:true,b:true});
  await until(async()=> (await state()).album.every(s=>!s.loaded),'album revocation');
  await ab('reload');await until(()=>evaluate(`document.querySelectorAll('xmf-slot').length>=${count}&&[...document.querySelectorAll('xmf-slot')].every(s=>!s.shadowRoot.querySelector('iframe'))`),'reload resets album');
  report.results.push({name:'category revocation and reload reset',passed:true});
  assert.equal(capture.failures.length,0,capture.failures.join('\n'));report.passed=true;console.log('PASS native album, isolation, revocation and reload');
} catch(error) {report.passed=false;report.error=String(error);process.exitCode=1;console.error(String(error));}
finally {
  try { await ab('tab',target); await evaluate(`(()=>{document.querySelectorAll('#xmf-album-duplicate,#xmf-quote').forEach(e=>e.remove());return true})()`); } catch {}
  if(original&&popup)try{await settings(original);}catch(error){report.restoreError=String(error);process.exitCode=1;}
  await capture.stop();await writeFile(output,JSON.stringify(report,null,2)+'\n');
  for(const tab of [second,popup])if(tab)try{await ab('tab','close',tab);}catch{}
  try{await ab('tab',target);}catch{}
}
