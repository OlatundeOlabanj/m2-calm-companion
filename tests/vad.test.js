const test = require('node:test');
const assert = require('node:assert');
const { createVad, isJunk } = require('../renderer/vad.js');

function run(v, levels, step = 50) { let t = 0; let out = 'wait'; for (const l of levels) { out = v.push(l, t); t += step; if (out === 'end' || out === 'timeout') return { out, t }; } return { out, t }; }
const rep = (x, n) => Array(n).fill(x);

test('V01 speech then silence ends the turn', () => {
  const r = run(createVad(), [...rep(0.02, 10), ...rep(0.5, 20), ...rep(0.02, 40)]);
  assert.strictEqual(r.out, 'end');
});
test('V02 a room that stays quiet times out', () => {
  assert.strictEqual(run(createVad({ startTimeoutMs: 2000 }), rep(0.02, 100)).out, 'timeout');
});
test('V03 a short click is not speech', () => {
  const r = run(createVad({ startTimeoutMs: 2000 }), [...rep(0.02, 10), 0.6, ...rep(0.02, 90)]);
  assert.strictEqual(r.out, 'timeout');
});
test('V04 a pause shorter than the silence limit does not cut the person off', () => {
  const v = createVad({ silenceMs: 1300 });
  const r = run(v, [...rep(0.02, 10), ...rep(0.5, 10), ...rep(0.02, 14), ...rep(0.5, 10), ...rep(0.02, 40)]);
  assert.strictEqual(r.out, 'end');
  assert.ok(r.t > 1500 + 700 + 600, 'ended only after the second part: ' + r.t);
});
test('V05 a noisy room (floor 0.15) still hears speech', () => {
  const r = run(createVad(), [...rep(0.15, 10), ...rep(0.6, 20), ...rep(0.15, 40)]);
  assert.strictEqual(r.out, 'end');
});
test('V06 very long talking is cut at the maximum', () => {
  assert.strictEqual(run(createVad({ maxMs: 3000 }), [...rep(0.02, 10), ...rep(0.5, 200)]).out, 'end');
});
test('V07 Whisper junk is recognised', () => {
  for (const j of ['you', 'Thank you.', 'Thanks for watching!', '...', '', 'um']) assert.ok(isJunk(j), j);
  for (const ok of ['I am nervous', 'she said I never call']) assert.ok(!isJunk(ok), ok);
});
