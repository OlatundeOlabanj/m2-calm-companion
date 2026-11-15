/* Voice in and out. In: hands-free listening (the microphone is open only while Talk with me is on and M² is not speaking).
   Out: Groq's natural voice when it works, otherwise this computer's voice; the words are always shown on screen too. */
(function (root) {
  // Splits text into pieces of at most 185 characters. The first sentence is its own piece, so it can start playing early;
  // the rest are joined up to the limit, so one reply is only a few requests.
  function splitSentences(text, max) {
    max = max || 185;
    const sents = [];
    for (let p of String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
      while (p.length > max) { let cut = p.lastIndexOf(' ', max); if (cut < 40) cut = max; sents.push(p.slice(0, cut).trim()); p = p.slice(cut).trim(); }
      if (p) sents.push(p);
    }
    if (!sents.length) return [];
    const out = [sents[0]];
    let cur = '';
    for (const p of sents.slice(1)) {
      if (!cur) cur = p;
      else if ((cur + ' ' + p).length <= max) cur += ' ' + p;
      else { out.push(cur); cur = p; }
    }
    if (cur) out.push(cur);
    return out;
  }

  class Voice {
    constructor() {
      this.stream = null;
      this.rec = null;
      this.chunks = [];
      this.ctx = null;
      this.analyser = null;
      this.buf = null;
      this.muted = false;
    }

    get canRecord() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
    get canSpeak() { return 'speechSynthesis' in window; }
    // true when the browser engine has at least one speech voice; on some Linux setups it has none
    get hasBrowserVoice() { return this.canSpeak && speechSynthesis.getVoices().length > 0; }
    get hasSystemVoice() { return !!(window.m2 && window.m2.speak); }

    async startRecording() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      this.chunks = [];
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      // Many laptop microphones are quiet on Linux. Boost the voice (with a limiter so loud speech does not clip),
      // and record and measure the boosted sound, so normal speaking volume is heard and transcribed.
      let recStream = this.stream;
      let tail = src;
      try {
        const gain = this.ctx.createGain(); gain.gain.value = 3.5;
        const lim = this.ctx.createDynamicsCompressor();
        lim.threshold.value = -12; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
        src.connect(gain); gain.connect(lim); tail = lim;
        const dest = this.ctx.createMediaStreamDestination(); lim.connect(dest); recStream = dest.stream;
      } catch (e) { tail = src; recStream = this.stream; }
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.buf = new Uint8Array(this.analyser.fftSize);
      tail.connect(this.analyser);
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = types.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t));
      this.rec = mimeType ? new MediaRecorder(recStream, { mimeType }) : new MediaRecorder(recStream);
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.start();
    }

    // loudness 0..1 while recording
    level() {
      if (!this.analyser) return 0;
      this.analyser.getByteTimeDomainData(this.buf);
      let s = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; s += v * v; }
      return Math.min(1, Math.sqrt(s / this.buf.length) * 4);
    }

    // Hands-free: opens the microphone, waits for the person to speak, and closes it once they stop.
    // Resolves with {buf, mime}, or null if nobody spoke (or it was cancelled). onLevel gets 0..1 for the orb.
    async listenOnce(opts) {
      const o = opts || {};
      await this.startRecording();
      const vad = root.CH.vad.createVad({ maxMs: o.maxMs || 25000 });
      return new Promise((resolve) => {
        let done = false;
        const finish = async (heard) => {
          if (done) return; done = true;
          clearInterval(iv); this._cancel = null;
          const clip = await this.stopRecording();
          resolve(heard ? clip : null);
        };
        this._cancel = () => finish(false);
        const iv = setInterval(() => {
          const lv = this.level();
          if (o.onLevel) o.onLevel(lv);
          const st = vad.push(lv, performance.now());
          if (st === 'end') finish(true);
          else if (st === 'timeout') finish(false);
        }, 50);
      });
    }
    cancelListening() { if (this._cancel) this._cancel(); }

    stopRecording() {
      return new Promise((resolve) => {
        if (!this.rec) return resolve(null);
        const rec = this.rec;
        rec.onstop = async () => {
          const mime = rec.mimeType || 'audio/webm';
          const blob = new Blob(this.chunks, { type: mime });
          this._release();
          resolve(blob.size > 1500 ? { buf: await blob.arrayBuffer(), mime } : null); // ignore accidental taps
        };
        try { rec.stop(); } catch (e) { this._release(); resolve(null); }
      });
    }

    _release() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close();
      this.stream = null; this.rec = null; this.ctx = null; this.analyser = null;
    }

    // Speaks the text; resolves when finished. Falls back to a timed pause if no voice is available.
    speak(text) {
      if (this.cloud && window.m2 && window.m2.tts && !this.muted) {
        return this._speakCloud(text).catch((e) => {
          if (e && e.partial) return; // part of it was already spoken; do not say it twice
          this.cloud = false; // do not keep failing on every sentence; use this computer's voice instead
          const why = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': Error: /, '');
          this.lastCloudError = why;
          if (this.onCloudError) this.onCloudError(why);
          return this._speakLocal(text);
        });
      }
      return this._speakLocal(text);
    }

    // Natural voice from Groq. Each sentence is requested at once, and the first one plays as soon as it arrives.
    async _speakCloud(text) {
      const token = (this._tok = (this._tok || 0) + 1);
      const jobs = splitSentences(text).slice(0, 5).map((p) => window.m2.tts(p));
      jobs.forEach((j) => j.catch(() => {})); // errors are handled below, when each one is awaited
      let spoken = false;
      for (const job of jobs) {
        let wavs;
        try { wavs = await job; } catch (e) { if (spoken) e.partial = true; throw e; }
        if (!spoken && this.onCloudSpoken) this.onCloudSpoken();
        for (const w of wavs) {
          if (token !== this._tok) return; // stopped or replaced
          spoken = true;
          await new Promise((resolve, reject) => {
            const url = URL.createObjectURL(new Blob([w], { type: 'audio/wav' }));
            const a = new Audio(url);
            this.audio = a;
            const end = () => { URL.revokeObjectURL(url); this.audio = null; resolve(); };
            a.onended = end;
            a.onerror = () => { URL.revokeObjectURL(url); this.audio = null; const er = new Error('Could not play the voice audio'); if (spoken) er.partial = true; reject(er); };
            a.play().catch((er) => { if (spoken) er.partial = true; reject(er); });
          });
        }
      }
    }

    _speakLocal(text) {
      const ms = Math.max(1200, text.split(/\s+/).length * 380);
      if (this.muted) return new Promise((r) => setTimeout(r, ms));
      if (!this.hasBrowserVoice) {
        if (!this.hasSystemVoice) { this.noVoice = true; return new Promise((r) => setTimeout(r, ms)); }
        // fall back to a speech program on this computer (espeak-ng or speech-dispatcher)
        return window.m2.speak(text).then((ok) => { if (!ok) { this.noVoice = true; return new Promise((r) => setTimeout(r, ms)); } }).catch(() => new Promise((r) => setTimeout(r, ms)));
      }
      return new Promise((resolve) => {
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
          const female = /female|woman|zira|jenny|aria|samantha|sonia|libby|hazel|susan|karen|moira|tessa|victoria|serena|fiona|allison|ava|joanna|ivy|kendra|emma/i;
          u.voice = voices.find((v) => female.test(v.name) && /natural|neural|online/i.test(v.name)) || voices.find((v) => female.test(v.name)) || voices.find((v) => /natural|google/i.test(v.name)) || voices[0] || null;
          u.rate = 1.0; u.pitch = 1.12;
          let done = false;
          const fin = () => { if (!done) { done = true; resolve(); } };
          u.onend = fin; u.onerror = fin;
          setTimeout(fin, ms + 6000); // some Linux builds never fire onend
          speechSynthesis.speak(u);
        } catch (e) { setTimeout(resolve, ms); }
      });
    }

    stopSpeaking() {
      this._tok = (this._tok || 0) + 1;
      if (this.audio) { try { this.audio.pause(); } catch (e) { /* ignore */ } this.audio = null; }
      if (this.canSpeak) speechSynthesis.cancel();
      if (this.hasSystemVoice && window.m2.stopSpeak) window.m2.stopSpeak();
    }
  }

  root.CH = Object.assign(root.CH || {}, { Voice, splitSentences });
})(typeof window !== 'undefined' ? window : globalThis);
