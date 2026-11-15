const test = require('node:test');
const assert = require('node:assert');
const { createGroq, netReason, audioName } = require('../groq.cjs');

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });

test('N01 network failure is retried and then succeeds', async () => {
  let n = 0;
  const g = createGroq({ apiKey: 'k', model: 'm', retryDelayMs: 1, fetchImpl: async () => { n++; if (n < 3) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; } return ok({ text: ' hello ' }); } });
  assert.strictEqual(await g.transcribe(Buffer.from('abc'), 'audio/webm'), 'hello');
  assert.strictEqual(n, 3);
});

test('N02 the real cause is shown, not just "fetch failed"', async () => {
  const g = createGroq({ apiKey: 'k', model: 'm', retries: 0, fetchImpl: async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; } });
  await assert.rejects(g.chat([{ role: 'user', content: 'x' }]), /Network: ENOTFOUND/);
});

test('N03 a wrong key (401) is not retried', async () => {
  let n = 0;
  const g = createGroq({ apiKey: 'k', model: 'm', retryDelayMs: 1, fetchImpl: async () => { n++; return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) }; } });
  await assert.rejects(g.chat([]), /Groq 401: bad key/);
  assert.strictEqual(n, 1);
});

test('N04 each retry gets a fresh audio body and the right file name', async () => {
  const bodies = [];
  let n = 0;
  const g = createGroq({ apiKey: 'k', retryDelayMs: 1, fetchImpl: async (u, i) => { bodies.push(i.body); n++; if (n === 1) throw new Error('x'); return ok({ text: 'hi' }); } });
  await g.transcribe(Buffer.from('abc'), 'audio/ogg;codecs=opus');
  assert.notStrictEqual(bodies[0], bodies[1]);
  assert.strictEqual(bodies[1].get('file').name, 'speech.ogg');
  assert.strictEqual(audioName('audio/webm;codecs=opus'), 'speech.webm');
  assert.strictEqual(netReason({ name: 'AbortError' }), 'timed out');
});

test('N05 long replies are split for the voice model (200 characters at most) at sentence ends', () => {
  const { splitForSpeech } = require('../groq.cjs');
  const t = 'I hear you. That sounded really hard to read. ' + 'Take one slow breath with me now, in for four and out for six, and let your shoulders drop. '.repeat(3);
  const parts = splitForSpeech(t, 185);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(p.length <= 185, p.length + ' ' + p);
  assert.strictEqual(parts.join(' ').replace(/\s+/g, ' '), t.replace(/\s+/g, ' ').trim());
});

test('N06 speech request uses the Orpheus model, a female voice, wav, one call per piece', async () => {
  const calls = [];
  const g = createGroq({ apiKey: 'k', fetchImpl: async (u, i) => { calls.push({ u, b: JSON.parse(i.body) }); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  const out = await g.speak('First sentence here. ' + 'Second sentence is much longer and goes on for a while so it needs its own piece of audio. '.repeat(2), 'hannah');
  assert.ok(out.length >= 2);
  assert.match(calls[0].u, /audio\/speech$/);
  assert.strictEqual(calls[0].b.model, 'canopylabs/orpheus-v1-english');
  assert.strictEqual(calls[0].b.voice, 'hannah');
  assert.strictEqual(calls[0].b.response_format, 'wav');
  for (const c of calls) assert.ok(c.b.input.length <= 200);
});
