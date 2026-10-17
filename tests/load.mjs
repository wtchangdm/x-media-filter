// Requires an existing Chrome with unpacked-extension debugging enabled.
import {resolve} from 'node:path';
import {CDP} from './cdp.mjs';
const [ws] = process.argv.slice(2);
if (!ws) throw new Error('Usage: node tests/load.mjs <existing-browser-ws>');
const cdp = new CDP(ws);
try { console.log(await cdp.call('Extensions.loadUnpacked', {path: resolve('extension')})); }
finally { cdp.close(); }
