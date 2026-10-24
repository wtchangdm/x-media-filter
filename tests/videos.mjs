// Existing Chrome only. Native video regression independent of reply availability.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws,target,session='xmf-video-fix',output='/tmp/xmf-videos.json',mode='normal']=process.argv.slice(2);
if(!ws||!target)throw new Error('Usage: node tests/videos.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json] [cold|normal]');
const extensionId=process.env.XMF_EXTENSION_ID||'pmkikmmocmppigkinihgchopoonpoldi';
const capture=new MediaCapture(ws,target,mode==='cold');
const report={version:'0.1.1',mode,results:[]};
let popup,original;
async function ab(...args){return (await exec('agent-browser',['--session',session,'--auto-connect','--pin-tab',...args],{encoding:'utf8',timeout:40000,maxBuffer:1024*1024})).stdout.trim();}
async function evaluate(code){return JSON.parse(await ab('eval','-b',Buffer.from(code).toString('base64')));}
async function until(fn,name){
  const end=Date.now()+30000;
  while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,300));}
  throw new Error('Timed out: '+name);
}
const state=()=>evaluate(`({selected:!!document.getElementById('xmf-video-selected')?.shadowRoot.querySelector('iframe'),duplicate:!!document.querySelector('#xmf-video-copy xmf-slot')?.shadowRoot.querySelector('iframe'),loaded:[...document.querySelectorAll('xmf-slot')].filter(s=>s.shadowRoot.querySelector('iframe')).length,pending:[...document.querySelectorAll('xmf-slot')].some(s=>s.shadowRoot.querySelector('button')?.disabled)})`);
async function settings(filters){
  await ab('tab',popup);
  for(const [key,value] of Object.entries(filters)){
    await until(()=>evaluate(`!document.getElementById('${key}').disabled`),'popup ready');
    await ab(value?'check':'uncheck','#'+key);
  }
  await until(()=>evaluate(`['a','c','b'].every(k=>!document.getElementById(k).disabled)`),'settings saved');
  await ab('tab',target);
}
async function discover(postId){
  await until(()=>evaluate(`(()=>{const a=[...document.querySelectorAll('article')].find(a=>a.id!=='xmf-video-copy'&&[...a.querySelectorAll('time')].some(t=>t.closest('a')?.pathname.endsWith('/status/${postId}')));const s=a?.querySelector('xmf-slot[data-ready="true"]');if(!s)return false;s.id='xmf-video-selected';return true})()`),'focused video metadata');
}
async function evidence(name,mark,expected){
  // Native range streams can remain open while paused; wait for page barrier
  // outcomes, not completion of an entire authorized video download.
  await until(()=>capture.since(mark).filter(r=>!r.document?.startsWith('chrome-extension://')).every(r=>r.error||r.finished),'page network outcomes');
  const requests=capture.since(mark),success=requests.filter(r=>r.status>=200&&r.status<300);
  const assets=new Set(success.map(r=>policy.assetKey(r.url)));
  if(expected!==null)assert.equal(assets.size,expected,name+': successful assets');
  const page=requests.filter(r=>!r.document?.startsWith('chrome-extension://'));
  assert.ok(page.every(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT'),name+': page barrier');
  assert.ok(success.every(r=>r.document?.startsWith('chrome-extension://')),name+': extension-only payloads');
  report.results.push({name,passed:true,authorizedAssets:assets.size,pageBlocked:page.length,statuses:[...new Set(success.map(r=>r.status))]});
  console.log('PASS',name);
  return requests;
}
try{
  await ab('tab',target);
  popup=JSON.parse(await ab('tab','new',`chrome-extension://${extensionId}/popup.html`,'--json')).data.targetId;
  original=await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  await settings({a:true,c:true,b:true});
  await capture.start();report.browser=capture.version;report.observedSiteWorkerTargets=capture.siteWorkerTargets;
  for(const [name,url,postId] of [
    ['custom-cover','https://x.com/github/status/2111225205309780009','2111225205309780009'],
    ['encoded-thumbnail','https://x.com/thsottiaux/status/2111249534072529256','2111249534072529256'],
  ]){
    const mark=capture.mark();await ab('open',url);await ab('tab',target);await discover(postId);
    await evaluate(`(()=>{const a=document.getElementById('xmf-video-selected').closest('article');const copy=a.cloneNode(true);copy.id='xmf-video-copy';copy.querySelectorAll('xmf-slot').forEach(s=>s.remove());a.after(copy);return true})()`);
    await until(()=>evaluate(`!!document.querySelector('#xmf-video-copy xmf-slot[data-ready="true"]')`),'duplicate metadata');
    await evaluate(`(()=>{document.querySelectorAll('xmf-slot').forEach(s=>s.shadowRoot.querySelector('button')?.click());return true})()`);
    assert.equal((await state()).loaded,0,'synthetic activation rejected');
    await until(()=>capture.since(mark).some(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT'),'blocked media attempt');
    await evidence(name+' before click',mark,0);
    await evaluate(`(()=>{document.getElementById('xmf-video-selected').scrollIntoView({block:'center',behavior:'instant'});return true})()`);
    const snapshot=await ab('snapshot','-i','-s','#xmf-video-selected');
    const ref=snapshot.match(/button .*\[ref=(e\d+)\]/)?.[1];assert.ok(ref,'accessible video placeholder');
    await ab('click','@'+ref);
    await until(async()=> (await capture.player()).some(p=>p.kind==='video'&&p.ready>=1),'native video metadata');
    await capture.player('play');await until(async()=> (await capture.player()).some(p=>p.time>1&&!p.paused),'native playback');
    await capture.player('seek');await until(async()=> (await capture.player()).some(p=>p.time>=40&&p.ready>=2),'seek to 40 seconds');
    await capture.player('pause');assert.equal((await state()).duplicate,false,'duplicate stays blocked');
    await evidence(name+' single video playback and seek',mark,1);
    const reloadMark=capture.mark();await ab('reload');await discover(postId);
    await until(async()=>{const s=await state();return s.loaded===0&&!s.pending;},'reload revokes selection');
    await evidence(name+' reload before automatic eligibility',reloadMark,0);
    const autoMark=capture.mark();await settings({a:false,c:true,b:true});
    await until(async()=> (await state()).selected,'automatic eligibility without manual grant');
    await until(async()=> (await capture.player()).some(p=>p.kind==='video'&&p.ready>=1),'automatic video metadata');
    await evidence(name+' automatic loading',autoMark,null);
    await settings({a:true,c:true,b:true});
    await until(async()=>{const s=await state();return s.loaded===0&&!s.pending;},'category revokes video');
    report.results.push({name:name+' category revocation',passed:true});
  }
  assert.equal(capture.failures.length,0,capture.failures.join('\n'));report.passed=true;
}catch(error){report.passed=false;report.error=String(error);process.exitCode=1;console.error(String(error));}
finally{
  try{await ab('tab',target);await evaluate(`(()=>{document.getElementById('xmf-video-copy')?.remove();return true})()`);}catch{}
  if(original&&popup)try{await settings(original);}catch(error){report.restoreError=String(error);process.exitCode=1;}
  await capture.stop();await writeFile(output,JSON.stringify(report,null,2)+'\n');
  if(popup)try{await ab('tab','close',popup);await ab('tab',target);}catch{}
}
