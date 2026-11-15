const test = require('node:test');
const assert = require('node:assert');
const { median, mad, makeBaseline, rawTension, Smoother } = require('../renderer/baseline.js');
const { Gate } = require('../renderer/gate.js');
const { parseCommand } = require('../renderer/commands.js');

const calmSamples = (n, b = 13, p = 70) =>
  Array.from({ length: n }, (_, i) => ({ breathing: b + Math.sin(i) * 0.8, pulse: p + Math.cos(i) * 1.5 }));

test('C01 median and mad', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(mad([1, 1, 2, 2, 4, 6, 9]), 1);
});

test('C02 baseline needs enough samples', () => {
  assert.strictEqual(makeBaseline(calmSamples(5)), null);
  const base = makeBaseline(calmSamples(40));
  assert.ok(base && Math.abs(base.breathing - 13) < 1 && Math.abs(base.pulse - 70) < 2);
});

test('C03 baseline ignores bad readings', () => {
  const s = calmSamples(30).concat([{ breathing: NaN, pulse: 70 }, { breathing: 13, pulse: undefined }]);
  assert.strictEqual(makeBaseline(s).samples, 30);
});

test('C04 calm readings give low tension, stirred readings give high', () => {
  const base = makeBaseline(calmSamples(40));
  assert.ok(rawTension({ breathing: 13, pulse: 70 }, base) < 10);
  assert.ok(rawTension({ breathing: 24, pulse: 98 }, base) > 80);
});

test('C05 values below the baseline never raise tension', () => {
  const base = makeBaseline(calmSamples(40));
  assert.strictEqual(rawTension({ breathing: 8, pulse: 55 }, base), 0);
});

test('C06 tension is 0 without a baseline or with bad input', () => {
  assert.strictEqual(rawTension({ breathing: 20, pulse: 90 }, null), 0);
  const base = makeBaseline(calmSamples(40));
  assert.strictEqual(rawTension({ breathing: NaN, pulse: 90 }, base), 0);
});

test('C07 smoother moves towards new values', () => {
  const s = new Smoother(0.5);
  assert.strictEqual(s.push(10), 10);
  assert.strictEqual(s.push(20), 15);
});

test('C08 gate locks only after tension is high for the hold time', () => {
  const g = new Gate();
  g.update(80, 1, 0.9);
  g.update(80, 1, 0.9);
  assert.strictEqual(g.state, 'open');
  g.update(80, 1, 0.9);
  assert.strictEqual(g.state, 'locked');
  assert.strictEqual(g.canSend, false);
});

test('C09 a short spike does not lock', () => {
  const g = new Gate();
  g.update(90, 2, 0.9);
  g.update(10, 1, 0.9);
  g.update(90, 2, 0.9);
  assert.strictEqual(g.state, 'open');
});

test('C10 locked moves to review after calm, then confirm opens', () => {
  const g = new Gate();
  for (let i = 0; i < 3; i++) g.update(90, 1, 0.9);
  assert.strictEqual(g.state, 'locked');
  for (let i = 0; i < 7; i++) g.update(10, 1, 0.9);
  assert.strictEqual(g.state, 'locked');
  g.update(10, 1, 0.9);
  assert.strictEqual(g.state, 'review');
  assert.strictEqual(g.canSend, false);
  assert.ok(g.confirmReview());
  assert.strictEqual(g.state, 'open');
});

test('C11 tension rising again in review goes back to locked', () => {
  const g = new Gate();
  for (let i = 0; i < 3; i++) g.update(90, 1, 0.9);
  for (let i = 0; i < 8; i++) g.update(10, 1, 0.9);
  assert.strictEqual(g.state, 'review');
  for (let i = 0; i < 3; i++) g.update(90, 1, 0.9);
  assert.strictEqual(g.state, 'locked');
});

test('C12 weak signal pauses the gate and never locks', () => {
  const g = new Gate();
  for (let i = 0; i < 10; i++) g.update(95, 1, 0.1);
  assert.strictEqual(g.state, 'open');
  assert.strictEqual(g.noSignal, true);
});

test('C13 manual override always opens', () => {
  const g = new Gate();
  for (let i = 0; i < 3; i++) g.update(90, 1, 0.9);
  g.override();
  assert.strictEqual(g.canSend, true);
});

test('C14 commands are understood', () => {
  assert.deepStrictEqual(parseCommand('please calm me down'), { type: 'calm' });
  assert.equal(parseCommand('courtship mode'), null);
  assert.strictEqual(parseCommand('send it'), null);
});

test('C15 there are no send or draft commands any more', () => {
  assert.strictEqual(parseCommand('send anyway'), null);
  assert.strictEqual(parseCommand('make it kinder'), null);
});

test('C16 unknown or empty speech gives no command', () => {
  assert.strictEqual(parseCommand('what a lovely day'), null);
  assert.strictEqual(parseCommand('   '), null);
  assert.strictEqual(parseCommand(undefined), null);
});
