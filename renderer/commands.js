/* Turns what the person says (or types) into one command. Plain keyword matching,
   no AI, works offline. Returns {type, arg} or null. */
(function (root) {
  const RULES = [
    { type: 'stoplisten', words: ['stop listening', 'that is all', "that's all", 'goodbye', 'good night', 'i am done', "i'm done"] },
    { type: 'compose', words: ['help me reply', 'help me write', 'write a reply', 'write my reply', 'help me respond', 'what should i say', 'what should i reply', 'draft a reply', 'draft my reply'] },
    { type: 'calm', words: ['calm me', 'calm down', 'help me calm', 'breathe with me', 'breathing'] },
    { type: 'recalibrate', words: ['recalibrate', 'calibrate', 'reset baseline', 'new baseline'] },
    { type: 'details', words: ['show me details', 'show details', 'details', 'show numbers'] },
    { type: 'mute', words: ['mute', 'be quiet', 'stop talking', 'quiet', 'silence'] },
    { type: 'unmute', words: ['unmute', 'voice on', 'speak to me', 'talk to me'] },
  ];

  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseCommand(text) {
    const t = ' ' + normalise(text) + ' ';
    if (t.trim() === '') return null;
    // "send anyway" must win over "send", so test longer phrases first
    const candidates = [];
    for (const rule of RULES) {
      for (const w of rule.words) {
        if (t.includes(' ' + w + ' ') || t.includes(' ' + w + 's ')) {
          candidates.push({ type: rule.type, arg: rule.arg, len: w.length });
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.len - a.len);
    const best = candidates[0];
    return best.arg ? { type: best.type, arg: best.arg } : { type: best.type };
  }

  const api = { parseCommand, normalise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
