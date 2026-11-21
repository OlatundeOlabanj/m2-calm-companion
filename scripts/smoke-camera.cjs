// Tests the camera choice (DroidCam first, a black camera is skipped) in a browser with a pretend Presage SDK and pretend cameras.
// Run: NODE_PATH=$(npm root -g) node scripts/smoke-camera.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html');
const bundle = path.join(__dirname, '..', 'renderer', 'presage.bundle.js');
// The real Presage window code would replace the pretend SDK used here, so it is moved aside while this test runs and put back afterwards.
const aside = bundle + '.real';
const hadReal = fs.existsSync(bundle);
if (hadReal) fs.renameSync(bundle, aside);
fs.writeFileSync(bundle, '');
process.on('exit', () => { try { fs.unlinkSync(bundle); } catch (e) { /* ignore */ } if (hadReal) try { fs.renameSync(aside, bundle); } catch (e) { /* ignore */ } });
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

async function scenario(browser, name, labels, blackIds) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(([labels, blackIds]) => {
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
    const mk = (color) => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48; const g = cv.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 48); setInterval(() => g.fillRect(0, 0, 64, 48), 100); return cv; };
    const lit = mk('#909090'), dark = mk('#000000');
    md.getUserMedia = async (c) => {
      const id = c && c.video && c.video.deviceId && c.video.deviceId.exact;
      if (id) window.__opened.push(id);
      if (c && c.audio) return new MediaStream();
      return (blackIds.includes(id) ? dark : lit).captureStream(5);
    };
  }, [labels, blackIds || []]);
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
  await s.page.waitForSelector('#stage:not([hidden])', { timeout: 8000 });
  check('A: M² opened DroidCam, not the laptop camera', (await s.page.evaluate(() => window.__opened)).slice(-1)[0] === 'id-1');
  check('A: Details lists it too', (await s.page.inputValue('#camSel2')) === 'id-1');
  check('A: no page errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // B: only the laptop camera: it is used on its own, because it shows a picture
  s = await scenario(browser, 'B', ['EasyCamera']);
  check('B: Meet M² is enabled with only the laptop camera', !(await s.page.locator('#startBtn').isDisabled()));
  check('B: the note names the camera it will use', /EasyCamera/.test(await s.page.textContent('#camNote')));
  await s.page.click('#startBtn');
  await s.page.waitForSelector('#stage:not([hidden])', { timeout: 8000 });
  check('B: the laptop camera was opened', (await s.page.evaluate(() => window.__opened)).slice(-1)[0] === 'id-0');
  check('B: no page errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // D: DroidCam is listed but shows black (phone app not connected): M² moves to the laptop camera
  s = await scenario(browser, 'D', ['EasyCamera', 'Droidcam'], ['id-1']);
  check('D: DroidCam is chosen first', (await s.page.inputValue('#camSel')) === 'id-1');
  await s.page.click('#startBtn');
  await s.page.waitForSelector('#stage:not([hidden])', { timeout: 12000 });
  const od = await s.page.evaluate(() => window.__opened); check('D: M² ended up on the laptop camera, which shows a picture', od.slice(-1)[0] === 'id-0', JSON.stringify(od) + ' ' + (await s.page.textContent('#srcNote')));
  check('D: no page errors', s.errors.length === 0, s.errors.join('|'));
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
