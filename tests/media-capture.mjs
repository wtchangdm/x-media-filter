// Development-only observation of one tab, its iframe targets and the active X site worker.
// Never retains headers, cookies, API bodies, or unrelated requests.
import {CDP} from './cdp.mjs';
export class MediaCapture {
  constructor(ws, targetId, cold = false) {
    this.cdp = new CDP(ws); this.targetId = targetId; this.cold = cold;
    this.requests = new Map(); this.sessions = new Map(); this.tasks = new Map(); this.failures = [];
    this.workerSessions = new Set(); this.siteWorkerTargets = 0;
    this.cdp.on('event', event => this.event(event));
  }
  async start() {
    const {sessionId} = await this.cdp.call('Target.attachToTarget', {targetId: this.targetId, flatten: true});
    this.root = sessionId;
    await this.setup(sessionId, 'page');
    this.version = (await this.cdp.call('Browser.getVersion')).product;
    if (!this.cold) {
      const {targetInfos} = await this.cdp.call('Target.getTargets');
      for (const target of targetInfos.filter(t=>t.type==='service_worker' && t.url==='https://x.com/sw.js')) {
        const {sessionId} = await this.cdp.call('Target.attachToTarget', {targetId: target.targetId, flatten: true});
        await this.setup(sessionId, target.url, 'worker'); this.siteWorkerTargets++;
      }
    }
  }
  setup(session, url, kind = 'page') {
    if (this.tasks.has(session)) return this.tasks.get(session);
    this.sessions.set(session, url);
    if (kind === 'worker') this.workerSessions.add(session);
    const task = (async () => {
      try {
        await this.cdp.call('Network.enable', {}, session);
        if (kind === 'worker') return;
        await this.cdp.call('Network.setCacheDisabled', {cacheDisabled: this.cold}, session);
        await this.cdp.call('Network.setBypassServiceWorker', {bypass: this.cold}, session);
        await this.cdp.call('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
          filter: [{type: 'iframe', exclude: false}, {exclude: true}]}, session);
      } finally { await this.cdp.call('Runtime.runIfWaitingForDebugger', {}, session); }
    })();
    this.tasks.set(session, task); return task;
  }
  event(event) {
    const p = event.params;
    if (event.method === 'Target.attachedToTarget') {
      this.setup(p.sessionId, p.targetInfo.url, p.targetInfo.type === 'service_worker' ? 'worker' : 'page').catch(error => this.failures.push(String(error))); return;
    }
    if (event.method === 'Target.detachedFromTarget') {
      this.sessions.delete(p.sessionId); this.tasks.delete(p.sessionId); this.workerSessions.delete(p.sessionId); return;
    }
    if (!this.sessions.has(event.sessionId)) return;
    const key = event.sessionId + ':' + p.requestId;
    if (event.method === 'Network.requestWillBeSent') {
      const u = new URL(p.request.url);
      if (u.hostname === 'video.twimg.com' || (u.hostname === 'pbs.twimg.com' && /^\/(media|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//.test(u.pathname))) {
        this.requests.set(key, {url: u.origin + u.pathname + u.search, type: p.type, time: p.wallTime * 1000,
          document: p.documentURL?.split('#')[0], status: null, bytes: 0, received: 0, blocked: null,
          redirect: p.redirectResponse?.status || null});
      }
    }
    const req = this.requests.get(key);
    if (!req) return;
    if (event.method === 'Network.requestWillBeSentExtraInfo') {
      req.credentialHeaders = Object.keys(p.headers).some(name=>['cookie','authorization'].includes(name.toLowerCase()));
    }
    if (event.method === 'Network.responseReceived') {
      req.status = p.response.status; req.cache = !!p.response.fromDiskCache; req.siteWorker = !!p.response.fromServiceWorker;
    }
    if (event.method === 'Network.dataReceived') req.received += p.encodedDataLength;
    if (event.method === 'Network.loadingFinished') { req.bytes = p.encodedDataLength; req.finished = true; }
    if (event.method === 'Network.loadingFailed') { req.blocked = p.blockedReason || p.errorText; req.error = p.errorText; }
  }
  mark() { return Date.now(); }
  since(mark) { return [...this.requests.values()].filter(req => req.time >= mark); }
  async player(action = 'state') {
    const expressions = {
      state: '({kind:document.querySelector("video")?"video":"image",ready:document.querySelector("video")?.readyState,time:document.querySelector("video")?.currentTime,paused:document.querySelector("video")?.paused,duration:document.querySelector("video")?.duration,width:document.querySelector("img")?.naturalWidth,error:document.getElementById("status")?.hidden?null:document.getElementById("status")?.textContent})',
      play: '(async()=>{const v=document.querySelector("video");v.muted=true;await v.play();return true})()',
      seek: 'document.querySelector("video").currentTime=40',
      pause: 'document.querySelector("video")?.pause()',
    };
    if (!expressions[action]) throw new Error('Unsupported player inspection');
    const result = [];
    for (const [session, url] of this.sessions) {
      if (session === this.root || this.workerSessions.has(session)) continue;
      try {
        const expression = `(location.protocol==='chrome-extension:' && location.pathname==='/player.html') ? (${expressions[action]}) : null`;
        const reply = await this.cdp.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true}, session);
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
        if (reply.result.value != null) result.push(reply.result.value);
      } catch (error) {
        if (!String(error).includes('Session with given id not found') && !String(error).includes('No target with given id')) throw error;
      }
    }
    return result;
  }
  async stop() {
    for (const session of this.sessions.keys()) {
      if (this.workerSessions.has(session)) continue;
      try {
        await this.cdp.call('Network.setCacheDisabled', {cacheDisabled: false}, session);
        await this.cdp.call('Network.setBypassServiceWorker', {bypass: false}, session);
      } catch { /* Detached frames need no restoration. */ }
    }
    this.cdp.close();
  }
}
