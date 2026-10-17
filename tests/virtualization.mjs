// Verifies a real X timeline remount, not a cloned DOM node. Existing Chrome only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {MediaCapture} from './media-capture.mjs';
import policy from '../extension/policy.js';
const exec = promisify(execFile);
const [ws, target, session = 'xmf-user', output = '/tmp/xmf-virtualization.json'] = process.argv.slice(2);
if (!ws || !target) throw new Error('Usage: node tests/virtualization.mjs <existing-browser-ws> <agent-owned-target-id> [session] [output.json]');
const capture = new MediaCapture(ws, target, true);
const report = {};
const id = process.env.XMF_EXTENSION_ID || 'pmkikmmocmppigkinihgchopoonpoldi';
let popup;
async function ab(...args) { return (await exec('agent-browser', ['--session',session,'--auto-connect','--pin-tab',...args],{timeout:40000,maxBuffer:1024*1024})).stdout.trim(); }
async function evaluate(code) { return JSON.parse(await ab('eval','-b',Buffer.from(code).toString('base64'))); }
async function until(fn, name) {
  for(let i=0;i<60;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,500));}
  throw new Error('Timed out: '+name);
}
try {
  await ab('tab', target);
  await ab('tab', 'new', `chrome-extension://${id}/popup.html`);
  popup = JSON.parse(await ab('tab', 'list', '--json')).data.tabs.find(t=>t.active).targetId;
  report.settings = await evaluate('chrome.storage.local.get("filters").then(r=>XMFPolicy.normalizeSettings(r.filters))');
  assert.deepEqual(report.settings, {a:true,c:true,b:true}, 'precondition: all three filters must be ON');
  await ab('tab', 'close', popup); popup = null; await ab('tab', target);
  await capture.start(); report.browser = capture.version;
  await ab('open','https://x.com/ArtificialAnlys/status/2110893784422908225');await ab('tab',target);
  await ab('scroll','down','2200');
  const selected = await until(()=>evaluate(`(()=>{const s=[...document.querySelectorAll('xmf-slot')].find(s=>s.dataset.category==='C'&&s.dataset.identity==='stable'&&s.dataset.ready==='true'&&[...(s.closest('article')?.querySelectorAll('time')||[])].some(t=>t.closest('a')?.pathname.startsWith('/ArtificialAnlys/status/')&&!t.closest('a').pathname.includes('2110893784422908225')));if(!s)return null;s.id='xmf-virtual-selected';window.__xmfVirtualOld=s.closest('article');const link=[...s.closest('article').querySelectorAll('time')].map(t=>t.closest('a')).find(Boolean);return link.pathname})()`),'stable same-author reply');
  await evaluate(`(async()=>{const s=document.getElementById('xmf-virtual-selected');await s.scrollIntoView({block:'center',behavior:'instant'});s.shadowRoot.querySelector('button').focus();return true})()`);
  const top = await evaluate('scrollY');
  await ab('press','Enter');
  await until(async()=> (await capture.player()).some(p=>p.width>0),'selected image');
  await ab('scroll','down','12000');
  await until(()=>evaluate('!window.__xmfVirtualOld.isConnected'),'old article removed by X virtualization');
  report.oldNodeRemoved = true;
  await evaluate(`(async()=>{await window.scrollTo({top:${top},behavior:'instant'});return true})()`);
  await until(()=>evaluate(`(()=>{const a=[...document.querySelectorAll('article')].find(a=>[...a.querySelectorAll('time')].some(t=>t.closest('a')?.pathname===${JSON.stringify(selected)}));if(!a)return false;const s=a.querySelector('xmf-slot');return a!==window.__xmfVirtualOld&&s?.dataset.category==='C'&&s.dataset.identity==='stable'&&!!s.shadowRoot.querySelector('iframe')})()`),'grant restored to the remounted timeline entry');
  await until(async()=> (await capture.player()).some(p=>p.width>0),'restored image pixels');
  const reqs = [...capture.requests.values()];
  const success = reqs.filter(r=>r.status>=200&&r.status<300);
  assert.equal(new Set(success.map(r=>policy.assetKey(r.url))).size,1,'only selected asset may succeed');
  assert.ok(success.every(r=>r.document.startsWith('chrome-extension://')));
  assert.ok(reqs.filter(r=>!r.document?.startsWith('chrome-extension://')).every(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT'));
  report.restoredToNewNode = true; report.authorizedAssets = 1;
  report.authorizedURLVariants = new Set(success.map(r=>r.url)).size;
  report.blockedPageRequests = reqs.filter(r=>r.error==='net::ERR_BLOCKED_BY_CLIENT').length;
  report.passed = true; console.log('PASS real X virtualization and isolated grant restoration');
} catch(error) {report.passed=false;report.error=String(error);process.exitCode=1;console.error(String(error));}
finally {
  if (popup) { try {await ab('tab','close',popup);await ab('tab',target);} catch {} }
  try {await evaluate('delete window.__xmfVirtualOld');} catch {}
  await capture.stop();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log('Saved aggregate report:',output);
}
