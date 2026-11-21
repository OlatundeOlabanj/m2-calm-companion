/* Clip mode helpers, for computers too slow to read the camera live.
   Step 1: record a short clip. Step 2: Presage reads it in a separate process. Step 3: the reading is held and drives M² like a live one.
   Pure parts (describe, ClipSource, mime choice) are testable without a browser; recording needs a browser. */
(function (root) {
  const CLIP_SECONDS = 60;
  const STALE_MS = 15 * 60 * 1000; // a reading older than this is not treated as how you are now

  const r = (x) => Math.round(x);

  // The one reading M² holds between clips. tick() has the same shape as the live source.
  class ClipSource {
    constructor(clock) {
      this.clock = clock || (() => Date.now());
      this.label = 'CLIP READING (Presage SmartSpectra)';
      this.error = '';
      this.reset();
    }
    reset() { this.at = 0; this.latest = { breathing: NaN, pulse: NaN, quality: 0, hint: 'Tap Read me first' }; }
    setReading(sm) {
      const ok = sm && Number.isFinite(sm.breathing) && Number.isFinite(sm.pulse);
      this.at = this.clock();
      this.latest = {
        breathing: ok ? sm.breathing : NaN, pulse: ok ? sm.pulse : NaN, quality: ok ? 0.9 : 0.1, hint: ok ? '' : 'No reading in the clip',
        expression: sm && sm.expression ? sm.expression : null, blinking: false, talking: false, hrv: sm && sm.hrv ? sm.hrv : null,
      };
    }
    get has() { return this.at > 0; }
    get stale() { return this.at > 0 && this.clock() - this.at > STALE_MS; }
    tick() {
      if (this.stale) return Object.assign({}, this.latest, { quality: 0.2, hint: 'Your last reading is old. Tap Read me.' });
      return this.latest;
    }
  }

  // Plain words for a finished reading. States measurements and never names an emotion or diagnoses.
  function describe({ sm, base, firstTime, tension }) {
    const b = r(sm.breathing), p = r(sm.pulse);
    if (firstTime) return { text: 'I have your calm: about ' + b + ' breaths a minute and a pulse near ' + p + ' beats a minute.', sub: 'When you feel tense, tap Read me again and I will compare.' };
    const bb = base ? r(base.breathing) : null, pp = base ? r(base.pulse) : null;
    const cmp = bb != null ? 'Breathing ' + b + ' per minute (your calm ' + bb + '), pulse ' + p + ' bpm (your calm ' + pp + ' bpm).' : 'Breathing ' + b + ' per minute, pulse ' + p + ' bpm.';
    if (tension < 30) return { text: 'You look settled.', sub: cmp };
    if (tension < 55) return { text: 'A little above your calm.', sub: cmp + ' Want to breathe together?' };
    return { text: 'Your body looks tense.', sub: cmp + ' Let us slow down before you send anything.' };
  }

  // Why a clip gave no reading, in one line, from the picture checks the SDK reported.
  function whyEmpty(checks, hint) {
    const t = ((checks || []).join(' ') + ' ' + (hint || '')).toLowerCase();
    if (/dark/.test(t)) return 'The clip was too dark. Put a lamp in front of your face and try again.';
    if (/bright/.test(t)) return 'The clip was too bright. Turn away from the window or lamp behind you.';
    if (/multiplefaces/.test(t)) return 'There was more than one face in the clip. Record again with only you in the picture.';
    if (/facenot|no ?face|centre|center|facetoo|face ?size/.test(t)) return 'I could not find your face for long enough. Face the camera, in the middle of the picture.';
    if (/chest/.test(t)) return 'I could see your face but not your chest. Sit back so head, shoulders and chest are in the picture.';
    if (/framerate|frame rate/.test(t)) return 'The recording was choppy. Close other programs and record again.';
    if (/motion/.test(t)) return 'There was too much movement. Sit still for the whole minute.';
    return 'Try again with a lamp in front of your face, sitting still for the whole minute.';
  }

  const MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
  function pickMime(isSupported) {
    const ok = isSupported || ((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
    const m = MIMES.find((x) => ok(x));
    return m ? { mime: m, ext: /mp4/.test(m) ? 'mp4' : 'webm' } : null;
  }

  // Opens the camera at a modest size: smaller pictures are lighter to record and to read.
  function openCamera(deviceId) {
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
  }

  // Records the given stream for `seconds`. hooks: { onTick(elapsedSeconds), cancelled() }. Resolves { data, ext, seconds } (data is an ArrayBuffer).
  function recordStream(stream, seconds, hooks) {
    const h = hooks || {};
    return new Promise((resolve, reject) => {
      const pick = pickMime();
      if (!pick) { reject(new Error('This computer cannot record video here.')); return; }
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: pick.mime, videoBitsPerSecond: 4000000 }); }
      catch (e) { reject(e); return; }
      const chunks = [];
      const t0 = performance.now();
      let cancelled = false, timer = null;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = (e) => { clearInterval(timer); reject((e && e.error) || new Error('Recording failed.')); };
      rec.onstop = async () => {
        clearInterval(timer);
        if (cancelled) { resolve(null); return; }
        try {
          const blob = new Blob(chunks, { type: pick.mime });
          resolve({ data: await blob.arrayBuffer(), ext: pick.ext, seconds: (performance.now() - t0) / 1000 });
        } catch (e) { reject(e); }
      };
      rec.start(1000);
      timer = setInterval(() => {
        const el = (performance.now() - t0) / 1000;
        if (h.onTick) h.onTick(el);
        if (h.cancelled && h.cancelled()) { cancelled = true; try { rec.stop(); } catch (e) { /* stopped */ } }
        else if (el >= seconds) { try { rec.stop(); } catch (e) { /* stopped */ } }
      }, 250);
    });
  }

  // Before recording: is the camera really giving a picture? A virtual camera with nothing behind it (for example DroidCam with no phone connected) shows a black rectangle.
  // meanLuma/blackLimit are pure so they can be tested; the canvas part needs a browser.
  const BLACK_LIMIT = 6;
  function meanLuma(rgba) {
    let sum = 0, n = 0;
    for (let i = 0; i + 2 < rgba.length; i += 4) { sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]; n++; }
    return n ? sum / n : 0;
  }
  async function pictureCheck(video, waitMs) {
    const limit = waitMs || 4000, t0 = performance.now();
    const msg = 'This camera shows no picture (black). Pick another camera in Details (the laptop\'s own camera is often called Integrated or EasyCamera), or connect the phone app, then try again.';
    while (performance.now() - t0 < limit && !(video.videoWidth > 0 && video.readyState >= 2)) await new Promise((r) => setTimeout(r, 100));
    if (!(video.videoWidth > 0)) return { ok: false, message: msg };
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      let best = 0;
      for (let k = 0; k < 6; k++) { g.drawImage(video, 0, 0, 32, 24); best = Math.max(best, meanLuma(g.getImageData(0, 0, 32, 24).data)); if (best >= BLACK_LIMIT) break; await new Promise((r) => setTimeout(r, 250)); }
      return best >= BLACK_LIMIT ? { ok: true, luma: best } : { ok: false, luma: best, message: msg };
    } catch (e) { return { ok: true }; } // cannot sample: let the recording go ahead
  }

  const api = { CLIP_SECONDS, meanLuma, BLACK_LIMIT, pictureCheck, STALE_MS, ClipSource, describe, whyEmpty, pickMime, openCamera, recordStream };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, { clip: api });
})(typeof window !== 'undefined' ? window : globalThis);
