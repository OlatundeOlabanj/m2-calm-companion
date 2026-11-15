const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClipRunner } = require('../clip-runner.cjs');

function script(body) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm2rt-')), 's.cjs');
  fs.writeFileSync(f, body);
  return f;
}
const out = (o) => 'process.stdout.write(JSON.stringify(' + JSON.stringify(o) + ') + "\\n");';

test('C01 progress events are passed on and the done event resolves', async () => {
  const f = script(out({ type: 'progress', t: 1, count: 1 }) + out({ type: 'progress', t: 2, count: 2 }) + out({ type: 'done', summary: { good: 2 }, stats: {} }));
  const r = createClipRunner({ script: f });
  const seen = [];
  const res = await r.run('/x.mp4', 'k', process.execPath, (e) => seen.push(e.type));
  assert.deepEqual(seen, ['progress', 'progress']);
  assert.equal(res.summary.good, 2);
  assert.equal(r.busy(), false);
});

test('C02 the key reaches the child by environment, not on the command line', async () => {
  const f = script('process.stdout.write(JSON.stringify({type:"done",summary:{env:process.env.PRESAGE_API_KEY,args:process.argv.slice(2)}})+"\\n");');
  const res = await createClipRunner({ script: f }).run('/x.mp4', 'SECRET', process.execPath, () => {});
  assert.equal(res.summary.env, 'SECRET');
  assert.ok(!res.summary.args.join(' ').includes('SECRET'));
  assert.deepEqual(res.summary.args.slice(0, 1), ['/x.mp4']);
});

test('C03 an error event rejects with its message and the exit code', async () => {
  const f = script(out({ type: 'error', message: 'No PRESAGE_API_KEY', name: '' }) + 'process.exit(2);');
  await assert.rejects(() => createClipRunner({ script: f }).run('/x.mp4', '', process.execPath, () => {}), (e) => /No PRESAGE_API_KEY/.test(e.message) && e.exitCode === 2);
});

test('C04 a crash with no JSON gives the last line of stderr', async () => {
  const f = script('console.error("boom happened"); process.exit(1);');
  await assert.rejects(() => createClipRunner({ script: f }).run('/x.mp4', 'k', process.execPath, () => {}), (e) => /boom happened/.test(e.message));
});

test('C05 a missing program rejects with exit code 3 so the caller can try another runtime', async () => {
  const f = script('');
  await assert.rejects(() => createClipRunner({ script: f }).run('/x.mp4', 'k', 'no-such-program-m2', () => {}), (e) => e.exitCode === 3);
});

test('C06 kill stops a running reader and it is not busy afterwards', async () => {
  const f = script('setInterval(() => {}, 1000);');
  const r = createClipRunner({ script: f });
  const p = r.run('/x.mp4', 'k', process.execPath, () => {});
  await new Promise((x) => setTimeout(x, 200));
  assert.equal(r.busy(), true);
  r.kill();
  await assert.rejects(() => p, (e) => e.exitCode === -1);
  assert.equal(r.busy(), false);
});

test('C07 the result is returned as soon as it arrives even if the reader process never exits, and the process is then stopped', async () => {
  const f = script(out({ type: 'done', summary: { good: 1 }, stats: {} }) + 'setInterval(() => {}, 1000);');
  const r = createClipRunner({ script: f });
  const t0 = Date.now();
  const res = await r.run('/x.mp4', 'k', process.execPath, () => {});
  assert.equal(res.summary.good, 1);
  assert.ok(Date.now() - t0 < 1500, 'must not wait for the process to exit');
  await new Promise((x) => setTimeout(x, 2600));
  assert.equal(r.busy(), false, 'the lingering process is stopped');
});

test('C08 a network failure is tried again and then succeeds', async () => {
  const flag = path.join(os.tmpdir(), 'm2retry-' + process.pid + '-' + Date.now());
  const f = script('const fs=require("fs");const flag=' + JSON.stringify(flag) + ';if(!fs.existsSync(flag)){fs.writeFileSync(flag,"1");process.stdout.write(JSON.stringify({type:"error",message:"A network error occurred during SmartSpectra processing.",name:"kNetworkError"})+"\\n");process.exit(1);}process.stdout.write(JSON.stringify({type:"done",summary:{good:9}})+"\\n");');
  const seen = [];
  const res = await createClipRunner({ script: f }).runRetrying('/x.mp4', 'k', process.execPath, (e) => seen.push(e.type), { retries: 2, delayMs: 10 });
  assert.equal(res.summary.good, 9);
  assert.deepEqual(seen, ['retry']);
  try { fs.unlinkSync(flag); } catch (e) { /* gone */ }
});

test('C09 other errors are not retried, and network errors give up after the limit', async () => {
  const bad = script(out({ type: 'error', message: 'No PRESAGE_API_KEY', name: '' }) + 'process.exit(2);');
  const seen = [];
  await assert.rejects(() => createClipRunner({ script: bad }).runRetrying('/x.mp4', '', process.execPath, (e) => seen.push(e.type), { delayMs: 10 }), /No PRESAGE_API_KEY/);
  assert.deepEqual(seen, []);
  const net = script(out({ type: 'error', message: 'A network error occurred', name: 'kNetworkError' }) + 'process.exit(1);');
  const seen2 = [];
  await assert.rejects(() => createClipRunner({ script: net }).runRetrying('/x.mp4', 'k', process.execPath, (e) => seen2.push(e.type), { retries: 1, delayMs: 10 }), (e) => e.reason === 'kNetworkError');
  assert.deepEqual(seen2, ['retry']);
});
