(function () {
  const CH = window.CH;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const SPEED = Math.max(1, Number(params.get('speed')) || 1); // test only: runs signal time faster
  const CLIP_SECONDS = Number(params.get('clipsec')) || (CH.clip ? CH.clip.CLIP_SECONDS : 60); // the URL option is for automated tests only
  const LEARN_SAMPLES = 25; // good readings needed before M² knows your calm
  const GROQ_VOICE_URL = 'console.groq.com/playground?model=canopylabs%2Forpheus-v1-english';

  const env = window.presageEnv || { available: false, reason: '' };
  const hasSdk = !!(env.available && window.PresageRenderer);
  const presage = hasSdk ? CH.createLive({ PR: window.PresageRenderer, apiKey: env.apiKey }) : null;
  const live = !!presage;
  // There is no demo or simulated mode in the app. Only the automated tests set this flag, to run without a camera.
  const testRun = window.__M2_TEST_SOURCE__ === true;
  let source = live ? new CH.SdkSource(presage) : (testRun ? new CH.SimulatedSource() : null);
  // Clip mode (for slower computers): a recorded clip is read by Presage in a separate process and the reading is held, instead of a live camera.
  const clipBridge = window.m2clip || null;
  const clipSrc = new CH.clip.ClipSource();
  let camErr = '', camRecov = '';
  let camStream = null, camProc = '', camBright = null, camFrames = 0, camFps = null, camLowFor = 0, camId = '', camBlackFor = 0, camDarkFor = 0;
  let allCams = [];
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  if (presage) {
    presage.onStream((st) => { camStream = st; const v = $('preview'); v.srcObject = st; v.hidden = false; v.play().catch(() => {}); });
    presage.onStatus((s) => {
      if (s.error) camErr = (s.name ? s.name + ': ' : '') + s.error + (s.code != null ? ' (code ' + s.code + ')' : '');
      if (s.recovering != null) camRecov = s.recovering ? 'restarting the reading engine...' : (s.gaveUp ? 'engine kept stopping, gave up' : (s.recovered ? 'restarted, working again' : ''));
      if (s.processing != null) { const PS = window.PresageRenderer.ProcessingStatus || {}; const n = Object.keys(PS).find((k) => PS[k] === s.processing); camProc = n ? n.replace(/^k/, '') : String(s.processing); }
    });
  }

  // ---------- cameras. M² uses the DroidCam phone camera by default. Another camera is used only if you ask for it.
  const isPhoneCam = (label) => /droid\s*cam|iriun|epoccam|dummy video|v4l2loopback/i.test(label || '');
  async function listCameras() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return [];
    try { const t = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); t.getTracks().forEach((x) => x.stop()); } catch (e) { /* labels may stay blank */ }
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }
  const modeIsClip = () => !!($('modeClip') && $('modeClip').checked);
  function canStart() { return $('consentBox').checked && (live ? (modeIsClip() || !!camId) : testRun); }
  function fillCameras(cams) {
    allCams = cams;
    const pinned = store.get('m2.camPin');
    const phone = cams.find((c) => isPhoneCam(c.label));
    const chosen = cams.find((c) => c.deviceId === pinned) || phone || (S.useAny ? (cams.find((c) => !isPhoneCam(c.label)) || cams[0]) : null);
    [$('camSel'), $('camSel2')].forEach((sel) => {
      sel.textContent = '';
      cams.forEach((c, n) => { const o = document.createElement('option'); o.value = c.deviceId; o.textContent = (c.label || 'Camera ' + (n + 1)) + (isPhoneCam(c.label) ? ' (phone)' : ''); sel.appendChild(o); });
      if (chosen) sel.value = chosen.deviceId;
    });
    camId = chosen ? chosen.deviceId : '';
    if (chosen && isPhoneCam(chosen.label)) $('camNote').textContent = 'Phone camera found: ' + chosen.label + '. M² will use it.';
    else if (chosen) $('camNote').textContent = 'Using ' + (chosen.label || 'this camera') + '. A phone camera usually reads breathing better.';
    else $('camNote').textContent = 'The DroidCam phone camera was not found. Open DroidCam on your phone, connect it to this computer, then press Look again.';
    $('camAny').hidden = !!chosen || !cams.length;
    $('startBtn').disabled = !canStart();
    return chosen;
  }

  // Camera check: tells apart "no camera", "camera gives black frames" and "SDK waiting". Shown in Details.
  function cameraReport() {
    if (S.mode === 'clip') return 'Clip mode: the camera opens only while you record.\n' + (clipSrc.has ? 'A reading is held (' + Math.round((Date.now() - clipSrc.at) / 1000) + ' s old).' : 'No reading yet. Tap Read me.') + (S.recFps ? '\nLast recording: about ' + Math.round(S.recFps) + ' pictures per second.' : '') + (S.lastClipError ? '\nLast clip problem: ' + S.lastClipError : '');
    if (!presage) return 'Camera: not available.';
    const lines = [];
    const tr = camStream && camStream.getVideoTracks()[0];
    if (!tr) lines.push('Camera: not opened yet');
    else {
      const st = tr.getSettings ? tr.getSettings() : {};
      lines.push('Camera: ' + (tr.label || 'unnamed') + '  ' + (st.width || '?') + 'x' + (st.height || '?') + ' @' + Math.round(st.frameRate || 0) + 'fps');
      lines.push('Track: ' + tr.readyState + (tr.muted ? ', MUTED (no frames from the device)' : ', delivering') + '   Frames shown: ' + camFrames);
      lines.push('Real frame rate: ' + (camFps == null ? '?' : camFps.toFixed(1) + ' fps') + (camFps != null && camFps < 20 ? '  (TOO LOW: the engine needs about 25)' : ''));
      lines.push('Picture brightness: ' + (camBright == null ? '?' : camBright.toFixed(0) + '/255' + (camBright < 8 ? '  (BLACK picture)' : camBright < 40 ? '  (dark)' : '')));
      if (S.boostNote) lines.push('Brightness: ' + S.boostNote);
    }
    if (camErr) lines.push('Last SDK error: ' + camErr + (camRecov ? ' | ' + camRecov : ''));
    lines.push('SDK: ' + (camProc || 'not started') + '   Reading: ' + (S.last && S.last.hint ? S.last.hint : (S.last && S.last.quality >= 0.4 ? 'ok' : '-')));
    return lines.join('\n');
  }
  function voiceReport() {
    const lines = ['Voice: ' + (voice.cloud ? 'natural (Groq)' : 'this computer (plain)')];
    if (S.voiceNote) lines.push(S.voiceNote);
    if (/terms/i.test(S.voiceWhy || '')) lines.push('To fix: open ' + GROQ_VOICE_URL + ' in your browser, sign in with the account that owns your Groq key, accept the terms, then press Test natural voice.');
    return lines.join('\n');
  }
  if (presage) {
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 12;
    const v = $('preview');
    if (v.requestVideoFrameCallback) { const tick = () => { camFrames++; v.requestVideoFrameCallback(tick); }; v.requestVideoFrameCallback(tick); }
    let lastFrames = 0, lastT = performance.now();
    setInterval(() => {
      const nowT = performance.now();
      if (camStream && nowT - lastT > 500) { camFps = (camFrames - lastFrames) / ((nowT - lastT) / 1000); }
      lastFrames = camFrames; lastT = nowT;
      camLowFor = camFps != null && camStream && camFps < 20 ? camLowFor + 1.5 : 0;
      try {
        if (v.readyState >= 2) { const cx = cv.getContext('2d'); cx.drawImage(v, 0, 0, 16, 12); const d = cx.getImageData(0, 0, 16, 12).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3; camBright = sum / (d.length / 4); }
      } catch (e) { /* ignore */ }
      camBlackFor = camBright != null && camBright < 8 ? camBlackFor + 1.5 : 0;
      camDarkFor = camBright != null && camBright >= 8 && camBright < 40 ? camDarkFor + 1.5 : 0;
      if (camDarkFor > 6 && !S.boostTried && camStream && CH.brighten) { S.boostTried = true; CH.brighten(camStream).then((m) => { S.boostNote = m; }); }
      if (!$('details').hidden) $('camInfoD').textContent = cameraReport();
    }, 1500);
  }
  const aiPossible = !!(window.m2 && window.m2.ai);
  const orb = new CH.Orb($('orb'));
  orb.start();
  const voice = new CH.Voice();
  voice.onCloudSpoken = () => { S.count.tts++; renderCounts(); };
  voice.onCloudError = (why) => {
    S.voiceWhy = why;
    S.voiceNote = /terms/i.test(why) ? 'Natural voice needs one click: accept Groq\'s voice terms (steps are in Details). Using the plain voice for now.' : 'Natural voice unavailable (' + why + '). Using the plain voice.';
    if (!S.recording && !S.busy) $('capsub').textContent = /terms/i.test(why) ? 'My natural voice needs one click from you. See Details.' : $('capsub').textContent;
    if (!$('details').hidden) $('voiceInfo').textContent = voiceReport();
  };

  const S = {
    phase: 'consent', base: null, learn: [], calmPool: [], steps: 0, badFor: 0,
    smoother: new CH.Smoother(0.3), gate: new CH.Gate(), useAny: false, voiceNote: '', voiceWhy: '',
    tension: 0, shown: 0, last: { breathing: NaN, pulse: NaN, quality: 1, hint: '' }, nudge: 0,
    pacer: false, pacerStart: 0, pacerEnd: 0, acc: 0,
    aiOn: false, history: [], count: { voice: 0, chat: 0, tts: 0 },
    busy: false, recording: false, speaking: false, talking: false, sayToken: 0,
    risingSaid: false, noSigSince: 0, noSigSaid: false, lastAuto: 0, lines: 0,
    mode: 'live', heavy: false, clipRead: false, readTotal: 0,
  };
  window.__ch = { S, source, orb, voice, clipSrc }; // read by the browser smoke test

  // ---------- M² speaks: words appear one by one, voice follows
  function setCaption(text, sub) {
    const c = $('caption');
    c.textContent = '';
    String(text).split(' ').forEach((w, i) => {
      const s = document.createElement('span');
      s.textContent = w;
      s.style.animationDelay = i * 45 + 'ms';
      c.appendChild(s);
      c.appendChild(document.createTextNode(' '));
    });
    $('capsub').textContent = sub || '';
  }
  async function say(text, sub, opts) {
    const o = Object.assign({ speak: true }, opts);
    const token = ++S.sayToken;
    setCaption(text, sub);
    S.history.push({ role: 'assistant', content: text });
    if (S.history.length > 12) S.history.shift();
    if (!o.speak || voice.muted) return;
    voice.stopSpeaking();
    S.speaking = true;
    await voice.speak(text + (sub ? ' ' + sub : ''));
    if (token === S.sayToken) S.speaking = false;
  }
  // M² never talks over a live conversation. Its own remarks wait until it is quiet.
  function auto(l, force) {
    if (S.recording || S.busy || S.speaking || S.heavy) return;
    const now = performance.now();
    if (!force && now - S.lastAuto < 8000) return;
    S.lastAuto = now;
    say(l.text, l.sub);
  }
  const ctxNow = () => ({ base: S.base, last: S.last, tension: S.tension, gate: S.gate.state });
  function aiCtx() {
    const reading = S.last.quality >= 0.4 && Number.isFinite(S.last.breathing);
    return {
      reading, breathing: reading ? S.last.breathing : NaN,
      baseBreathing: S.base ? S.base.breathing : NaN, tension: reading && S.base ? S.tension : NaN,
      expr: reading && S.last.expression && S.last.expression.stable ? S.last.expression : null,
    };
  }

  // ---------- consent and start (no waiting screen: M² learns your calm while you use it)
  $('srcChip').textContent = live ? 'LIVE CAMERA' : (testRun ? 'TEST RUN' : 'NO CAMERA');
  $('srcChip').className = 'chip ' + (live ? 'ok' : 'warn');
  $('srcNote').textContent = live ? 'Source: camera through the Presage SmartSpectra SDK.'
    : (testRun ? 'Automated test run.' : 'The live camera is not available, so M² cannot start. ' + (env.reason || (env.available ? 'The camera module did not load.' : 'Run it in the desktop app with PRESAGE_API_KEY set in .env.')));
  if (!aiPossible) {
    $('aiBox').disabled = true;
    $('aiRow').title = 'No GROQ_API_KEY found in .env';
    $('aiRow').querySelector('em').textContent = '(unavailable: no Groq key set)';
  }
  if (live && clipBridge && clipBridge.available) {
    // The choice is made here, before anything starts. Slower computers (few cores or little memory) are offered Clip first.
    $('modeRow').hidden = false;
    $('modeClip').checked = !!clipBridge.suggest && !testRun;
    $('modeLive').checked = !$('modeClip').checked;
    const syncMode = () => { $('clipPrivacy').hidden = !modeIsClip(); $('startBtn').disabled = !canStart(); };
    $('modeLive').addEventListener('change', syncMode);
    $('modeClip').addEventListener('change', syncMode);
    syncMode();
  }
  async function refreshCameras() {
    $('camRow').hidden = false;
    $('camNote').textContent = 'Looking for cameras...';
    try { fillCameras(await listCameras()); } catch (err) { $('camNote').textContent = 'Could not list cameras: ' + err.message; }
  }
  $('consentBox').addEventListener('change', async (e) => {
    if (e.target.checked && live && $('camRow').hidden) await refreshCameras();
    $('startBtn').disabled = !canStart();
  });
  $('camRefresh').addEventListener('click', refreshCameras);
  $('camAny').addEventListener('click', () => { S.useAny = true; fillCameras(allCams); });
  const pickFrom = (sel) => { camId = sel.value; store.set('m2.camPin', camId); $('camSel').value = camId; $('camSel2').value = camId; $('startBtn').disabled = !canStart(); };
  $('camSel').addEventListener('change', () => pickFrom($('camSel')));
  $('camSel2').addEventListener('change', () => pickFrom($('camSel2')));
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    // The phone camera appears when DroidCam connects. If M² started on another camera, move to it.
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      if (!live || $('camRow').hidden) return;
      const before = camId;
      let cams; try { cams = await listCameras(); } catch (e) { return; }
      const phone = cams.find((c) => isPhoneCam(c.label));
      fillCameras(cams);
      if (S.phase === 'main' && S.mode !== 'clip' && phone && !store.get('m2.camPin') && camId !== before) { try { await openCamera(); } catch (e) { /* the banner explains */ } }
    });
  }

  async function openCamera() {
    camStream = null; camBright = null; camBlackFor = 0; camDarkFor = 0; S.boostTried = false; S.badFor = 0;
    await presage.stop();
    await presage.start(camId || undefined);
  }
  $('startBtn').addEventListener('click', async () => {
    S.aiOn = aiPossible && $('aiBox').checked;
    voice.cloud = S.aiOn && !!(window.m2 && window.m2.tts);
    S.mode = live && modeIsClip() ? 'clip' : 'live';
    if (S.mode === 'clip') source = clipSrc;
    if (live && S.mode === 'live') {
      try { await openCamera(); }
      catch (e) {
        $('srcNote').textContent = 'Camera could not start: ' + e.message + ' Checking the network...';
        try {
          const r = await window.m2.netTest();
          const p = r.find((x) => x.name === 'Presage');
          $('srcNote').textContent = 'Camera could not start: ' + e.message + (p && !p.ok ? ' Presage servers cannot be reached from this network. Try a phone hotspot or another network, then press Meet M² again.' : ' Check the camera above and press Meet M² again.');
        } catch (e2) { $('srcNote').textContent = 'Camera could not start: ' + e.message; }
        return;
      }
    }
    $('consent').hidden = true;
    $('hud').hidden = false;
    $('vAI').textContent = S.aiOn ? 'on' : 'off';
    startMain();
    if (S.mode === 'clip') {
      $('srcChip').textContent = 'CLIP MODE';
      $('learnChip').textContent = 'NO CALM READING YET';
      $('readBtn').hidden = false; $('importBtn').hidden = false;
      $('vVideoSaved').textContent = 'a temporary clip, deleted after reading';
    }
  });
  $('camRetry').addEventListener('click', async () => {
    if (S.mode === 'clip') { $('camInfoD').textContent = 'Clip mode: this camera is opened only while you record, when you press Read me.'; return; }
    $('camInfoD').textContent = 'Opening that camera...';
    try { await openCamera(); } catch (e) { $('camInfoD').textContent = 'That camera could not start: ' + e.message; }
  });

  function startMain() {
    S.phase = 'main';
    $('stage').hidden = false;
    $('learnChip').hidden = false;
    orb.ripple(1.2);
    if (S.mode === 'clip') say('Hello. I am M squared.', 'First I need to read your calm. Tap Read me, and sit still for a minute.');
    else say(CH.phrases.welcome(), '');
  }
  function recalibrate() {
    S.base = null; S.learn = []; S.calmPool = [];
    S.smoother.reset(); S.gate = new CH.Gate(); S.tension = 0;
    $('learnChip').hidden = false;
    if (S.mode === 'clip') { S.clipRead = false; clipSrc.reset(); $('learnChip').textContent = 'NO CALM READING YET'; say('Okay. Tap Read me while you are calm, and I will learn that as your calm.', '', { speak: false }); return; }
    if (!live && testRun) source.setScenario('calm');
    say('Learning your calm again.', 'Just be yourself.', { speak: false });
  }

  // ---------- signal step (one second of signal time)
  function step(dt) {
    const s = source.tick(dt);
    S.last = s;
    S.steps++;
    if (S.mode === 'clip' && !S.clipRead) return; // no clip has been read yet, so there is nothing to judge
    const good = s.quality >= 0.4 && Number.isFinite(s.breathing) && Number.isFinite(s.pulse);
    S.badFor = good ? 0 : S.badFor + dt;
    if (S.phase !== 'main') return;

    if (!S.base) {
      if (S.mode === 'clip') return; // the first clip becomes your calm in one go
      // learning your calm, in the background, while you already use M²
      if (good && !s.talking) S.learn.push({ breathing: s.breathing, pulse: s.pulse });
      const pct = Math.min(100, Math.round((S.learn.length / LEARN_SAMPLES) * 100));
      $('learnChip').textContent = 'LEARNING YOUR CALM ' + pct + '%';
      if (S.learn.length >= LEARN_SAMPLES) {
        const base = CH.makeBaseline(S.learn);
        if (base) { S.base = base; $('learnChip').hidden = true; const r = CH.phrases.ready(); auto(r, true); orb.ripple(1); }
      }
    } else {
      S.nudge = CH.faceNudge(s.expression);
      S.tension = S.smoother.push(Math.min(100, CH.rawTension(s, S.base) + S.nudge));
      // your calm drifts over a session: keep a slow, calm-only history and refresh the baseline from it
      if (S.mode !== 'clip' && good && !s.talking && S.tension < 30 && S.gate.state === 'open') { S.calmPool.push({ breathing: s.breathing, pulse: s.pulse }); if (S.calmPool.length > 120) S.calmPool.shift(); }
      if (S.steps % 30 === 0 && S.calmPool.length >= 60) { const nb = CH.makeBaseline(S.calmPool); if (nb) S.base = nb; }
      const before = S.gate.state;
      S.gate.update(S.tension, dt, s.quality);
      if (before !== S.gate.state) onGateChange();
      commentary(dt);
    }
    helpBanner();
  }

  // ---------- when the camera is not giving a usable picture, say why in one line
  function hintAdvice(h) {
    if (/frame rate/i.test(h)) return 'The camera picture is arriving too slowly. Close heavy programs (like a screen recorder), keep the phone close to the Wi-Fi, or use the USB cable.';
    if (/chest/i.test(h)) return 'I can see you, but not your chest. Sit back so your head, shoulders and chest are all in the picture.';
    if (/dark/i.test(h)) return 'It is too dark. Turn on a light in front of you, or press Light.';
    if (/bright/i.test(h)) return 'The picture is too bright. Turn away from the window or lamp behind you.';
    if (/no face|centre|too high|too low|face the/i.test(h)) return 'I cannot find your face. Face the camera, in the middle of the picture.';
    if (/far/i.test(h)) return 'You are too far from the camera. Sit a little closer.';
    if (/close/i.test(h)) return 'You are too close. Sit back a little.';
    if (/motion/i.test(h)) return 'Try to stay still for a moment.';
    return 'I cannot read you clearly. Face the camera in even light and stay still.';
  }
  function helpBanner() {
    if (!live || S.mode === 'clip') { $('help').hidden = true; return; }
    const dark = camDarkFor > 6 && !document.body.classList.contains('lit');
    const slow = camLowFor > 6;
    const trouble = source.error || S.badFor > 8 || dark || slow;
    if (!trouble) { $('help').hidden = true; return; }
    let msg = hintAdvice(S.last.hint || '');
    if (dark && !/dark/i.test(S.last.hint || '')) msg = hintAdvice('dark');
    if (slow) msg = 'Your camera is giving only ' + Math.round(camFps) + ' pictures per second, and the reading engine needs about 25. This is usually dim light: put a lamp or window in front of your face. A USB cable for DroidCam also helps.';
    if (camBlackFor > 4) msg = 'The picture is black. Open DroidCam on your phone and connect it, or pick another camera in Details.';
    $('helpText').textContent = msg;
    $('help').hidden = false;
  }

  function commentary(dt) {
    if (S.tension > 42 && S.gate.state === 'open' && !S.risingSaid && !S.gate.noSignal) { S.risingSaid = true; auto(CH.phrases.rising(ctxNow())); }
    if (S.tension < 25) S.risingSaid = false;
    if (S.gate.noSignal) {
      S.noSigSince += dt;
      if (S.noSigSince > 12 && !S.noSigSaid) { S.noSigSaid = true; auto(CH.phrases.noSignal(S.last.hint), true); }
    } else { S.noSigSince = 0; S.noSigSaid = false; }
  }

  function onGateChange() {
    const st = S.gate.state;
    if (st === 'locked') { startPacer(); auto(CH.phrases.locked(ctxNow()), true); orb.ripple(1); }
    else if (st === 'review') { auto(CH.phrases.review(ctxNow()), true); }
    else if (st === 'open') { stopPacer(); S.lines++; auto({ text: CH.phrases.opened(S.lines) }, true); }
  }

  // ---------- breathing guide: 4 s in, 6 s out (real time)
  function startPacer(ms) { S.pacer = true; S.pacerStart = performance.now(); S.pacerEnd = ms ? performance.now() + ms : 0; }
  function stopPacer() { S.pacer = false; }
  function pacerPhase(now) {
    const t = ((now - S.pacerStart) / 1000) % 10;
    return t < 4 ? { word: 'in', k: (1 - Math.cos((Math.PI * t) / 4)) / 2 } : { word: 'out', k: 1 - (1 - Math.cos((Math.PI * (t - 4)) / 6)) / 2 };
  }

  // ---------- actions
  function toggleDetails(force) {
    const d = $('details');
    d.hidden = typeof force === 'boolean' ? !force : !d.hidden;
    $('detailsBtn').classList.toggle('on', !d.hidden);
    document.body.classList.toggle('detailsOn', !d.hidden);
    if (!d.hidden) { $('camInfoD').textContent = cameraReport(); $('voiceInfo').textContent = voiceReport(); }
  }
  function setMuted(m) { voice.muted = m; if (m) voice.stopSpeaking(); $('voiceBtn').classList.toggle('on', !m); $('voiceBtn').textContent = m ? 'Voice off' : 'Voice'; }
  function toggleIncoming(force) {
    const b = $('incomingBox');
    b.hidden = typeof force === 'boolean' ? !force : !b.hidden;
    $('msgBtn').textContent = b.hidden ? 'Paste a message' : 'Hide message';
    if (!b.hidden) $('incoming').focus();
  }

  async function askAI(kind, text) {
    if (!S.aiOn) { const n = CH.phrases.noAi(); say(n.text, n.sub, { speak: false }); return; }
    S.busy = true;
    $('capsub').textContent = 'Thinking...';
    try {
      const messages = CH.prompt.buildMessages({ kind, text, incoming: $('incoming').value, ctx: aiCtx(), history: S.history.filter((h) => h.role).slice(-8) });
      const raw = await window.m2.chat(messages);
      S.count.chat++;
      renderCounts();
      const reply = CH.prompt.cleanReply(raw, kind);
      if (text) S.history.push({ role: 'user', content: String(text).slice(0, 600) });
      if (kind === 'compose') {
        $('suggestText').textContent = reply;
        $('suggest').hidden = false;
        S.busy = false;
        await say('Here is a reply you could send.', 'Copy it if you like it. It is your call.');
      } else { S.busy = false; await say(reply, ''); }
    } catch (e) {
      S.busy = false;
      say('My AI link did not answer.', String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''), { speak: false });
    } finally { S.busy = false; }
  }
  function renderCounts() { $('cTTS').textContent = S.count.tts; $('cVoice').textContent = S.count.voice; $('cChat').textContent = S.count.chat; }

  function run(cmd, raw) {
    if (!cmd) { if (raw) askAI('chat', raw); return; }
    switch (cmd.type) {
      case 'calm': startPacer(60000); say('Breathe with me.', 'In for four. Out for six.'); break;
      case 'recalibrate': recalibrate(); break;
      case 'compose': if (!$('incoming').value.trim()) toggleIncoming(true); askAI('compose', raw && raw.length < 300 ? raw : ''); break;
      case 'stoplisten': stopTalking(); say('Okay. I am here whenever you want me.', '', { speak: true }); break;
      case 'details': toggleDetails(true); break;
      case 'mute': setMuted(true); break;
      case 'unmute': setMuted(false); break;
    }
  }
  const handleText = (t) => run(CH.parseCommand(t), t);

  // ---------- wiring
  $('calmBtn').addEventListener('click', () => run({ type: 'calm' }));
  $('msgBtn').addEventListener('click', () => toggleIncoming());
  $('helpBtn').addEventListener('click', () => toggleDetails(true));
  $('copySuggest').addEventListener('click', async () => {
    const t = $('suggestText').textContent;
    try { await navigator.clipboard.writeText(t); } catch (e) { /* clipboard blocked */ }
    $('suggest').hidden = true; setCaption('Copied.', 'Paste it where you want to send it.'); orb.ripple(0.8);
  });
  $('closeSuggest').addEventListener('click', () => { $('suggest').hidden = true; });
  $('netBtn').addEventListener('click', async () => {
    const out = $('netInfo');
    if (!(window.m2 && window.m2.netTest)) { out.textContent = 'Network check is only available in the desktop app.'; return; }
    out.textContent = 'Checking...';
    try {
      const r = await window.m2.netTest();
      out.textContent = r.map((x) => x.name + ': ' + (x.ok ? 'reachable' : 'NOT reachable') + '\n  lookup ' + x.dns + '\n  app network ' + x.chromium + '\n  node network ' + x.node).join('\n')
        + (r.some((x) => !x.ok) ? '\n\nIf it says NOT reachable, this network is blocking it. Try a phone hotspot.' : '');
    } catch (e) { out.textContent = 'Network check failed: ' + e.message; }
  });
  $('voiceTest').addEventListener('click', async () => {
    if (!(S.aiOn && window.m2 && window.m2.tts)) { $('voiceInfo').textContent = 'Natural voice needs the Groq AI option ticked when you press Meet M².'; return; }
    S.voiceNote = ''; S.voiceWhy = ''; voice.cloud = true; voice.muted = false; setMuted(false);
    $('voiceInfo').textContent = 'Trying the natural voice...';
    await voice.speak('Hello. This is my natural voice. Can you hear me?');
    if (voice.cloud) { S.voiceNote = 'The natural voice works.'; }
    $('voiceInfo').textContent = voiceReport();
  });
  $('voiceBtn').addEventListener('click', () => setMuted(!voice.muted));
  $('lightBtn').addEventListener('click', () => { const on = document.body.classList.toggle('lit'); $('lightBtn').classList.toggle('on', on); });
  $('detailsBtn').addEventListener('click', () => toggleDetails());
  $('cmdGo').addEventListener('click', () => { const t = $('cmdInput').value; $('cmdInput').value = ''; if (t.trim()) handleText(t); });
  $('cmdInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('cmdGo').click(); });
  setMuted(false);

  // ---------- talk with me: hands-free conversation. The microphone is open only while this is on
  // and M² is not speaking; it closes by itself when you stop talking, and after a few quiet turns.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function setTalkUi(on) {
    $('micBtn').classList.toggle('rec', on);
    $('micBtn').lastChild.textContent = on ? 'Listening. Tap to stop' : 'Talk with me';
  }
  function stopTalking() { S.talking = false; S.recording = false; voice.cancelListening(); setTalkUi(false); }
  async function startTalking() {
    if (S.heavy) { say('Give me a moment, I am busy with your clip.', '', { speak: false }); return; }
    if (S.talking) { stopTalking(); $('capsub').textContent = 'Tap Talk with me when you want me.'; return; }
    if (!S.aiOn) { say('Talking needs my AI link, and it is off.', 'You can type to me instead.', { speak: false }); return; }
    if (navigator.onLine === false) { say('Talking needs the internet, and it looks like it is off.', 'Turn it on, then tap Talk with me again.', { speak: false }); return; }
    if (!voice.canRecord) { say('I cannot reach a microphone here.', 'Type to me instead.', { speak: false }); return; }
    S.talking = true; setTalkUi(true); voice.stopSpeaking();
    let quiet = 0, errors = 0;
    if (!S.greetedTalk) { S.greetedTalk = true; await say('I am here. What is going on?', ''); }
    while (S.talking) {
      while (S.talking && (S.busy || S.speaking)) await sleep(120); // never listen while M² is speaking
      if (!S.talking) break;
      $('capsub').textContent = 'Listening. Just talk.';
      S.recording = true;
      let clip = null;
      try { clip = await voice.listenOnce({ maxMs: 25000 }); }
      catch (e) { S.recording = false; say('I could not open the microphone.', 'Check the system permission, or type to me.', { speak: false }); break; }
      S.recording = false;
      if (!S.talking) break;
      if (!clip) { if (++quiet >= 3) { say('I will wait quietly now.', 'Tap Talk with me when you want me.', { speak: false }); break; } continue; }
      quiet = 0;
      S.busy = true;
      $('capsub').textContent = 'Thinking...';
      let text = '';
      try { text = await window.m2.transcribe(clip.buf, clip.mime); S.count.voice++; renderCounts(); errors = 0; }
      catch (e) {
        S.busy = false;
        say('I could not turn that into text.', String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''), { speak: false });
        if (++errors >= 2) break; // do not loop on a broken connection
        await sleep(1500); continue;
      }
      S.busy = false;
      if (!text || CH.vad.isJunk(text)) { $('capsub').textContent = 'I did not catch that.'; continue; }
      $('capsub').textContent = 'You said: ' + text;
      await handleSpoken(text);
    }
    stopTalking();
  }
  // Short phrases can be commands. Long, free talk is always a conversation.
  async function handleSpoken(text) {
    const words = CH.normalise(text).split(' ').length;
    const cmd = words <= 8 ? CH.parseCommand(text) : null;
    if (cmd) run(cmd, text); else await askAI('chat', text);
    await sleep(150);
    if (voice.muted) await sleep(Math.min(6000, 1500 + text.length * 20));
  }
  $('micBtn').addEventListener('click', startTalking);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && S.phase === 'main' && !/INPUT|TEXTAREA|BUTTON|SELECT/.test((e.target || {}).tagName || '')) { e.preventDefault(); startTalking(); }
  });

  // ---------- clip mode: Read me. Only one heavy thing runs at a time: record, then read, then talk.
  const once = (el, ev) => new Promise((res) => el.addEventListener(ev, res, { once: true }));
  function setPanel(o) {
    $('clipPanel').hidden = !o;
    if (!o) return;
    $('clipTitle').textContent = o.title; $('clipText').textContent = o.text || ''; $('clipHint').textContent = o.hint || '';
    $('clipPreview').hidden = !o.preview; $('clipBreath').hidden = !o.breath; $('clipBarWrap').hidden = !o.bar;
    $('clipGo').hidden = !o.go; $('clipGo').textContent = o.go || '';
    $('clipCancel').textContent = o.cancel || 'Cancel';
    const bar = $('clipBar');
    bar.classList.toggle('indeterminate', !!o.indeterminate);
    if (!o.indeterminate) bar.style.width = (o.pct || 0) + '%';
  }
  function setHeavy(on) {
    S.heavy = on;
    orb.setFrameMs(on ? 100 : 30); // draw the orb less while recording or reading, to leave the processor free
    if (on) { if (S.talking) stopTalking(); voice.stopSpeaking(); }
  }
  if (clipBridge && clipBridge.onEvent) {
    clipBridge.onEvent((ev) => {
      if (S.heavy && ev.type === 'retry') { $('clipHint').textContent = 'The connection to Presage dropped. Trying again (' + ev.n + ' of ' + ev.of + ')...'; return; }
      if (!S.heavy || ev.type !== 'progress') return;
      const total = S.readTotal;
      $('clipHint').textContent = 'Reading... clip time ' + Math.round(ev.t) + (total ? ' of about ' + Math.round(total) : '') + ' s, readings so far: ' + ev.count;
      if (total) { $('clipBar').classList.remove('indeterminate'); $('clipBar').style.width = Math.min(99, (ev.t / total) * 100) + '%'; }
    });
  }
  function applyClipResult(res) {
    const sm = (res && res.summary) || {};
    const ok = sm.good >= 5 && Number.isFinite(sm.breathing) && Number.isFinite(sm.pulse);
    if (!ok) { say('I could not read breathing and pulse in that clip.', CH.clip.whyEmpty(res && res.checks, res && res.hint) + (S.recFps && S.recFps < 20 ? ' The recording was also choppy (about ' + Math.round(S.recFps) + ' pictures per second).' : ''), { speak: false }); return; }
    const first = !S.base;
    if (first) {
      const base = CH.makeBaseline(sm.series || []);
      if (!base) { say('I got a short reading, but not enough to learn your calm.', 'Record a full minute and try again.', { speak: false }); return; }
      S.base = base;
      $('learnChip').hidden = true;
    }
    clipSrc.setReading(sm);
    S.clipRead = true; S.badFor = 0;
    const held = clipSrc.tick();
    const t = Math.min(100, CH.rawTension(held, S.base) + CH.faceNudge(held.expression));
    const d = CH.clip.describe({ sm, base: S.base, firstTime: first, tension: t });
    orb.ripple(1);
    say(d.text, d.sub);
  }
  const friendly = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  async function readingPhase(work) {
    setPanel({ title: 'Reading your clip', text: 'Breathe slowly with the circle. On a slow computer this can take a few minutes. Please leave other programs closed.', breath: true, bar: true, indeterminate: !S.readTotal, pct: 0, cancel: 'Cancel', hint: 'Starting... the first step checks your Presage key online.' });
    const onCancel = () => { if (clipBridge) clipBridge.cancel(); };
    $('clipCancel').addEventListener('click', onCancel);
    try { applyClipResult(await work()); }
    catch (e) { const m = friendly(e); if (!/stopped/i.test(m)) { S.lastClipError = m; say('I could not read that clip.', m, { speak: false }); } }
    finally { $('clipCancel').removeEventListener('click', onCancel); }
  }
  async function readByRecording() {
    if (S.heavy || !clipBridge) return;
    if (!camId) { say('I need a camera to record.', 'Pick one in Details, or use a clip you already have.', { speak: false }); return; }
    setHeavy(true);
    let stream = null;
    const stopStream = () => { if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* gone */ } stream = null; } $('clipPreview').srcObject = null; };
    try {
      try { stream = await CH.clip.openCamera(camId); }
      catch (e) { say('I could not open the camera.', friendly(e), { speak: false }); return; }
      $('clipPreview').srcObject = stream;
      setPanel({ title: 'Read me', text: 'Sit an arm\'s length from the camera with a light in front of your face, head and shoulders in view. Stay still, breathe normally and do not talk for a minute.', preview: true, go: 'Start recording', hint: 'Nothing is recorded until you press Start.' });
      const pressed = await Promise.race([once($('clipGo'), 'click').then(() => 'go'), once($('clipCancel'), 'click').then(() => 'cancel')]);
      if (pressed === 'cancel') return;
      const pic = await CH.clip.pictureCheck($('clipPreview'));
      if (!pic.ok) { S.lastClipError = pic.message; say('I cannot see a picture from this camera.', pic.message, { speak: false }); return; }
      setPanel({ title: 'Recording', text: 'Stay still. Breathe normally. Do not talk.', preview: true, bar: true, pct: 0, cancel: 'Cancel', hint: CLIP_SECONDS + ' seconds to go' });
      let cancelled = false, frames = 0;
      const v = $('clipPreview');
      const tick = () => { frames++; if (!cancelled) v.requestVideoFrameCallback(tick); };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick);
      once($('clipCancel'), 'click').then(() => { cancelled = true; });
      const rec = await CH.clip.recordStream(stream, CLIP_SECONDS, {
        cancelled: () => cancelled,
        onTick: (el) => { $('clipBar').style.width = Math.min(100, (el / CLIP_SECONDS) * 100) + '%'; $('clipHint').textContent = Math.max(0, Math.ceil(CLIP_SECONDS - el)) + ' seconds to go'; },
      });
      cancelled = true;
      stopStream(); // the camera is closed before the reading starts, to free memory
      if (!rec) return;
      S.recFps = rec.seconds > 0 ? frames / rec.seconds : 0;
      S.readTotal = rec.seconds;
      await readingPhase(() => clipBridge.readRecording(rec.data, rec.ext));
    } catch (e) { say('The recording did not work.', friendly(e), { speak: false }); }
    finally { stopStream(); setPanel(null); S.readTotal = 0; setHeavy(false); }
  }
  async function readByImport() {
    if (S.heavy || !clipBridge) return;
    let picked = null;
    try { picked = await clipBridge.pick(); } catch (e) { say('I could not open the file chooser.', friendly(e), { speak: false }); return; }
    if (!picked) return;
    setHeavy(true);
    try { S.readTotal = 0; S.recFps = 0; await readingPhase(() => clipBridge.readPicked()); }
    finally { setPanel(null); setHeavy(false); }
  }
  $('readBtn').addEventListener('click', readByRecording);
  $('importBtn').addEventListener('click', readByImport);

  // ---------- main loop
  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.25, (now - prev) / 1000);
    prev = now;
    if (S.phase !== 'consent') {
      S.acc += dt * SPEED;
      while (S.acc >= 1) { S.acc -= 1; step(1); }
    }
    S.shown += (S.tension - S.shown) * Math.min(1, dt * 2.5);
    let level = 0;
    if (S.recording) level = voice.level();
    else if (S.speaking) level = 0.3 + 0.25 * Math.abs(Math.sin(now / 95)) + 0.12 * Math.sin(now / 37);
    if (S.pacer && S.pacerEnd && now > S.pacerEnd) stopPacer();
    const ph = pacerPhase(now);
    orb.set({ tension: S.phase === 'main' ? S.shown : 0, pacing: S.pacer, breath: S.pacer ? ph.k : 0, level, listening: S.recording, thinking: S.busy, speaking: S.speaking, quality: S.last.quality == null ? 1 : S.last.quality });
    const pace = $('pace');
    pace.style.top = orb.cy + orb.R * 1.28 + 'px';
    pace.textContent = S.pacer ? 'breathe ' + ph.word : '';
    pace.classList.toggle('on', S.pacer);
    if (S.phase === 'main' && !$('details').hidden) {
      const f = (x, n) => (Number.isFinite(x) ? x.toFixed(n) : '-');
      const L = S.last;
      $('tensionNum').textContent = Math.round(S.tension);
      $('tensionBar').style.width = Math.round(S.tension) + '%';
      $('vQ').textContent = L.quality >= 0.4 ? 'good' : 'weak' + (L.hint ? ' (' + L.hint + ')' : '');
      $('vB').textContent = f(L.breathing, 1);
      $('vP').textContent = Number.isFinite(L.pulse) ? Math.round(L.pulse) : '-';
      $('vBase').textContent = S.base ? S.base.breathing.toFixed(1) : 'learning';
      $('vPBase').textContent = S.base ? Math.round(S.base.pulse) : 'learning';
      $('vHrv').textContent = L.hrv ? Math.round(L.hrv.rmssd) + ' ms' + (L.hrv.stable ? '' : ' (settling)') : '-';
      $('vExpr').textContent = L.expression ? L.expression.type + ' ' + Math.round(L.expression.conf) + '%' + (L.expression.stable ? '' : ' (unsteady)') : '-';
      $('vBlink').textContent = L.blinking ? 'yes' : (L.expression ? 'no' : '-');
      $('vTalk').textContent = L.talking ? 'yes' : (L.expression ? 'no' : '-');
      $('vNudge').textContent = '+' + Math.round(S.nudge || 0);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
