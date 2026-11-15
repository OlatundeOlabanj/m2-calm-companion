// Tests clip mode (record or choose a clip, read it, hold the reading) in a browser with a pretend Presage reader and a pretend camera.
// Run: NODE_PATH=$(npm root -g) node scripts/smoke-clip.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html') + '?speed=20&clipsec=3';
const bundle = path.join(__dirname, '..', 'renderer', 'presage.bundle.js');
const madeStub = !fs.existsSync(bundle);
if (madeStub) fs.writeFileSync(bundle, '');
process.on('exit', () => { if (madeStub) try { fs.unlinkSync(bundle); } catch (e) { /* ignore */ } });
fs.mkdirSync(path.join(process.cwd(), 'shots'), { recursive: true });
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__calls = { read: [], picked: 0, cancel: 0, sdkBuilt: 0 };
    window.__results = [];
    window.presageEnv = { available: true, reason: '', apiKey: 'test' };
    window.m2 = { ai: false };
    window.PresageRenderer = {
      breathingMetrics: [], cardioMetrics: [], faceMetrics: [], decodeMetrics: () => ({}),
      SmartSpectraSDK: class { constructor() { window.__calls.sdkBuilt++; } on() {} useMediaStream() {} async start() {} async stop() {} destroy() {} },
    };
    const sum = (b, p, good) => ({ summary: { count: good, good, seconds: 40, breathing: b, pulse: p, hrv: null, expression: { type: 'neutral', conf: 70, stable: true }, series: Array.from({ length: good }, (_, i) => ({ breathing: b + (i % 3) * 0.2, pulse: p + (i % 2) }) ) }, stats: {}, checks: [], hint: '' });
    window.__next = [sum(14, 68, 40)];
    let cb = null;
    window.m2clip = {
      available: true, suggest: true, cpus: 2, memGB: 3.6,
      pick: async () => { window.__calls.picked++; return { name: 'my clip.mp4' }; },
      readRecording: async (data, ext) => { window.__calls.read.push({ bytes: data.byteLength, ext, isAB: data instanceof ArrayBuffer }); for (let i = 1; i <= 3; i++) { if (cb) cb({ type: 'progress', t: i * 3, count: i * 4 }); await new Promise((r) => setTimeout(r, 150)); } const r = window.__next.shift(); if (r instanceof Error) throw r; return r; },
      readPicked: async () => { if (window.__slow) await new Promise((x) => setTimeout(x, 700)); const r = window.__next.shift(); if (r instanceof Error) throw r; return r; },
      cancel: () => { window.__calls.cancel++; },
      onEvent: (f) => { cb = f; },
    };
    window.__mk = sum;
    const devs = [{ kind: 'videoinput', label: 'Dummy video device (0x0000)', deviceId: 'cam-1' }];
    const md = navigator.mediaDevices;
    md.enumerateDevices = async () => devs;
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
    const g = canvas.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 9 % 360) + ',60%,50%)'; g.fillRect(0, 0, 160, 120); }, 50);
    md.getUserMedia = async (c) => (c && c.audio ? new MediaStream() : canvas.captureStream(15));
  });
  await page.goto(url);

  // consent screen
  check('mode choice is shown and Clip is preselected on a slow computer', !(await page.evaluate(() => document.getElementById('modeRow').hidden)) && await page.isChecked('#modeClip'));
  check('the clip privacy line is shown', !(await page.evaluate(() => document.getElementById('clipPrivacy').hidden)));
  await page.check('#modeLive');
  check('choosing Live hides the clip privacy line', await page.evaluate(() => document.getElementById('clipPrivacy').hidden));
  await page.check('#modeClip');
  await page.check('#consentBox');
  await page.waitForTimeout(400);
  check('Meet M² is enabled', !(await page.evaluate(() => document.getElementById('startBtn').disabled)));
  await page.click('#startBtn');
  await page.waitForSelector('#stage:not([hidden])', { timeout: 8000 });
  check('clip mode chip, Read me and Use a clip are shown', (await page.textContent('#srcChip')) === 'CLIP MODE' && !(await page.evaluate(() => document.getElementById('readBtn').hidden)) && !(await page.evaluate(() => document.getElementById('importBtn').hidden)));
  check('the live engine was never built or started', (await page.evaluate(() => window.__calls.sdkBuilt)) === 0);
  check('the calm chip says no reading yet', (await page.textContent('#learnChip')).includes('NO CALM READING'));
  check('Details say a temporary clip, not "never"', /temporary clip/.test(await page.textContent('#vVideoSaved')));
  await page.waitForTimeout(1500); // with speed 20 many seconds pass: M² must not complain about a missing signal
  check('no "cannot read you" nagging before any clip', !/read you|signal|camera/i.test(await page.textContent('#caption')), await page.textContent('#caption'));

  // first clip: record
  await page.click('#readBtn');
  await page.waitForSelector('#clipPanel:not([hidden])');
  check('Read me shows the camera preview and waits for Start', !(await page.evaluate(() => document.getElementById('clipPreview').hidden)) && (await page.textContent('#clipGo')) === 'Start recording');
  check('nothing is recorded before Start', (await page.evaluate(() => window.__calls.read.length)) === 0);
  await page.screenshot({ path: 'shots/K1_ready.png' });
  await page.click('#clipGo');
  check('recording shows a countdown', /seconds to go|Recording/.test(await page.textContent('#clipTitle') + await page.textContent('#clipHint')));
  await page.waitForFunction(() => /Reading/.test(document.getElementById('clipTitle').textContent), null, { timeout: 15000 });
  check('after recording the camera preview is closed', await page.evaluate(() => document.getElementById('clipPreview').hidden && !document.getElementById('clipPreview').srcObject));
  await page.screenshot({ path: 'shots/K2_reading.png' });
  await page.waitForFunction(() => document.getElementById('clipPanel').hidden, null, { timeout: 15000 });
  const call = await page.evaluate(() => window.__calls.read[0]);
  check('the recording was handed over as bytes (ArrayBuffer) with a file type', call && call.isAB && call.bytes > 500 && /mp4|webm/.test(call.ext), JSON.stringify(call));
  check('your calm was learned from the clip', await page.evaluate(() => !!__ch.S.base && Math.abs(__ch.S.base.breathing - 14.2) < 0.5));
  check('M² says it has your calm', /have your calm/.test(await page.textContent('#caption')), await page.textContent('#caption'));
  check('the calm chip is hidden', await page.evaluate(() => document.getElementById('learnChip').hidden));
  await page.waitForTimeout(800);
  check('a calm reading keeps tension low and the gate open', await page.evaluate(() => __ch.S.tension < 30 && __ch.S.gate.state === 'open'), await page.evaluate(() => String(__ch.S.tension)));

  // second clip: a tense reading, imported
  await page.evaluate(() => { window.__next = [window.__mk(24, 102, 40)]; });
  await page.click('#importBtn');
  await page.waitForFunction(() => document.getElementById('clipPanel').hidden && window.__calls.picked === 1, null, { timeout: 10000 });
  check('a chosen clip is read without recording', (await page.evaluate(() => window.__calls.read.length)) === 1);
  check('M² says the body looks tense and compares with your calm', /tense/.test(await page.textContent('#caption')) && /your calm/.test(await page.textContent('#capsub')), await page.textContent('#caption') + ' | ' + await page.textContent('#capsub'));
  await page.waitForFunction(() => __ch.S.gate.state === 'locked', null, { timeout: 10000 });
  check('a tense reading locks the send gate', true);
  await page.screenshot({ path: 'shots/K3_tense.png' });

  // a clip with no usable reading
  await page.evaluate(() => { window.__next = [{ summary: { count: 2, good: 0, seconds: 5, breathing: NaN, pulse: NaN, series: [] }, stats: {}, checks: ['TooDark x9'], hint: 'Too dark' }]; });
  await page.click('#importBtn');
  await page.waitForFunction(() => document.getElementById('clipPanel').hidden && window.__calls.picked === 2, null, { timeout: 10000 });
  check('an unreadable clip is explained in one line and the old reading is kept', /could not read/.test(await page.textContent('#caption')) && /too dark/.test(await page.textContent('#capsub')) && await page.evaluate(() => __ch.S.clipRead === true));

  // the reader fails
  await page.evaluate(() => { window.__next = [new Error("Error invoking remote method 'clip:read': Error: Cannot open the clip file")]; });
  await page.click('#importBtn');
  await page.waitForFunction(() => document.getElementById('clipPanel').hidden && window.__calls.picked === 3, null, { timeout: 10000 });
  check('a reader failure is shown plainly and M² is free again', /could not read/.test(await page.textContent('#caption')) && /Cannot open the clip file/.test(await page.textContent('#capsub')) && await page.evaluate(() => __ch.S.heavy === false));

  // Cancel while reading calls the reader's cancel exactly once
  await page.evaluate(() => { window.__slow = true; window.__next = [window.__mk(14, 68, 40)]; });
  await page.click('#importBtn');
  await page.waitForSelector('#clipPanel:not([hidden])');
  await page.click('#clipCancel');
  await page.waitForFunction(() => document.getElementById('clipPanel').hidden, null, { timeout: 10000 });
  check('Cancel during reading reaches the reader once', (await page.evaluate(() => window.__calls.cancel)) === 1);
  // a later clip must not be cancelled by the old click handler
  await page.evaluate(() => { window.__slow = false; window.__next = [window.__mk(14, 68, 40)]; });
  await page.click('#importBtn');
  await page.waitForFunction(() => document.getElementById('clipPanel').hidden, null, { timeout: 10000 });
  check('an earlier Cancel does not cancel the next reading', (await page.evaluate(() => window.__calls.cancel)) === 1);

  // recalibrate in clip mode
  await page.fill('#cmdInput', 'recalibrate');
  await page.click('#cmdGo');
  await page.waitForTimeout(300);
  check('"recalibrate" asks for a new clip and clears the calm', await page.evaluate(() => __ch.S.base === null && __ch.S.clipRead === false));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  if (fails) { console.log('\n' + fails + ' check(s) failed'); process.exit(1); }
  console.log('\nAll clip mode checks passed');
})();
