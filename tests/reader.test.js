const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { readClip, summarize, extract } = require('../reader.cjs');

const mkBuf = (b, p, extra) => { const x = new Uint8Array(1); x.decoded = Object.assign({ breathing: { rate: [{ value: b }] }, cardio: { pulseRate: [{ value: p }] } }, extra || {}); return x; };

// Mock of the Node SDK: plays a short "clip" when start() is called.
function mockLib(script, opts = {}) {
  const inst = new EventEmitter();
  inst.calls = [];
  inst.useFile = (f, o) => { inst.calls.push(['useFile', f, o]); if (opts.throwOnUse) throw new Error('bad file'); };
  inst.start = () => { inst.calls.push(['start']); setTimeout(() => script(inst), 5); };
  inst.stopAsync = async () => { inst.calls.push(['stopAsync']); };
  inst.destroy = async () => { inst.calls.push(['destroy']); };
  const lib = {
    SmartSpectraSDK: function (o) { inst.opts = o; return inst; },
    breathingMetrics: [2], cardioMetrics: [15], faceMetrics: [30],
    decodeMetrics: (b) => b.decoded,
    ProcessingStatus: { kIdle: 1, kStarting: 2, kRunning: 3, kStopping: 4, kError: 5 },
  };
  return { lib, inst };
}

test('R01 a clip is read to the end and every reading is collected', async () => {
  const { lib, inst } = mockLib((s) => {
    s.emit('processingStatus', 2); s.emit('processingStatus', 3);
    s.emit('validationStatus', 0, 1000000, '');
    for (let i = 1; i <= 8; i++) s.emit('metrics', mkBuf(14 + (i % 2), 70 + i), i * 1e6);
    s.emit('processingStatus', 1);
  });
  const res = await readClip(lib, { apiKey: 'k', file: '/x/clip.mp4', delayMs: 3, timeoutMs: 0 });
  assert.equal(res.samples.length, 8);
  assert.equal(inst.opts.enableTelemetry, false);
  assert.deepEqual(inst.opts.requestedMetrics, [2, 15, 30]);
  assert.deepEqual(inst.calls[0], ['useFile', '/x/clip.mp4', { interframeDelayMs: 3 }]);
  assert.ok(inst.calls.some((c) => c[0] === 'destroy'));
  assert.equal(res.samples[7].t, 8);
});

test('R02 the first idle before the clip starts is not mistaken for the end', async () => {
  const { lib } = mockLib((s) => {
    s.emit('processingStatus', 1); // initial idle
    s.emit('processingStatus', 3);
    s.emit('metrics', mkBuf(15, 72), 1e6);
    s.emit('processingStatus', 1);
  });
  const res = await readClip(lib, { apiKey: 'k', file: 'c.mp4', timeoutMs: 0 });
  assert.equal(res.samples.length, 1);
});

test('R03 an SDK error rejects with its code and the engine is torn down', async () => {
  const { lib, inst } = mockLib((s) => { s.emit('processingStatus', 2); s.emit('error', 7, 'SmartSpectra input is unavailable.', false); });
  await assert.rejects(() => readClip(lib, { apiKey: 'k', file: 'c.webm', timeoutMs: 0 }), (e) => e.code === 7 && /unavailable/.test(e.message));
  assert.ok(inst.calls.some((c) => c[0] === 'destroy'));
});

test('R04 a file the SDK cannot open (thrown by useFile) rejects', async () => {
  const { lib } = mockLib(() => {}, { throwOnUse: true });
  await assert.rejects(() => readClip(lib, { apiKey: 'k', file: 'c.mp4', timeoutMs: 0 }), /bad file/);
});

test('R05 a clip that never finishes times out instead of hanging', async () => {
  const { lib } = mockLib((s) => { s.emit('processingStatus', 3); });
  await assert.rejects(() => readClip(lib, { apiKey: 'k', file: 'c.mp4', timeoutMs: 60 }), (e) => e.code === 'timeout');
});

test('R06 validation checks are counted and the last hint is kept', async () => {
  const { lib } = mockLib((s) => {
    s.emit('processingStatus', 3);
    s.emit('validationStatus', 5, 1, 'Too dark'); s.emit('validationStatus', 5, 2, 'Too dark'); s.emit('validationStatus', 0, 3, '');
    s.emit('processingStatus', 1);
  });
  const res = await readClip(lib, { apiKey: 'k', file: 'c.mp4', timeoutMs: 0 });
  assert.equal(res.validation[5], 2); assert.equal(res.validation[0], 1);
  assert.equal(res.hint, 'Too dark');
});

test('R07 extract reads breathing, pulse, HRV, expression, blinking and talking; empty messages give null', () => {
  const m = { breathing: { rate: [{ value: 13 }, { value: 14.5 }] }, cardio: { pulseRate: [{ value: 66 }], hrv: [{ rmssd: 41, stable: true, confidence: 80 }] },
    face: { expression: [{ stable: true, scores: [{ type: 6, confidence: 70 }, { type: 5, confidence: 20 }] }], blinking: [{ detected: true }], talking: [{ detected: false }] } };
  const s = extract(m);
  assert.equal(s.breathing, 14.5); assert.equal(s.pulse, 66);
  assert.deepEqual(s.hrv, { rmssd: 41, stable: true, confidence: 80 });
  assert.deepEqual(s.expression, { type: 'neutral', conf: 70, stable: true });
  assert.equal(s.blinking, true); assert.equal(s.talking, false);
  assert.equal(extract({}), null); assert.equal(extract(null), null); assert.equal(extract(new Uint8Array(1)), null);
});

test('R08 summarize uses the settled second half, keeps a calm series, and handles an empty clip', () => {
  const samples = [];
  for (let i = 0; i < 20; i++) samples.push({ t: i + 1, breathing: i < 10 ? 20 : 14, pulse: i < 10 ? 95 : 70, hrv: null, expression: null, blinking: null, talking: null });
  samples[19].hrv = { rmssd: 40, stable: true };
  const s = summarize(samples);
  assert.equal(s.breathing, 14); assert.equal(s.pulse, 70);
  assert.equal(s.good, 20); assert.equal(s.seconds, 20);
  assert.deepEqual(s.hrv, { rmssd: 40, stable: true });
  assert.equal(s.series.length, 15); // first quarter skipped
  const e = summarize([]);
  assert.equal(e.good, 0); assert.ok(Number.isNaN(e.breathing)); assert.equal(e.seconds, 0);
});

test('R09 breathing and pulse that arrive in separate messages are still combined', () => {
  const samples = [];
  for (let i = 0; i < 40; i++) {
    const base = { hrv: null, expression: null, blinking: null, talking: null, t: i + 1, breathing: NaN, pulse: NaN };
    if (i % 2 === 0) samples.push(Object.assign({}, base, { breathing: 15 })); else samples.push(Object.assign({}, base, { pulse: 72 }));
  }
  const s = summarize(samples);
  assert.equal(s.breathing, 15); assert.equal(s.pulse, 72);
  assert.ok(s.good >= 38); assert.equal(s.breathingCount, 20); assert.equal(s.pulseCount, 20);
  const onlyPulse = summarize(samples.filter((x) => Number.isFinite(x.pulse)));
  assert.equal(onlyPulse.good, 0); assert.equal(onlyPulse.pulseCount, 20); assert.ok(Number.isNaN(onlyPulse.breathing));
});
