// Browser smoke test of the renderer (not Electron). Run: NODE_PATH=$(npm root -g) node scripts/smoke.cjs
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html') + '?speed=20';
const fs = require('fs');
// presage.bundle.js is built when the app starts; the browser test only needs the file to exist.
const bundle = path.join(__dirname, '..', 'renderer', 'presage.bundle.js');
const madeStub = !fs.existsSync(bundle);
if (madeStub) fs.writeFileSync(bundle, '');
process.on('exit', () => { if (madeStub) try { fs.unlinkSync(bundle); } catch (e) { /* ignore */ } });
fs.mkdirSync(path.join(process.cwd(), 'shots'), { recursive: true });
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Fake bridge so the AI paths can be tested without a Groq key. It records what would leave the computer.
  await page.addInitScript(() => {
    window.__sent = { chat: [], audio: [], tts: [] };
    window.__M2_TEST_SOURCE__ = true; // tests only: there is no demo mode in the app
    window.__longReply = false;
    window.m2 = {
      ai: true,
      tts: async (t) => { window.__sent.tts.push(t); return []; },
      transcribe: async (buf) => { window.__sent.audio.push(buf.byteLength); return 'what do you think about him'; },
      chat: async (messages) => {
        window.__sent.chat.push(JSON.stringify(messages));
        const last = messages[messages.length - 1].content;
        if (/write a short, calm, kind reply/i.test(last)) return 'Thanks for telling me. I need a little time, and I will answer you tonight.';
        if (window.__longReply) return 'That is a lot to carry. '.repeat(14);
        return 'Okay, that sounds like a lot. What did he actually write?';
      },
    };
    // The browser's fake microphone only beeps for a few milliseconds, which is correctly not speech.
    // So give the test a microphone that "talks" for 1.6 s after 0.6 s and is silent otherwise.
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (!c || !c.audio) return realGUM(c);
      const ac = new AudioContext(); const o = ac.createOscillator(); o.frequency.value = 220;
      const g = ac.createGain(); g.gain.value = 0; const d = ac.createMediaStreamDestination();
      o.connect(g); g.connect(d); o.start();
      setTimeout(() => { g.gain.value = 0.5; }, 600); setTimeout(() => { g.gain.value = 0; }, 2200);
      return d.stream;
    };
    const synth = { speak(u) { setTimeout(() => u.onend && u.onend(), 50); }, cancel() {}, getVoices() { return []; } };
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });

  await page.goto(url);
  await page.screenshot({ path: 'shots/1_consent.png' });
  check('continue disabled before consent', await page.locator('#startBtn').isDisabled());
  await page.check('#consentBox');
  await page.check('#aiBox');
  await page.click('#startBtn');
  await page.waitForSelector('#stage:not([hidden])', { timeout: 10000 });
  await wait(600);
  check('M² greets you at once', (await page.textContent('#caption')).length > 10);
  await page.waitForFunction(() => __ch.S.base, null, { timeout: 10000 });
  check('M² learned the calm in the background', true);
  check('learning chip hides when done', await page.evaluate(() => document.getElementById('learnChip').hidden));

  // nothing left over from the old versions
  const gone = ['#simPanel', '#simCalm', '#simStir', '#simLost', '#demoBtn', '#demoStart', '#sendBtn', '#draft', '#reviewBtn', '#rewriteBtn', '#overrideBtn', '#modeCourt', '#read'];
  check('no simulator, send, draft or review controls exist', (await page.locator(gone.join(',')).count()) === 0);
  const visibleButtons = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()));
  check('only a few buttons are visible on the main screen', visibleButtons.length <= 8, JSON.stringify(visibleButtons));
  check('Talk with me is there', visibleButtons.some((t) => /Talk with me/.test(t)));
  check('source chip says test run', (await page.textContent('#srcChip')).includes('TEST RUN'));
  check('paste box is hidden until asked', await page.evaluate(() => document.getElementById('incomingBox').hidden));

  const st = await page.evaluate(() => __ch.orb.stats());
  check('orb has nodes and links', st.nodes > 100 && st.edges > 200, JSON.stringify(st));
  const px = await page.evaluate(() => { const c = document.getElementById('orb'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 20) n++; return n; });
  check('orb actually draws pixels', px > 200, String(px));
  await page.screenshot({ path: 'shots/3_main.png' });

  // a stirred signal: M² notices and breathes with you (it never talks over a conversation)
  await page.evaluate(() => { __ch.source.setScenario('stirred'); __ch.source.setQuality(0.9); });
  await page.waitForFunction(() => __ch.S.gate.state === 'locked', null, { timeout: 20000 });
  check('a stirred signal is noticed', true);
  await wait(1500);
  const cap = await page.textContent('#caption');
  check('M² speaks with the person own numbers', /breaths a minute/.test(cap), cap);
  check('breathing guide is showing', (await page.textContent('#pace')).includes('breathe'));
  await page.screenshot({ path: 'shots/4_stirred.png' });
  await page.evaluate(() => { __ch.source.setScenario('calm'); __ch.source.setQuality(0.9); });
  await page.waitForFunction(() => __ch.S.gate.state === 'review', null, { timeout: 30000 });
  check('calming is noticed', true);

  // weak signal: M² must say nothing about the body
  await page.evaluate(() => __ch.source.setQuality(0.1));
  await wait(1500);
  await page.fill('#cmdInput', 'I am nervous about this message');
  await page.click('#cmdGo');
  await page.waitForFunction(() => document.getElementById('caption').textContent.includes('sounds like a lot'), null, { timeout: 5000 });
  check('free text goes to the AI and the reply shows', true);
  const sentWeak = await page.evaluate(() => window.__sent.chat.slice(-1)[0]);
  check('with no camera reading the AI is told so, and gets no numbers', /no reading right now/.test(sentWeak) && !/Tension \d/.test(sentWeak) && !/breathing now/.test(sentWeak));
  await page.evaluate(() => { __ch.source.setScenario('calm'); __ch.source.setQuality(0.9); });
  await wait(1500);
  await page.fill('#cmdInput', 'he keeps ignoring me');
  await page.click('#cmdGo');
  await page.waitForFunction(() => window.__sent.chat.length >= 2, null, { timeout: 5000 });
  await wait(300);
  const sentOk = await page.evaluate(() => window.__sent.chat.slice(-1)[0]);
  check('with a good reading the AI gets the numbers', /breathing now/.test(sentOk), sentOk.slice(0, 80));
  check('the AI is shown what M² said before, so it can avoid repeating', /Do not begin with/.test(sentOk));
  check('earlier turns are included', /nervous about this message/.test(sentOk));

  // the message you received
  await page.click('#msgBtn');
  check('Paste a message opens the box', await page.evaluate(() => !document.getElementById('incomingBox').hidden));
  await page.fill('#incoming', 'INCOMING: why did you not call me back?');
  await page.fill('#cmdInput', 'what do I do');
  await page.click('#cmdGo');
  await wait(700);
  const sentInc = await page.evaluate(() => window.__sent.chat.slice(-1)[0]);
  check('the message you received is part of the talk', /INCOMING: why did you not call me back/.test(sentInc));

  // help me reply: a reply card with Copy
  await page.fill('#cmdInput', 'help me reply');
  await page.click('#cmdGo');
  await page.waitForSelector('#suggest:not([hidden])', { timeout: 5000 });
  check('a reply is offered with Copy', (await page.textContent('#suggestText')).includes('little time'));
  await page.screenshot({ path: 'shots/6_reply.png' });
  await page.click('#copySuggest');
  // The card closes after the (asynchronous) clipboard write, so wait for it instead of checking at once.
  check('copying closes the reply card', await page.waitForFunction(() => document.getElementById('suggest').hidden, null, { timeout: 4000 }).then(() => true, () => false));
  check('the reply was copied', (await page.evaluate(() => navigator.clipboard.readText())).includes('little time'));

  // a long reply must never overlap the controls
  await page.evaluate(() => { window.__longReply = true; });
  await page.fill('#cmdInput', 'tell me more');
  await page.click('#cmdGo');
  await wait(1500);
  const geo = await page.evaluate(() => { const c = document.getElementById('caption').getBoundingClientRect(); const m = document.getElementById('micBtn').getBoundingClientRect(); return { capBottom: c.bottom, micTop: m.top }; });
  check('a long reply does not overlap the Talk button', geo.capBottom <= geo.micTop + 1, JSON.stringify(geo));
  await page.screenshot({ path: 'shots/7_long.png' });
  await page.evaluate(() => { window.__longReply = false; });

  // hands-free talk: tap once, it listens, hears you stop, sends the clip, answers, and listens again
  await page.click('#micBtn');
  await wait(1500);
  check('talk mode shows listening state', await page.evaluate(() => document.getElementById('micBtn').classList.contains('rec')));
  await page.screenshot({ path: 'shots/8_listening.png' });
  await page.waitForFunction(() => window.__sent.audio.length >= 1, null, { timeout: 20000 });
  check('voice clip was sent after you stopped talking, and counted', (await page.evaluate(() => __ch.S.count.voice)) >= 1);
  await page.waitForFunction(() => /You said|sounds like a lot|Listening/.test(document.getElementById('caption').textContent + document.getElementById('capsub').textContent), null, { timeout: 8000 });
  check('the voice reply was requested for speaking', true);
  await page.click('#micBtn');
  await wait(1500);
  check('tapping again stops talk mode', await page.evaluate(() => !__ch.S.talking));
  check('mic closed after stopping (no live stream)', await page.evaluate(() => !__ch.voice.stream));

  // details
  await page.click('#detailsBtn');
  await wait(1200);
  const dtxt = await page.textContent('#details');
  check('details show expression, HRV and talking', /Expression/.test(dtxt) && /HRV/.test(dtxt) && /Talking/.test(dtxt));
  check('details say where data goes', /Video saved/.test(dtxt) && /never/.test(dtxt) && /Presage telemetry/.test(dtxt));
  check('details have the voice test and network check', /Test natural voice/.test(dtxt) && /Check network/.test(dtxt));
  await page.screenshot({ path: 'shots/9_details.png' });

  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
