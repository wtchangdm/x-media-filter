import assert from 'node:assert/strict';
import {readdir, readFile, access} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions.toSorted(), ['declarativeNetRequest', 'storage']);
assert.ok(!manifest.host_permissions.includes('<all_urls>'));
for (const script of manifest.content_scripts) for (const file of [...(script.js || []), ...(script.css || [])]) await access(join('extension', file));
for (const file of [manifest.background.service_worker, manifest.action.default_popup]) await access(join('extension', file));
assert.deepEqual(manifest.action.default_icon, manifest.icons);
for (const size of [16, 32, 48, 128]) {
  const icon = await readFile(join('extension', manifest.icons[size]));
  assert.equal(icon.subarray(1, 4).toString(), 'PNG');
  assert.equal(icon.readUInt32BE(16), size);
  assert.equal(icon.readUInt32BE(20), size);
}
for (const [file, width, height] of [
  ['assets/store/captures/popup-0.1.0.png', 1472, 920],
  ['assets/store/exports/small-promo-440x280.png', 440, 280],
  ['assets/store/exports/marquee-media-filter-1400x560.png', 1400, 560],
  ['assets/store/exports/screenshot-settings-1280x800.png', 1280, 800],
]) {
  const png = await readFile(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG', file);
  assert.equal(png.readUInt32BE(16), width, file);
  assert.equal(png.readUInt32BE(20), height, file);
}
assert.ok(manifest.description.length <= 132);
assert.deepEqual(manifest.web_accessible_resources[0].resources, ['player.html']);
const rules = JSON.parse(await readFile('extension/rules.json', 'utf8'));
assert.equal(new Set(rules.map(r=>r.id)).size, rules.length);
assert.ok(rules.every(r=>r.action.type==='block' && r.condition.initiatorDomains.includes('x.com') && !r.condition.resourceTypes));
for (const rule of rules) if (rule.condition.regexFilter) new RegExp(rule.condition.regexFilter);
let checked = 0;
for (const file of await files('.')) {
  if (!/\.(?:js|cjs|mjs|json|html|css|md)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  assert.ok(text.endsWith('\n'), file + ': missing final newline');
  assert.ok(!text.split('\n').some(line=>/[\t ]+$/.test(line)), file + ': trailing whitespace');
  if (/\.(?:js|cjs|mjs)$/.test(file)) execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'});
  if (file.endsWith('.json')) JSON.parse(text);
  if (file.endsWith('.md')) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^[a-z][a-z\d+.-]*:/i.test(link)) continue;
      await access(resolve(dirname(file), decodeURIComponent(link)));
    }
  }
  checked++;
}
console.log(`PASS: manifest/resources/store image dimensions, static barrier inventory, syntax, JSON, Markdown links and whitespace (${checked} files)`);
