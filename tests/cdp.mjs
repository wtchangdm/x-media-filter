// Development-only CDP transport. Never used by the extension at runtime.
import {EventEmitter} from 'node:events';
export class CDP extends EventEmitter {
  constructor(url) {
    super();
    this.pending = new Map(); this.next = 0;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.close(); reject(new Error('CDP connection timed out')); }, 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, {once: true});
    });
    this.socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id); clearTimeout(pending.timer);
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      } else this.emit('event', msg);
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP closed')); }
      this.pending.clear();
    });
  }
  async call(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, {resolve, reject, timer});
      this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  close() { this.socket.close(); }
}
