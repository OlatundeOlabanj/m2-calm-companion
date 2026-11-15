// Tests the camera choice (DroidCam first) in a browser with a pretend Presage SDK and pretend cameras.
// Run: NODE_PATH=$(npm root -g) node scripts/smoke-camera.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html');
const bundle = path.join(__dirname, '..', 'renderer', 'presage.bundle.js');
const madeStub = !fs.existsSync(bundle);
if (madeStub) fs.writeFileSync(bundle, '');
process.on('exit', () => { if (madeStub) try { fs.unlinkSync(bundle); } catch (e) { /* ignore */ } });
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

async function scenario(browser, name, labels) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((labels) => {
    window.__opened = [];
    window.presageEnv = { available: true, reason: '', apiKey: 'test' };
    window.m2 = { ai: true, tts: async () => [], transcribe: async () => '', chat: async () => 'ok', netTest: async () => [] };
    window.PresageRenderer = {
      breathingMetrics: [], cardioMetrics: [], faceMetrics: [], decodeMetrics: () => ({}),
      SmartSpectraSDK: class { on() {} useMediaStream() {} async start() {} async stop() {} destroy() {} },
    };
    const devs = labels.map((l, i) => ({ kind: 'videoinput', label: l, deviceId: 'id-' + i }));
    const md = navigator.mediaDevices;
    md.enumerateDevices = async () => devs;
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48; canvas.getContext('2d').fillRect(0, 0, 64, 48);
    md.getUserMedia = async (c) => {
      if (c && c.video && c.video.deviceId) window.__opened.push(c.video.deviceId.exact);
      return c && c.audio ? new MediaStream() : canvas.captureStream(5);
    };
  }, labels);
  await page.goto(url);
  await page.check('#consentBox');
  await page.waitForTimeout(500);
  return { page, errors, ctx };
}

(async () => {
  const browser = await chromium.launch();

  // A: DroidCam is connected: it is chosen on its own and used
  let s = await scenario(browser, 'A', ['EasyCamera', 'Droidcam']);
  check('A: DroidCam is selected without asking', (await s.page.inputValue('#camSel')) === 'id-1');
  check('A: Meet M² is enabled', !(await s.page.locator('#startBtn').isDisabled()));
  check('A: the note says the phone camera was found', /Phone camera found/.test(await s.page.textContent('#camNote')));
  await s.page.check('#aiBox');
  await s.page.click('#startBtn');
  await s.page.waitForSelector('#stage:not([hidden])', { timeout: 5000 });
  check('A: M² opened DroidCam, not the laptop camera', (await s.page.evaluate(() => window.__opened)).slice(-1)[0] === 'id-1');
  check('A: Details lists it too', (await s.page.inputValue('#camSel2')) === 'id-1');
  check('A: no page errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // B: only the laptop camera: M² waits for DroidCam, and only uses the laptop camera if you say so
  s = await scenario(browser, 'B', ['EasyCamera']);
  check('B: Meet M² is disabled without DroidCam', await s.page.locator('#startBtn').isDisabled());
  check('B: the note tells you to open DroidCam', /DroidCam/.test(await s.page.textContent('#camNote')));
  check('B: the "use another camera" choice is offered', await s.page.locator('#camAny').isVisible());
  await s.page.click('#camAny');
  check('B: after choosing it, Meet M² is enabled', !(await s.page.locator('#startBtn').isDisabled()));
  await s.page.click('#startBtn');
  await s.page.waitForSelector('#stage:not([hidden])', { timeout: 5000 });
  check('B: the laptop camera was opened only after you chose it', (await s.page.evaluate(() => window.__opened)).slice(-1)[0] === 'id-0');
  check('B: no page errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // C: no camera at all
  s = await scenario(browser, 'C', []);
  check('C: Meet M² stays disabled with no camera', await s.page.locator('#startBtn').isDisabled());
  await s.ctx.close();

  // D: other names a phone camera app may use
  for (const label of ['DroidCam Video', 'Iriun Webcam', 'Dummy video device (0x0000)']) {
    s = await scenario(browser, 'D', ['EasyCamera', label]);
    check('D: "' + label + '" is recognised as the phone camera', (await s.page.inputValue('#camSel')) === 'id-1');
    await s.ctx.close();
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
