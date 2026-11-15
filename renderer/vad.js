/* Decides when a person has finished speaking, from loudness readings (0..1) over time.
   Pure logic, no microphone. It learns the room's background level in the first moments,
   then treats anything clearly above it as speech. */
(function (root) {
  function createVad(opts) {
    const c = Object.assign({ startTimeoutMs: 9000, silenceMs: 950, maxMs: 25000, minSpeechMs: 300, calibMs: 350, margin: 0.06, ratio: 2.2 }, opts);
    let t0 = null, last = null, floor = null, calibN = 0, loudMs = 0, lastLoud = null, heard = false;
    return {
      // returns 'wait' (nothing yet), 'speaking', 'end' (finished speaking), or 'timeout' (never spoke)
      push(level, now) {
        if (t0 === null) { t0 = now; last = now; }
        const dt = Math.min(250, now - last); last = now;
        if (now - t0 < c.calibMs) { floor = floor === null ? level : (floor * calibN + level) / (calibN + 1); calibN++; return 'wait'; }
        const th = Math.max(floor * c.ratio, floor + c.margin);
        const loud = level > th;
        if (loud) { loudMs += dt; lastLoud = now; if (loudMs >= c.minSpeechMs) heard = true; }
        else floor = floor * 0.97 + level * 0.03; // follow slow changes in the room
        if (heard && now - lastLoud >= c.silenceMs) return 'end';
        if (now - t0 >= c.maxMs) return heard ? 'end' : 'timeout';
        if (!heard && now - t0 >= c.startTimeoutMs) return 'timeout';
        return heard ? 'speaking' : 'wait';
      },
      get floor() { return floor; },
      get heard() { return heard; },
    };
  }

  // Whisper sometimes invents words from silence or noise. These are never real requests.
  const JUNK = /^(you|thank you|thanks|thanks for watching|thank you for watching|bye|okay|ok|hmm|mm|uh|um|so|the|\.+)$/i;
  function isJunk(text) {
    const t = String(text || '').replace(/[^a-z' ]+/gi, ' ').replace(/\s+/g, ' ').trim();
    return t.length < 2 || JUNK.test(t);
  }

  const api = { createVad, isJunk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, { vad: api });
})(typeof window !== 'undefined' ? window : globalThis);
