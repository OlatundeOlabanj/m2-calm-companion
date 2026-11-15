const test = require('node:test');
const assert = require('node:assert');
const clip = require('../renderer/clip.js');

test('K01 ClipSource has no reading until one is set, and then holds it', () => {
  const t = { now: 1000 };
  const src = new clip.ClipSource(() => t.now);
  assert.equal(src.has, false);
  assert.ok(src.tick().quality < 0.4);
  src.setReading({ breathing: 14, pulse: 70, expression: { type: 'neutral', conf: 80, stable: true }, hrv: { rmssd: 40, stable: true } });
  assert.equal(src.has, true);
  const s = src.tick();
  assert.equal(s.breathing, 14); assert.equal(s.pulse, 70); assert.ok(s.quality >= 0.4);
  assert.equal(s.expression.type, 'neutral'); assert.equal(s.hrv.rmssd, 40);
});

test('K02 a reading goes stale after 15 minutes and M² stops judging by it', () => {
  const t = { now: 0 };
  const src = new clip.ClipSource(() => t.now);
  t.now = 5; src.setReading({ breathing: 14, pulse: 70 });
  t.now += clip.STALE_MS - 10;
  assert.ok(src.tick().quality >= 0.4);
  t.now += 20;
  const s = src.tick();
  assert.ok(s.quality < 0.4); assert.match(s.hint, /old/);
});

test('K03 a reading without breathing and pulse is held as unusable, and reset clears it', () => {
  const src = new clip.ClipSource(() => 1);
  src.setReading({ breathing: NaN, pulse: NaN });
  assert.ok(src.tick().quality < 0.4);
  src.setReading({ breathing: 15, pulse: 72 });
  src.reset();
  assert.equal(src.has, false);
});

test('K04 describe gives plain words for first calm reading, settled, a bit above, and tense', () => {
  const sm = { breathing: 14.4, pulse: 71.2 };
  const base = { breathing: 13.6, pulse: 68.4 };
  assert.match(clip.describe({ sm, base: null, firstTime: true, tension: 0 }).text, /your calm: about 14 breaths.*pulse near 71/);
  assert.equal(clip.describe({ sm, base, firstTime: false, tension: 10 }).text, 'You look settled.');
  assert.match(clip.describe({ sm, base, firstTime: false, tension: 40 }).text, /above your calm/);
  const t = clip.describe({ sm: { breathing: 22, pulse: 98 }, base, firstTime: false, tension: 80 });
  assert.match(t.text, /tense/); assert.match(t.sub, /your calm 14/); assert.match(t.sub, /your calm 68/);
  assert.ok(!/anxious|stress(ed)? disorder|diagnos/i.test(JSON.stringify(t)));
});

test('K05 whyEmpty turns the SDK picture checks into one plain line', () => {
  assert.match(clip.whyEmpty(['TooDark x9'], ''), /too dark/);
  assert.match(clip.whyEmpty(['NoFaceFound x5'], ''), /find your face/);
  assert.match(clip.whyEmpty(['ChestNotVisible x4'], ''), /chest/);
  assert.match(clip.whyEmpty(['MultipleFacesFound x2'], ''), /more than one face/);
  assert.match(clip.whyEmpty(['FrameRateTooLow x7'], ''), /choppy/);
  assert.match(clip.whyEmpty([], ''), /lamp/);
});

test('K06 pickMime prefers mp4, falls back to webm, and reports when nothing is supported', () => {
  assert.deepEqual(clip.pickMime(() => true), { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' });
  assert.deepEqual(clip.pickMime((m) => /webm/.test(m)), { mime: 'video/webm;codecs=vp8', ext: 'webm' });
  assert.equal(clip.pickMime(() => false), null);
});

test('K07 a black picture is told apart from a lit one', () => {
  const black = new Uint8ClampedArray(32 * 24 * 4); for (let i = 3; i < black.length; i += 4) black[i] = 255;
  const lit = new Uint8ClampedArray(32 * 24 * 4).fill(90);
  assert.ok(clip.meanLuma(black) < clip.BLACK_LIMIT);
  assert.ok(clip.meanLuma(lit) > clip.BLACK_LIMIT);
  assert.equal(clip.meanLuma(new Uint8ClampedArray(0)), 0);
});
