const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createLive } = require('../renderer/live.js');
const { createSpeaker } = require('../speak.cjs');

// Mock of the Presage renderer SDK, shaped like the documented API.
function mockPR() {
  const inst = new EventEmitter();
  inst.start = async () => { inst.started = true; };
  inst.stop = async () => { inst.stopped = true; };
  inst.destroy = () => { inst.destroyed = true; };
  const PR = {
    SmartSpectraSDK: function (opts) { inst.opts = opts; return inst; },
    breathingMetrics: [2], cardioMetrics: [15],
    decodeMetrics: (buf) => buf.decoded,
  };
  return { PR, inst };
}
const metricsBuf = (b, p) => { const x = new Uint8Array(1); x.decoded = { breathing: { rate: [{ value: b - 1 }, { value: b }] }, cardio: { pulseRate: [{ value: p }] } }; return x; };

test('L01 without an API key start explains what is missing', async () => {
  const { PR } = mockPR();
  const l = createLive({ PR, apiKey: '' });
  await assert.rejects(() => l.start(), /PRESAGE_API_KEY/);
});

test('L02 telemetry is off and breathing plus cardio are requested', async () => {
  const { PR, inst } = mockPR();
  const l = createLive({ PR, apiKey: 'k' });
  await l.start();
  assert.equal(inst.opts.enableTelemetry, false);
  assert.deepEqual(inst.opts.requestedMetrics, [2, 15]);
  assert.equal(inst.opts.apiKey, 'k');
  await l.stop();
});

test('L03 good validation plus metrics gives readings with good quality', async () => {
  const { PR, inst } = mockPR();
  const got = [];
  const l = createLive({ PR, apiKey: 'k' });
  l.onSample((s) => got.push(s));
  await l.start();
  inst.emit('validationStatus', 0, 1, '');
  inst.emit('metrics', metricsBuf(15.5, 72), 1);
  const s = got[got.length - 1];
  assert.equal(s.breathing, 15.5);
  assert.equal(s.pulse, 72);
  assert.ok(s.quality >= 0.4);
  await l.stop();
});

test('L04 no face gives low quality and a hint', async () => {
  const { PR, inst } = mockPR();
  const got = [];
  const l = createLive({ PR, apiKey: 'k' });
  l.onSample((s) => got.push(s));
  await l.start();
  inst.emit('metrics', metricsBuf(14, 70), 1);
  inst.emit('validationStatus', 1, 2, '');
  const s = got[got.length - 1];
  assert.ok(s.quality < 0.4);
  assert.match(s.hint, /No face/);
  await l.stop();
});

test('L05 before any camera data the hint says waiting, not a false no-face', async () => {
  const { PR, inst } = mockPR();
  const got = [];
  const l = createLive({ PR, apiKey: 'k' });
  l.onSample((s) => got.push(s));
  await l.start();
  inst.emit('processingStatus', 1);
  inst.emit('metrics', metricsBuf(14, 70), 1); // metrics before validation
  assert.match(got[got.length - 1].hint, /Waiting/);
  assert.ok(got[got.length - 1].quality < 0.4);
  await l.stop();
});

test('L06 a raw buffer (decoder gave nothing) is ignored safely', async () => {
  const { PR, inst } = mockPR();
  const got = [];
  const l = createLive({ PR, apiKey: 'k' });
  l.onSample((s) => got.push(s));
  await l.start();
  const buf = new Uint8Array(1); buf.decoded = buf;
  inst.emit('metrics', buf, 1);
  assert.equal(got.length, 0);
  await l.stop();
});

test('L07 stale readings drop the quality', async () => {
  const { PR, inst } = mockPR();
  let t = 1000;
  const got = [];
  const l = createLive({ PR, apiKey: 'k', now: () => t });
  l.onSample((s) => got.push(s));
  await l.start();
  inst.emit('validationStatus', 0, 1, '');
  inst.emit('metrics', metricsBuf(14, 70), 1);
  assert.ok(got[got.length - 1].quality >= 0.4);
  t += 7000;
  inst.emit('validationStatus', 0, 2, '');
  assert.ok(got[got.length - 1].quality < 0.4);
  await l.stop();
});

test('L08 SDK errors and the camera stream are passed on; stop tears down', async () => {
  const { PR, inst } = mockPR();
  const st = [], streams = [];
  const l = createLive({ PR, apiKey: 'k' });
  l.onStatus((s) => st.push(s));
  l.onStream((s) => streams.push(s));
  await l.start();
  inst.emit('error', 7, 'input unavailable', true);
  inst.emit('streamAvailable', { fake: 'stream' });
  assert.equal(st[0].error, 'input unavailable');
  assert.equal(streams.length, 1);
  await l.stop();
  assert.equal(inst.stopped, true);
  assert.equal(inst.destroyed, true);
});

test('S01 speaker tries the next program when one is missing, and sends text on stdin', async () => {
  const calls = [];
  const spawnImpl = (cmd, args) => {
    calls.push(cmd);
    const c = new EventEmitter();
    c.stdin = new EventEmitter(); c.stdin.end = (t) => { c.said = t; };
    c.kill = () => {};
    if (cmd === 'espeak-ng') setImmediate(() => c.emit('error', new Error('ENOENT')));
    else setImmediate(() => c.emit('close', 0));
    return c;
  };
  const sp = createSpeaker(spawnImpl);
  const ok = await sp.speak('Hello there');
  assert.equal(ok, true);
  assert.deepEqual(calls, ['espeak-ng', 'espeak']);
});

test('S02 speaker reports false when no program exists', async () => {
  const spawnImpl = () => {
    const c = new EventEmitter();
    c.stdin = new EventEmitter(); c.stdin.end = () => {}; c.kill = () => {};
    setImmediate(() => c.emit('error', new Error('ENOENT')));
    return c;
  };
  assert.equal(await createSpeaker(spawnImpl).speak('Hi'), false);
});

test('S03 with a Piper voice installed it is tried first and its audio is piped to the player', async () => {
  const procs = [];
  const spawnImpl = (cmd) => {
    const c = new EventEmitter();
    c.stdin = new EventEmitter(); c.stdin.end = (t) => { c.said = t; };
    c.stdout = { pipe: (dest) => { c.pipedTo = dest; } };
    c.kill = () => {}; c.cmd = cmd; procs.push(c);
    if (cmd === 'aplay') setImmediate(() => c.emit('close', 0));
    return c;
  };
  const sp = createSpeaker(spawnImpl, { piperModel: '/voices/amy.onnx' });
  assert.equal(await sp.speak('Hello there'), true);
  assert.deepEqual(procs.map((p) => p.cmd), ['piper', 'aplay']);
  assert.equal(procs[0].said, 'Hello there');
  assert.equal(procs[0].pipedTo, procs[1].stdin);
});

test('S04 the espeak fallback asks for a female English voice', () => {
  const { enginesFor } = require('../speak.cjs');
  const e = enginesFor({}).find((x) => x.pipe[0].cmd === 'espeak-ng');
  assert.ok(e.pipe[0].args.includes('en-us+f3'));
});

test('L09 face, blink, talking and HRV signals are read from the metrics', async () => {
  const { PR, inst } = mockPR();
  const got = [];
  const l = createLive({ PR: Object.assign(PR, { faceMetrics: [14] }), apiKey: 'k' });
  l.onSample((s) => got.push(s));
  await l.start();
  const x = new Uint8Array(1);
  x.decoded = {
    breathing: { rate: [{ value: 14 }] }, cardio: { pulseRate: [{ value: 70 }], hrv: [{ rmssd: 41, stable: true, confidence: 80 }] },
    face: { expression: [{ stable: true, scores: [{ type: 7, confidence: 20 }, { type: 1, confidence: 71 }] }], blinking: [{ detected: true }], talking: [{ detected: false }] },
  };
  inst.emit('validationStatus', 0, 1, '');
  inst.emit('metrics', x, 1);
  const s = got[got.length - 1];
  assert.deepEqual(s.expression, { type: 'angry', conf: 71, stable: true });
  assert.equal(s.blinking, true);
  assert.equal(s.talking, false);
  assert.equal(s.hrv.rmssd, 41);
  assert.ok(inst.opts.requestedMetrics.includes(14));
  await l.stop();
});

test('L10 a chosen camera is opened by us and handed to the SDK; stop releases it', async () => {
  const { PR, inst } = mockPR();
  let used = null, stopped = 0;
  inst.useMediaStream = (st) => { used = st; };
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const seen = [];
  const l = createLive({ PR, apiKey: 'k', getStream: async (id) => { seen.push(id); return stream; } });
  const streams = [];
  l.onStream((s) => streams.push(s));
  await l.start('cam-123');
  assert.deepEqual(seen, ['cam-123']);
  assert.equal(used, stream);
  assert.equal(streams[0], stream);
  await l.stop();
  assert.equal(stopped, 1);
});

test('L11 brighten asks for more exposure when the camera allows it, and says so when not', async () => {
  const live = require('../renderer/live.js');
  let applied = null;
  const cam = { getVideoTracks: () => [{ getCapabilities: () => ({ exposureMode: ['manual', 'continuous'], exposureCompensation: { max: 2 } }), applyConstraints: async (c) => { applied = c; } }] };
  assert.match(await live.brighten(cam), /more exposure/);
  assert.strictEqual(applied.advanced[0].exposureCompensation, 1.6);
  const none = { getVideoTracks: () => [{ getCapabilities: () => ({}), applyConstraints: async () => {} }] };
  assert.match(await live.brighten(none), /does not allow/);
  const refuse = { getVideoTracks: () => [{ getCapabilities: () => ({ exposureCompensation: { max: 1 } }), applyConstraints: async () => { throw new Error('no'); } }] };
  assert.match(await live.brighten(refuse), /refused/);
});

test('L12 after a terminal SDK error the engine is reset and started again on the same camera', async () => {
  const { PR, inst } = mockPR();
  let used = 0, resets = 0, starts = 0;
  inst.useMediaStream = () => { used++; };
  inst.reset = async () => { resets++; };
  const origStart = inst.start; inst.start = async () => { starts++; return origStart(); };
  const stream = { getTracks: () => [{ stop() {} }], getVideoTracks: () => [{ readyState: 'live' }] };
  const l = createLive({ PR, apiKey: 'k', recoverDelayMs: 5, getStream: async () => stream });
  const st = [];
  l.onStatus((s) => st.push(s));
  await l.start('cam');
  inst.emit('error', 11, 'SmartSpectra is not in a valid state', false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(resets, 1); assert.equal(starts, 2); assert.equal(used, 2);
  assert.ok(st.some((s) => s.recovered));
  assert.equal(l.lastError().code, 11);
  await l.stop();
});

test('L13 a rejected key does not loop restarts, and recovery stops after stop()', async () => {
  const { PR, inst } = mockPR();
  let resets = 0; inst.reset = async () => { resets++; };
  const l = createLive({ PR, apiKey: 'k', recoverDelayMs: 5 });
  await l.start();
  inst.emit('error', 2, 'key rejected', false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(resets, 0);
  inst.emit('error', 5, 'network', true);
  await l.stop();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(resets, 0);
});

test('L14 a restart waits out the patience window after the last start, so start-up work is not repeated in a tight loop', async () => {
  const { PR, inst } = mockPR();
  let starts = 0;
  inst.reset = async () => {};
  const origStart = inst.start; inst.start = async () => { starts++; return origStart(); };
  const l = createLive({ PR, apiKey: 'k', recoverDelayMs: 1, patientMs: 150 });
  await l.start();
  const t0 = Date.now();
  inst.emit('error', 8, 'processing failed', true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(starts, 1, 'must not restart inside the patience window');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(starts, 2);
  assert.ok(Date.now() - t0 >= 140);
  await l.stop();
});
