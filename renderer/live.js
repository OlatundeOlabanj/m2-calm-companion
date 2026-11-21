/* Live camera source, using the Presage SmartSpectra SDK in the window (the method Presage documents for Electron).
   The browser engine opens the camera, so it works with cameras the native reader cannot use.
   PR is the bundled SDK ({ SmartSpectraSDK, breathingMetrics, cardioMetrics, decodeMetrics }); it is injectable so this can be tested with a mock. */
(function (root) {
  const HINTS = {
    1: 'No face found', 2: 'More than one face', 3: 'Centre your face', 4: 'Face size out of range',
    5: 'Too dark', 6: 'Too bright', 7: 'Chest not visible', 10: 'Camera adjusting',
    11: 'Frame rate too low', 12: 'Too much motion', 13: 'Too close', 14: 'Too far',
    15: 'Face too high', 16: 'Face too low', 17: 'Face the camera',
  };

  const EXPR = { 1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear', 5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise' };
  const exprName = (t) => (typeof t === 'number' ? EXPR[t] : String(t || '').toLowerCase()) || '';

  function createLive({ PR, apiKey, now, getStream, recoverDelayMs, patientMs, lite }) {
    const clock = now || (() => Date.now());
    const sampleL = [], statusL = [], streamL = [];
    let sdk = null;
    let timer = null;
    let last = { breathing: NaN, pulse: NaN, validation: null, metricsAt: 0, expression: null, blinking: false, talking: false, hrv: null };
    let ownStream = null;
    let lastErr = null, recoveries = [], recovering = false, wantRunning = false, lastStartAt = 0;
    // Presage's main-process start() runs the key check and model fetch on the app's main thread, so every restart can freeze the window
    // and starve the camera frames, which then makes the engine fail again. After any start the engine is left alone (60 s unless a test overrides it).
    const patientFor = patientMs != null ? patientMs : (recoverDelayMs == null ? 60000 : 0);
    const ERR_NAMES = { 1: 'invalid state', 2: 'key rejected', 3: 'configuration failed', 4: 'credits used up', 5: 'network error', 6: 'server error', 7: 'camera unavailable', 8: 'processing failed', 9: 'frame conversion failed', 10: 'timestamps out of order', 11: 'gap in the camera frames' };

    // The reading engine can stop for good after a hiccup (for example a gap in camera frames). Rebuild it and carry on.
    async function recover() {
      if (recovering || !wantRunning || !sdk) return;
      const t = clock();
      recoveries = recoveries.filter((x) => t - x < 600000);
      if (recoveries.length >= 4) { status({ recovering: false, gaveUp: true }); return; }
      recoveries.push(t);
      recovering = true;
      status({ recovering: true });
      try {
        const s = sdk;
        const backoff = Math.min(30000, (recoverDelayMs == null ? 1200 : recoverDelayMs) * Math.pow(2, Math.max(0, recoveries.length - 1)));
        const patience = Math.max(0, patientFor - (clock() - lastStartAt));
        await new Promise((r) => setTimeout(r, Math.max(backoff, patience)));
        if (!wantRunning || sdk !== s) return;
        try { await s.stop(); } catch (e) { /* already stopped */ }
        try { await s.reset(); } catch (e) { /* not in an error state */ }
        if (ownStream && ownStream.getVideoTracks().every((x) => x.readyState === 'ended')) return; // camera gone
        if (ownStream) s.useMediaStream(ownStream);
        last = { breathing: NaN, pulse: NaN, validation: null, metricsAt: 0, expression: null, blinking: false, talking: false, hrv: null };
        lastStartAt = clock();
        await s.start();
        status({ recovering: false, recovered: true });
      } catch (e) {
        status({ recovering: false, error: String((e && e.message) || e), code: e && e.code });
        setTimeout(() => { recovering = false; recover(); }, 3000);
        return;
      } finally { recovering = false; }
    }

    function emit() {
      const stale = clock() - last.metricsAt > 6000;
      const ok = last.validation === 0 && !stale && Number.isFinite(last.breathing) && Number.isFinite(last.pulse);
      let hint = '';
      if (last.validation === null) hint = 'Waiting for the camera';
      else if (last.validation === 0) hint = stale ? 'Waiting for readings' : '';
      else hint = HINTS[last.validation] || 'Adjust your position';
      const s = { breathing: last.breathing, pulse: last.pulse, quality: ok ? 0.9 : 0.1, hint, expression: last.expression, blinking: last.blinking, talking: last.talking, hrv: last.hrv };
      sampleL.forEach((f) => f(s));
    }
    const status = (o) => statusL.forEach((f) => f(o));

    function build() {
      sdk = new PR.SmartSpectraSDK({
        apiKey,
        requestedMetrics: [...PR.breathingMetrics, ...PR.cardioMetrics, ...(PR.faceMetrics || [])],
        enableAccumulatedOutput: false,
        enableTelemetry: false, // opt out of aggregate SDK telemetry
      });
      sdk.on('metrics', (buf) => {
        let m;
        try { m = PR.decodeMetrics(buf); } catch (e) { return; }
        if (!m || typeof m !== 'object' || m instanceof Uint8Array) return;
        const b = m.breathing && m.breathing.rate && m.breathing.rate.length ? m.breathing.rate[m.breathing.rate.length - 1] : null;
        const p = m.cardio && m.cardio.pulseRate && m.cardio.pulseRate.length ? m.cardio.pulseRate[m.cardio.pulseRate.length - 1] : null;
        const f = m.face || {};
        const ex = f.expression && f.expression.length ? f.expression[f.expression.length - 1] : null;
        if (ex && ex.scores && ex.scores.length) {
          const top = ex.scores.reduce((a, c) => (c.confidence > a.confidence ? c : a));
          last.expression = { type: exprName(top.type), conf: top.confidence, stable: !!ex.stable };
        }
        const bl = f.blinking && f.blinking.length ? f.blinking[f.blinking.length - 1] : null;
        if (bl) last.blinking = !!bl.detected;
        const tk = f.talking && f.talking.length ? f.talking[f.talking.length - 1] : null;
        if (tk) last.talking = !!tk.detected;
        const hv = m.cardio && m.cardio.hrv && m.cardio.hrv.length ? m.cardio.hrv[m.cardio.hrv.length - 1] : null;
        if (hv && Number.isFinite(hv.rmssd)) last.hrv = { rmssd: hv.rmssd, stable: !!hv.stable, confidence: hv.confidence };
        if (b && Number.isFinite(b.value)) last.breathing = b.value;
        if (p && Number.isFinite(p.value)) last.pulse = p.value;
        last.metricsAt = clock();
        emit();
      });
      sdk.on('validationStatus', (code) => { last.validation = code; emit(); });
      sdk.on('processingStatus', (s) => { status({ processing: s }); if (s === 5 && wantRunning) recover(); });
      sdk.on('error', (code, message, retryable) => {
        lastErr = { code, message: message || 'SDK error', name: ERR_NAMES[code] || '', at: clock() };
        status({ error: message || 'SDK error', code, retryable, name: ERR_NAMES[code] || '' });
        if (code !== 2 && code !== 4 && wantRunning) recover(); // a rejected key or used-up credits will not fix themselves
      });
      sdk.on('streamAvailable', (stream) => streamL.forEach((f) => f(stream)));
    }

    return {
      onSample: (f) => { sampleL.push(f); },
      onStatus: (f) => { statusL.push(f); },
      onStream: (f) => { streamL.push(f); },
      // deviceId (optional) chooses the camera. We open it ourselves and hand it to the SDK.
      async start(deviceId) {
        if (!apiKey) throw new Error('No Presage API key found. Put PRESAGE_API_KEY in the .env file.');
        if (!sdk) build();
        last = { breathing: NaN, pulse: NaN, validation: null, metricsAt: 0, expression: null, blinking: false, talking: false, hrv: null };
        if (deviceId) {
          const open = getStream || ((id) => navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: id }, width: { ideal: lite ? 640 : 1280 }, height: { ideal: lite ? 480 : 720 }, frameRate: { ideal: 30 } } }));
          ownStream = await open(deviceId);
          sdk.useMediaStream(ownStream);
          streamL.forEach((f) => f(ownStream));
        }
        wantRunning = true; lastErr = null; recoveries = [];
        lastStartAt = clock();
        await sdk.start();
        clearInterval(timer);
        timer = setInterval(emit, 1000); // heartbeat so a stalled stream is noticed
      },
      lastError: () => lastErr,
      async stop() {
        wantRunning = false;
        clearInterval(timer);
        const s = sdk;
        sdk = null;
        if (ownStream) { try { ownStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* gone */ } ownStream = null; }
        if (!s) return;
        try { await s.stop(); } catch (e) { /* already stopped */ }
        try { s.destroy(); } catch (e) { /* already destroyed */ }
      },
    };
  }

  // Best effort for a dark room: ask the camera for more exposure. Many cameras ignore this, so it
  // reports what it actually managed and the person is also offered a screen lamp.
  async function brighten(stream) {
    const tr = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!tr || !tr.getCapabilities || !tr.applyConstraints) return 'This camera does not allow brightness changes from here.';
    const caps = tr.getCapabilities() || {};
    const adv = {};
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    if (caps.exposureCompensation && Number.isFinite(caps.exposureCompensation.max)) adv.exposureCompensation = caps.exposureCompensation.max * 0.8;
    if (!Object.keys(adv).length) return 'This camera does not allow brightness changes from here.';
    try { await tr.applyConstraints({ advanced: [adv] }); return 'Asked the camera for more exposure.'; }
    catch (e) { return 'The camera refused a brightness change.'; }
  }

  const api = { createLive, HINTS, exprName, brighten };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
