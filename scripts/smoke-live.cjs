// Runs the REAL Presage renderer SDK (bundled) inside the page against a fake main process and a fake camera.
// Needs: npm install (so node_modules has the SDK), npm run build, and Playwright. Run: NODE_PATH=$(npm root -g) node scripts/smoke-live.cjs
const { chromium } = require('playwright');
const path = require('path');
const root = path.join(__dirname, '..');
const { Metrics } = require(require.resolve('@smartspectra/node-sdk/messages', { paths: [root] }));
const buf = Buffer.from(Metrics.encode(Metrics.create({ breathing: { rate: [{ timestamp: 1000000, value: 14.2 }] }, cardio: { pulseRate: [{ timestamp: 1000000, value: 71 }] } })).finish()).toString('base64');
const base = 'file://' + path.join(root, 'renderer', 'index.html') + '?speed=20';
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

async function run(mode, fn) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ mode, buf }) => {
    window.presageEnv = { available: true, reason: '', apiKey: 'test-key' };
    window.__posted = [];
    let cb = null;
    window.__smartspectraBridge = {
      diagnostics: false, attach() {}, close() {},
      onMessage(f) { cb = f; },
      postMessage(msg) {
        window.__posted.push(msg.kind);
        if (msg.replyId) {
          const bad = mode === 'failstart' && msg.kind === 'start';
          setTimeout(() => cb({ kind: 'ack', replyId: msg.replyId, ok: !bad, payload: {}, error: { message: 'SmartSpectra input is unavailable.' } }), 0);
        }
        if (msg.kind === 'start' && mode !== 'failstart') {
          setTimeout(() => cb({ kind: 'processingStatus', status: 2 }), 20);
          setInterval(() => {
            cb({ kind: 'validationStatus', code: mode === 'noface' ? 1 : 0, timestampUs: 1 });
            if (mode === 'good') cb({ kind: 'metrics', buffer: Uint8Array.from(atob(buf), (c) => c.charCodeAt(0)).buffer, timestampUs: 1 });
          }, 400);
        }
      },
    };
  }, { mode, buf });
  await page.goto(base);
  await fn(page);
  check(mode + ': no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

(async () => {
  await run('good', async (page) => {
    check('good: live camera chip', (await page.textContent('#srcChip')).includes('LIVE'));
    await page.check('#consentBox');
    await page.click('#startBtn');
    await page.waitForFunction(() => !document.getElementById('preview').hidden, null, { timeout: 8000 });
    check('good: camera preview appears', true);
    await page.waitForSelector('#stage:not([hidden])', { timeout: 15000 });
    await page.waitForFunction(() => __ch.S.base, null, { timeout: 15000 });
    check('good: M² learns your calm in the background with the real SDK path', true);
    const s = await page.evaluate(() => ({ b: __ch.S.base && __ch.S.base.breathing, kinds: window.__posted }));
    check('good: baseline from decoded metrics (14.2)', s.b && Math.abs(s.b - 14.2) < 0.2, JSON.stringify(s));
    check('good: SDK sent configure and start', s.kinds.includes('configure') && s.kinds.includes('start'), s.kinds.join(','));
    check('good: camera frames are being sent', (await page.evaluate(() => window.__posted.filter((k) => k === 'frame').length)) > 0);
    await page.fill('#cmdInput', 'typing works');
    check('good: typing works at once', (await page.inputValue('#cmdInput')) === 'typing works');
    await page.click('#detailsBtn');
    check('good: Details opens', !(await page.evaluate(() => document.getElementById('details').hidden)));
    await page.screenshot({ path: 'shots/L1_live_main.png' });
  });

  await run('failstart', async (page) => {
    await page.check('#consentBox');
    await page.click('#startBtn');
    await page.waitForFunction(() => /Camera could not start/.test(document.getElementById('srcNote').textContent), null, { timeout: 8000 });
    check('failstart: error shown, and the app does not fake a signal', (await page.evaluate(() => !document.getElementById('consent').hidden)) && (await page.locator('#demoStart, #demoBtn').count()) === 0);
  });

  await run('noface', async (page) => {
    await page.check('#consentBox');
    await page.click('#startBtn');
    await page.waitForSelector('#help:not([hidden])', { timeout: 20000 });
    check('noface: the hint is shown right on the main screen', /find your face/.test(await page.textContent('#helpText')), await page.textContent('#helpText'));
    check('noface: camera picker is offered', (await page.locator('#camSel2').count()) === 1);
    await page.fill('#cmdInput', 'I can still type');
    await page.screenshot({ path: 'shots/L2_noface.png' });
  });
  process.exit(fails ? 1 : 0);
})();
