const test = require('node:test');
const assert = require('node:assert');
const phrases = require('../renderer/phrases.js');
const prompt = require('../renderer/prompt.js');
const { parseCommand } = require('../renderer/commands.js');
const { createGroq } = require('../groq.cjs');
const { readEnvKey } = require('../env.cjs');

test('M01 locked line uses the person own numbers', () => {
  const l = phrases.locked({ mode: 'founder', last: { breathing: 20.4 }, base: { breathing: 13.1 } });
  assert.match(l.text, /20 breaths a minute/);
  assert.match(l.text, /calm is 13/);
});

test('M02 phrases never name an emotion', () => {
  const all = JSON.stringify([phrases.welcome(), phrases.rising({ last: { breathing: 19 }, base: { breathing: 13 } }),
    phrases.locked({ last: { breathing: 21 }, base: { breathing: 13 } }), phrases.review({}), phrases.noSignal('Too dark')]);
  assert.doesNotMatch(all, /angry|anxious|upset|furious|stress|depress/i);
});

test('M03 missing numbers still give a sensible line', () => {
  assert.ok(phrases.locked({ mode: 'founder' }).text.length > 5);
  assert.ok(phrases.rising({}).text.length > 5);
});

test('M04 new commands parse', () => {
  assert.deepStrictEqual(parseCommand('show me details'), { type: 'details' });
  assert.deepStrictEqual(parseCommand('be quiet'), { type: 'mute' });
});

test('M08 the message you received is part of the talk', () => {
  const ctx = { breathing: 18, baseBreathing: 13, tension: 50, expr: { type: 'sad', conf: 71 } };
  const chat = prompt.buildMessages({ kind: 'chat', text: 'hi', incoming: 'INCOMING TEXT', ctx, history: [] });
  assert.match(JSON.stringify(chat), /INCOMING TEXT/);
  assert.match(chat[0].content, /leans sad \(71%/);
  const cp = prompt.buildMessages({ kind: 'compose', text: 'say I need time', incoming: 'INCOMING TEXT', ctx, history: [] });
  assert.match(cp[cp.length - 1].content, /INCOMING TEXT[\s\S]*say I need time[\s\S]*Return only the reply/);
  assert.strictEqual(prompt.cleanReply('Hello **there**', 'compose'), 'Hello there');
});

test('M05 prompt includes numbers only when the camera really has a reading', () => {
  const withReading = prompt.buildMessages({ kind: 'chat', text: 'hello', ctx: { breathing: 19.6, baseBreathing: 13, tension: 62 }, history: [] });
  assert.match(withReading[0].content, /breathing now 20\/min/);
  assert.match(withReading[0].content, /Tension 62\/100/);
  const none = prompt.buildMessages({ kind: 'chat', text: 'hello', ctx: { reading: false, breathing: NaN, tension: NaN }, history: [] });
  assert.match(none[0].content, /no reading right now/);
  assert.match(none[0].content, /Say nothing about their body/);
  assert.doesNotMatch(none[0].content, /Tension \d/);
  const noBase = prompt.buildMessages({ kind: 'chat', text: 'hello', ctx: { breathing: 15, baseBreathing: NaN, tension: NaN }, history: [] });
  assert.match(noBase[0].content, /still being learned/);
  assert.doesNotMatch(noBase[0].content, /Tension \d/);
});

test('M06 prompt caps history and turn size', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(5000) }));
  const m = prompt.buildMessages({ kind: 'chat', text: 'y'.repeat(9000), ctx: {}, history });
  assert.ok(m.length <= 10);
  assert.ok(m.slice(1).every((x) => x.content.length < 3500));
});

test('M07 replies are cleaned and diagnoses are blocked', () => {
  assert.equal(prompt.cleanReply('**Hello** there\n\nfriend'), 'Hello there friend');
  assert.match(prompt.cleanReply('You are anxious and may have a disorder.'), /cannot tell you how you are/);
  assert.equal(prompt.cleanReply('Line one.\nLine two.', 'compose'), 'Line one.\nLine two.');
  const long = 'This is a sentence about something. '.repeat(20);
  assert.ok(prompt.cleanReply(long).length <= 330);
});

test('M20 M² is told not to repeat itself, and what it said recently', () => {
  const history = [
    { role: 'user', content: 'he is ignoring me' },
    { role: 'assistant', content: 'It sounds like that is frustrating. Want to take a slow breath together?' },
    { role: 'user', content: 'no' },
    { role: 'assistant', content: 'Okay. What did he actually write?' },
  ];
  const m = prompt.buildMessages({ kind: 'chat', text: 'he said ok', ctx: {}, history });
  assert.match(m[0].content, /already suggested breathing recently/);
  assert.match(m[0].content, /Do not begin with[^.]*"It sounds like that"/);
  assert.match(m[0].content, /Never repeat yourself/);
  const fresh = prompt.buildMessages({ kind: 'chat', text: 'hi', ctx: {}, history: [] });
  assert.doesNotMatch(fresh[0].content, /already suggested/);
});

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    const r = routes[key];
    if (!r) return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) };
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

test('G01 chat picks a preferred model and sends the key only as a header', async () => {
  const f = mockFetch({
    '/models': { body: { data: [{ id: 'whisper-large-v3' }, { id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }] } },
    '/chat/completions': { body: { choices: [{ message: { content: ' Hi. ' } }] } },
  });
  const g = createGroq({ apiKey: 'KEY123', fetchImpl: f });
  const out = await g.chat([{ role: 'user', content: 'hello' }]);
  assert.equal(out, 'Hi.');
  const chatCall = f.calls.find((c) => c.url.endsWith('/chat/completions'));
  assert.equal(JSON.parse(chatCall.init.body).model, 'llama-3.3-70b-versatile');
  assert.equal(chatCall.init.headers.Authorization, 'Bearer KEY123');
  assert.doesNotMatch(chatCall.init.body, /KEY123/);
});

test('G02 falls back to any chat model when no preferred one exists', async () => {
  const f = mockFetch({
    '/models': { body: { data: [{ id: 'whisper-large-v3' }, { id: 'playai-tts' }, { id: 'some-new-chat-model' }] } },
    '/chat/completions': { body: { choices: [{ message: { content: 'ok' } }] } },
  });
  const g = createGroq({ apiKey: 'k', fetchImpl: f });
  await g.chat([{ role: 'user', content: 'x' }]);
  assert.equal(JSON.parse(f.calls[1].init.body).model, 'some-new-chat-model');
});

test('G03 transcribe posts multipart to the transcription endpoint', async () => {
  const f = mockFetch({ '/audio/transcriptions': { body: { text: ' send it ' } } });
  const g = createGroq({ apiKey: 'k', fetchImpl: f });
  const t = await g.transcribe(new Uint8Array([1, 2, 3]), 'audio/webm');
  assert.equal(t, 'send it');
  const c = f.calls[0];
  assert.match(c.url, /openai\/v1\/audio\/transcriptions$/);
  assert.equal(c.init.body.get('model'), 'whisper-large-v3-turbo');
});

test('G04 API errors carry status and message, never the key', async () => {
  const f = mockFetch({ '/models': { ok: false, status: 401, body: { error: { message: 'Invalid API Key' } } } });
  const g = createGroq({ apiKey: 'SECRETKEY', fetchImpl: f });
  await assert.rejects(g.chat([{ role: 'user', content: 'x' }]), (e) => e.status === 401 && /Invalid API Key/.test(e.message) && !/SECRETKEY/.test(e.message));
});

test('E01 env reader finds a named key and strips quotes', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm2env-'));
  fs.writeFileSync(path.join(d, '.env'), 'PRESAGE_API_KEY=abc\nGROQ_API_KEY="gsk_xyz"\n');
  assert.equal(readEnvKey(d, 'GROQ_API_KEY'), 'gsk_xyz');
  assert.equal(readEnvKey(d, 'PRESAGE_API_KEY'), 'abc');
  assert.equal(readEnvKey(d, 'MISSING'), '');
});

const { faceNudge, readRoom } = require('../renderer/read.js');

test('R01 face nudge only for clear, stable, negative readings and is capped', () => {
  assert.equal(faceNudge(null), 0);
  assert.equal(faceNudge({ type: 'happy', conf: 90, stable: true }), 0);
  assert.equal(faceNudge({ type: 'angry', conf: 40, stable: true }), 0);
  assert.equal(faceNudge({ type: 'angry', conf: 90, stable: false }), 0);
  const n = faceNudge({ type: 'angry', conf: 100, stable: true });
  assert.ok(n > 0 && n <= 12);
});

test('R02 reads are guesses that ask the person, and need a baseline', () => {
  assert.equal(readRoom({ tension: 70, expr: { type: 'angry', conf: 80, stable: true }, hasBase: false }), null);
  const r = readRoom({ tension: 60, expr: { type: 'sad', conf: 80, stable: true }, hasBase: true });
  assert.match(r.text, /My guess/);
  assert.match(r.sub, /Am I close/);
  assert.equal(readRoom({ tension: 10, expr: { type: 'neutral', conf: 90, stable: true }, hasBase: true }), null);
  const low = readRoom({ tension: 10, expr: { type: 'fear', conf: 70, stable: true }, hasBase: true });
  assert.match(low.text, /though your body looks steady/);
  assert.notEqual(low.key, r.key);
});

test('R03 a high body with an unreadable face is said without naming a feeling', () => {
  const r = readRoom({ tension: 60, expr: null, talking: false, hasBase: true });
  assert.doesNotMatch(r.text, /angry|sad|anxious/);
});

test('M09 spoken commands for the conversation', () => {
  assert.deepStrictEqual(parseCommand('okay stop listening'), { type: 'stoplisten' });
  assert.deepStrictEqual(parseCommand('can you help me reply to her'), { type: 'compose' });
  assert.deepStrictEqual(parseCommand('what should I say'), { type: 'compose' });
});
