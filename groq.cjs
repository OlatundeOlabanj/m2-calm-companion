// Groq client (main process only). The API key never reaches the window.
// fetchImpl is injectable so tests can use a mock.
// Splits text into pieces of at most 200 characters (the voice model's limit), at sentence ends where possible.
function splitForSpeech(text, max = 200) {
  const out = [];
  let cur = '';
  const parts = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  for (let p of parts) {
    while (p.length > max) { // a very long sentence: cut at a space
      let cut = p.lastIndexOf(' ', max); if (cut < 40) cut = max;
      if (cur) { out.push(cur); cur = ''; }
      out.push(p.slice(0, cut).trim()); p = p.slice(cut).trim();
    }
    if (!p) continue;
    if ((cur + ' ' + p).trim().length <= max) cur = (cur + ' ' + p).trim();
    else { if (cur) out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out;
}

const BASE = 'https://api.groq.com/openai/v1';
const PREFERRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
const NOT_CHAT = /whisper|guard|tts|playai|orpheus|embed|safeguard/i;

// The real reason a network call failed (DNS, refused, timeout, certificate...), not just "fetch failed".
function netReason(e) {
  if (!e) return 'unknown';
  if (e.name === 'AbortError') return 'timed out';
  const c = e.cause;
  return (c && (c.code || c.message)) || e.code || e.message || e.name || 'unknown';
}

function audioName(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('ogg')) return 'speech.ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'speech.m4a';
  if (m.includes('wav')) return 'speech.wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'speech.mp3';
  return 'speech.webm';
}

function createGroq({ apiKey, fetchImpl, model: forced, timeoutMs = 20000, retries = 2, retryDelayMs = 400 }) {
  const f = fetchImpl || fetch;
  let model = forced || '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // One attempt. Network failures get the real reason attached.
  async function once(path, init, binary) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      const { build, ...rest } = init;
      if (build) rest.body = build(); // a fresh body per attempt
      res = await f(BASE + path, { ...rest, signal: ac.signal, headers: { Authorization: 'Bearer ' + apiKey, ...(init.headers || {}) } });
    } catch (e) {
      clearTimeout(t);
      const err = new Error('Network: ' + netReason(e));
      err.network = true;
      throw err;
    }
    try {
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error.message; } catch (e) { /* no body */ }
        const err = new Error('Groq ' + res.status + (detail ? ': ' + detail : ''));
        err.status = res.status;
        throw err;
      }
      return binary ? await res.arrayBuffer() : await res.json();
    } finally { clearTimeout(t); }
  }

  // Retries only network failures and 429/5xx. A wrong key or bad request is not retried.
  async function call(path, init, binary) {
    let last;
    for (let i = 0; i <= retries; i++) {
      try { return await once(path, init, binary); }
      catch (e) {
        last = e;
        const again = e.network || e.status === 429 || (e.status >= 500 && e.status < 600);
        if (!again || i === retries) break;
        await sleep(retryDelayMs * (i + 1));
      }
    }
    throw last;
  }

  async function pickModel() {
    if (model) return model;
    const list = await call('/models', { method: 'GET' });
    const ids = (list.data || []).map((m) => m.id);
    model = PREFERRED.find((id) => ids.includes(id)) || ids.find((id) => !NOT_CHAT.test(id)) || '';
    if (!model) throw new Error('No chat model available on this Groq account');
    return model;
  }

  return {
    async transcribe(bytes, mime) {
      // FormData is rebuilt for every attempt because a body can only be read once.
      const out = await call('/audio/transcriptions', { method: 'POST', build() {
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), audioName(mime));
        form.append('model', 'whisper-large-v3-turbo');
        form.append('language', 'en');
        form.append('response_format', 'json');
        form.append('temperature', '0');
        return form;
      } });
      return String(out.text || '').trim();
    },
    async chat(messages) {
      const m = await pickModel();
      const out = await call('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, messages, temperature: 0.75, max_tokens: 220 }),
      });
      const c = out.choices && out.choices[0] && out.choices[0].message;
      return String((c && c.content) || '').trim();
    },
    // Spoken reply in a natural voice (Groq's Orpheus model). Returns one WAV (ArrayBuffer) per piece of text.
    async speak(text, voice) {
      const pieces = splitForSpeech(text, 185).slice(0, 4);
      return Promise.all(pieces.map((p) => call('/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', input: '[warm] ' + p, voice: voice || 'hannah', response_format: 'wav' }),
      }, true)));
    },
    pickModel,
  };
}

module.exports = { createGroq, PREFERRED, netReason, audioName, splitForSpeech };
