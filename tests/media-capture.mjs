// Development-only observation of one tab, its iframe targets and the active X site worker.
// Never retains headers, cookies, API bodies, or unrelated requests.
import {CDP} from './cdp.mjs';
export class MediaCapture {
  constructor(ws, targetId, cold = false) {
    this.cdp = new CDP(ws); this.targetId = targetId; this.cold = cold;
    this.requests = new Map(); this.sessions = new Map(); this.tasks = new Map(); this.failures = [];
    this.workerSessions = new Set(); this.workerTargets = new Set(); this.siteWorkerTargets = 0;
    this.cdp.on('event', event => this.event(event));
  }
  async start() {
    const {sessionId} = await this.cdp.call('Target.attachToTarget', {targetId: this.targetId, flatten: true});
    this.root = sessionId;
    await this.setup(sessionId);
    this.version = (await this.cdp.call('Browser.getVersion')).product;
    if (!this.cold) {
      const {result} = await this.cdp.call('Runtime.evaluate', {
        expression: "(async()=>location.origin==='https://x.com' && (await navigator.serviceWorker.getRegistration())?.active?.scriptURL==='https://x.com/sw.js')()",
        returnByValue: true, awaitPromise: true,
      }, this.root);
      // A dormant registered worker has no target. Wake it before navigation so
      // network observation is installed before it handles the test workload.
      if (result.value === true) {
        await this.cdp.call('ServiceWorker.enable', {}, this.root);
        await this.cdp.call('ServiceWorker.startWorker', {scopeURL: 'https://x.com/'}, this.root);
        await this.cdp.call('ServiceWorker.disable', {}, this.root);
      }
      const {targetInfos} = await this.cdp.call('Target.getTargets');
      for (const target of targetInfos.filter(t=>t.type==='service_worker' && t.url==='https://x.com/sw.js')) {
        if (this.workerTargets.has(target.targetId)) continue;
        this.workerTargets.add(target.targetId);
        const {sessionId} = await this.cdp.call('Target.attachToTarget', {targetId: target.targetId, flatten: true});
        await this.setup(sessionId, 'worker'); this.siteWorkerTargets++;
      }
    }
  }
  setup(session, kind = 'page') {
    if (this.tasks.has(session)) return this.tasks.get(session);
    this.sessions.set(session, null);
    if (kind === 'worker') this.workerSessions.add(session);
    const task = (async () => {
      try {
        await this.cdp.call('Network.enable', {}, session);
        if (kind === 'worker') return;
        await this.cdp.call('Runtime.enable', {}, session);
        await this.cdp.call('Network.setCacheDisabled', {cacheDisabled: this.cold}, session);
        await this.cdp.call('Network.setBypassServiceWorker', {bypass: this.cold}, session);
        await this.cdp.call('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
          filter: [{type: 'iframe', exclude: false}, ...(!this.cold ? [{type: 'service_worker', exclude: false}] : []), {exclude: true}]}, session);
      } finally { await this.cdp.call('Runtime.runIfWaitingForDebugger', {}, session); }
    })();
    this.tasks.set(session, task); return task;
  }
  event(event) {
    const p = event.params;
    if (event.method === 'Target.attachedToTarget') {
      const worker = p.targetInfo.type === 'service_worker';
      if (worker && !this.workerTargets.has(p.targetInfo.targetId)) {
        this.workerTargets.add(p.targetInfo.targetId);
        if (p.targetInfo.url === 'https://x.com/sw.js') this.siteWorkerTargets++;
      }
      this.setup(p.sessionId, worker ? 'worker' : 'page').catch(error => this.failures.push(String(error))); return;
    }
    if (event.method === 'Target.detachedFromTarget') {
      this.sessions.delete(p.sessionId); this.tasks.delete(p.sessionId); this.workerSessions.delete(p.sessionId); return;
    }
    if (!this.sessions.has(event.sessionId)) return;
    if (event.method === 'Runtime.executionContextCreated' && p.context.auxData?.isDefault) {
      this.sessions.set(event.sessionId, p.context.id);
    } else if (event.method === 'Runtime.executionContextsCleared' ||
        (event.method === 'Runtime.executionContextDestroyed' && this.sessions.get(event.sessionId) === p.executionContextId)) {
      this.sessions.set(event.sessionId, null);
    }
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
      seek: '(()=>{const v=document.querySelector("video");v.currentTime=Math.min(40,v.duration/2)})()',
      pause: 'document.querySelector("video")?.pause()',
    };
    if (!expressions[action]) throw new Error('Unsupported player inspection');
    const result = [];
    for (const [session, contextId] of this.sessions) {
      if (session === this.root || this.workerSessions.has(session) || contextId === null) continue;
      try {
        const expression = `(location.protocol==='chrome-extension:' && location.pathname==='/player.html') ? (${expressions[action]}) : null`;
        // Never wait for an implicit replacement context after a renderer is revoked.
        const reply = await this.cdp.call('Runtime.evaluate', {expression, contextId, returnByValue: true, awaitPromise: true, userGesture: true}, session);
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
        if (reply.result.value != null) result.push(reply.result.value);
      } catch (error) {
        if (!/Session with given id not found|No target with given id|Cannot find context with specified id|Execution context was destroyed/.test(String(error))) throw error;
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
