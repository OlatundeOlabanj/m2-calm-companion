'use strict';
/* Reads a recorded video clip with the Presage SmartSpectra Node SDK (file input).
   This runs in its own small process, away from the window, so a slow computer keeps its screen and memory free.
   The SDK measures the frame rate from the clip's own timestamps, so a clip can be read slower than real time
   without the "frame rate too low" failure that a live camera gets. The SDK is injected so this can be tested with a mock. */

const EXPR = { 1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear', 5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise' };
const exprName = (t) => (typeof t === 'number' ? EXPR[t] : String(t || '').toLowerCase()) || '';
const lastOf = (a) => (a && a.length ? a[a.length - 1] : null);

function median(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// One decoded metrics message -> one flat reading (or null if it carries nothing usable).
function extract(m) {
  if (!m || typeof m !== 'object' || m instanceof Uint8Array) return null;
  const b = lastOf(m.breathing && m.breathing.rate);
  const p = lastOf(m.cardio && m.cardio.pulseRate);
  const f = m.face || {};
  const out = { breathing: NaN, pulse: NaN, hrv: null, expression: null, blinking: null, talking: null };
  if (b && Number.isFinite(b.value)) out.breathing = b.value;
  if (p && Number.isFinite(p.value)) out.pulse = p.value;
  const hv = lastOf(m.cardio && m.cardio.hrv);
  if (hv && Number.isFinite(hv.rmssd)) out.hrv = { rmssd: hv.rmssd, stable: !!hv.stable, confidence: hv.confidence };
  const ex = lastOf(f.expression);
  if (ex && ex.scores && ex.scores.length) {
    const top = ex.scores.reduce((a, c) => (c.confidence > a.confidence ? c : a));
    out.expression = { type: exprName(top.type), conf: top.confidence, stable: !!ex.stable };
  }
  const bl = lastOf(f.blinking); if (bl) out.blinking = !!bl.detected;
  const tk = lastOf(f.talking); if (tk) out.talking = !!tk.detected;
  const any = Number.isFinite(out.breathing) || Number.isFinite(out.pulse) || out.hrv || out.expression;
  return any ? out : null;
}

// Reads the whole clip. Resolves with every reading and a count of the camera checks the SDK reported.
// lib = { SmartSpectraSDK, breathingMetrics, cardioMetrics, faceMetrics, decodeMetrics, ProcessingStatus }
function readClip(lib, o) {
  const PS = lib.ProcessingStatus || { kIdle: 1, kStarting: 2, kRunning: 3, kError: 5 };
  const emit = o.onEvent || (() => {});
  const samples = [];
  const validation = {};
  let hint = '', active = false, finished = false, timer = null;
  const sdk = new lib.SmartSpectraSDK({
    apiKey: o.apiKey,
    requestedMetrics: [...lib.breathingMetrics, ...lib.cardioMetrics, ...(lib.faceMetrics || [])],
    enableAccumulatedOutput: false,
    enableTelemetry: false, // aggregate SDK telemetry stays off
  });
  return new Promise((resolve, reject) => {
    const finish = async (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { await sdk.stopAsync(); } catch (e) { /* already stopped */ }
      try { await sdk.destroy(); } catch (e) { /* already destroyed */ }
      if (err) reject(err); else resolve({ samples, validation, hint });
    };
    sdk.on('metrics', (buf, ts) => {
      let m;
      try { m = lib.decodeMetrics(buf); } catch (e) { return; }
      const s = extract(m);
      if (!s) return;
      s.t = Number.isFinite(ts) ? ts / 1e6 : samples.length;
      samples.push(s);
      emit({ type: 'sample', t: s.t, count: samples.length });
    });
    sdk.on('validationStatus', (code, ts, h) => {
      validation[code] = (validation[code] || 0) + 1;
      if (h) hint = h;
    });
    sdk.on('processingStatus', (st) => {
      emit({ type: 'status', status: st });
      if (st === PS.kStarting || st === PS.kRunning) active = true;
      else if (st === PS.kIdle && active) finish(); // end of the file
    });
    sdk.on('error', (code, message) => {
      const e = new Error(message || 'SmartSpectra error');
      e.code = code;
      finish(e);
    });
    if (o.timeoutMs !== 0) { timer = setTimeout(() => finish(Object.assign(new Error('Reading the clip took too long.'), { code: 'timeout' })), o.timeoutMs || 15 * 60 * 1000); }
    try {
      sdk.useFile(o.file, { interframeDelayMs: o.delayMs == null ? 8 : o.delayMs });
      sdk.start();
    } catch (e) { finish(e); }
  });
}

// Turns the readings into the few numbers M² uses. Readings settle after a warm-up, so the "current" values come from the second half.
// The SDK may send breathing and pulse in separate messages, so the latest value of each is carried forward and a point counts once both are known.
function summarize(samples, validationNames) {
  const merged = [];
  let lastB = NaN, lastP = NaN, breathingCount = 0, pulseCount = 0, hrvCount = 0, exprCount = 0;
  for (const s of samples) {
    let changed = false;
    if (Number.isFinite(s.breathing)) { lastB = s.breathing; breathingCount++; changed = true; }
    if (Number.isFinite(s.pulse)) { lastP = s.pulse; pulseCount++; changed = true; }
    if (s.hrv) hrvCount++;
    if (s.expression) exprCount++;
    if (changed && Number.isFinite(lastB) && Number.isFinite(lastP)) merged.push({ t: s.t || 0, breathing: lastB, pulse: lastP });
  }
  const good = merged;
  const tail = good.slice(Math.floor(good.length / 2));
  const lastWith = (key) => { for (let i = samples.length - 1; i >= 0; i--) if (samples[i][key] != null) return samples[i][key]; return null; };
  const warm = good.slice(Math.floor(good.length / 4)); // skip the first quarter: the engine is still settling
  const series = (warm.length >= 10 ? warm : good).map((s) => ({ breathing: s.breathing, pulse: s.pulse }));
  const stableExpr = [...samples].reverse().find((s) => s.expression && s.expression.stable);
  return {
    count: samples.length,
    good: good.length,
    breathingCount, pulseCount, hrvCount, exprCount,
    seconds: samples.length ? Math.max(...samples.map((s) => s.t || 0)) : 0,
    breathing: median(tail.map((s) => s.breathing)),
    pulse: median(tail.map((s) => s.pulse)),
    hrv: lastWith('hrv'),
    expression: stableExpr ? stableExpr.expression : lastWith('expression'),
    blinking: lastWith('blinking'),
    talking: lastWith('talking'),
    series: series.slice(-600),
  };
}

module.exports = { readClip, summarize, extract, median, exprName };
