const { app, BrowserWindow, session, ipcMain, net, dialog } = require('electron');
const dns = require('dns');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const { readEnvKey } = require('./env.cjs');
const { createGroq } = require('./groq.cjs');
const { createSpeaker } = require('./speak.cjs');
const { createClipRunner } = require('./clip-runner.cjs');

let win = null;
let groq = null;
const piperModelRaw = readEnvKey(__dirname, 'M2_PIPER_MODEL');
const speaker = createSpeaker(undefined, {
  piperModel: piperModelRaw ? path.resolve(__dirname, piperModelRaw) : '',
  piperBin: readEnvKey(__dirname, 'M2_PIPER_BIN') || 'piper',
  piperRate: Number(readEnvKey(__dirname, 'M2_PIPER_RATE')) || 22050,
});
let live = { available: false, reason: '', apiKey: '' };
let bindIpc = null;
let sdkPreload = '';

// Some Linux laptops expose the camera only through PipeWire (their /dev/video0 offers only YU12). Opt in with M2_PIPEWIRE_CAMERA=1 in .env.
if (process.platform === 'linux' && readEnvKey(__dirname, 'M2_PIPEWIRE_CAMERA') === '1') app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCamera');

process.on('uncaughtException', (e) => console.error('[M2] uncaught:', e && e.message));
process.on('unhandledRejection', (e) => console.error('[M2] unhandled:', e && e.message));

// The Presage SDK runs in the window and the main process runs its native part (Presage's documented Electron setup).
function setupSdk() {
  const apiKey = readEnvKey(__dirname);
  if (!apiKey) { live = { available: false, reason: 'No PRESAGE_API_KEY found in .env.', apiKey: '' }; return; }
  try {
    bindIpc = require('@smartspectra/node-sdk/main').bindSmartSpectraIpc;
    sdkPreload = require.resolve('@smartspectra/node-sdk/preload');
    live = { available: true, reason: '', apiKey };
  } catch (e) {
    live = { available: false, reason: 'The Presage SDK could not load: ' + e.message, apiKey: '' };
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#0f1722',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (live.available) bindIpc(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; speaker.stop(); });
}

// ---- M² cloud AI (Groq). Optional. The key stays here in the main process.
const MAX_AUDIO = 5 * 1024 * 1024;
ipcMain.on('m2:status', (e) => { e.returnValue = { ai: !!groq }; });
ipcMain.handle('m2:transcribe', async (_e, buf, mime) => {
  if (!groq) throw new Error('AI is off');
  if (!(buf instanceof ArrayBuffer) || buf.byteLength > MAX_AUDIO) throw new Error('Audio too large');
  return groq.transcribe(Buffer.from(buf), typeof mime === 'string' ? mime : 'audio/webm');
});
ipcMain.handle('m2:chat', async (_e, messages) => {
  if (!groq) throw new Error('AI is off');
  if (!Array.isArray(messages) || messages.length > 12) throw new Error('Bad request');
  const clean = messages.map((m) => ({ role: ['system', 'user', 'assistant'].includes(m && m.role) ? m.role : 'user', content: String((m && m.content) || '').slice(0, 4500) }));
  return groq.chat(clean);
});
// Chromium's own network stack (uses the system proxy and certificates). Falls back to Node's fetch.
function chromiumFetch(url, init) {
  if (net && typeof net.fetch === 'function') return net.fetch(url, init);
  return fetch(url, init);
}
// Network check: can this app reach the two services it may need? A HEAD request each, through both
// network stacks, plus a DNS lookup. Nothing is sent. Reports the real reason when it fails.
async function probe(fn, url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  try { const r = await fn(url, { method: 'HEAD', signal: ac.signal }); return 'ok ' + r.status; }
  catch (e) { return 'FAIL ' + (e.name === 'AbortError' ? 'timed out' : ((e.cause && (e.cause.code || e.cause.message)) || e.message || 'failed')); }
  finally { clearTimeout(t); }
}
ipcMain.handle('m2:nettest', async () => {
  const targets = [['Presage', 'api.physiology.presagetech.com', 'https://api.physiology.presagetech.com/privacypolicy'], ['Presage models', 'cont-api.physiology.presagetech.com', 'https://cont-api.physiology.presagetech.com/'], ['Groq', 'api.groq.com', 'https://api.groq.com/openai/v1/models']];
  return Promise.all(targets.map(async ([name, host, url]) => {
    const [lookup, chromium, node] = await Promise.all([
      dns.promises.lookup(host).then((r) => 'ok ' + r.address, (e) => 'FAIL ' + (e.code || e.message)),
      probe(chromiumFetch, url),
      probe((u, i) => fetch(u, i), url),
    ]);
    return { name, host, dns: lookup, chromium, node, ok: chromium.startsWith('ok') || node.startsWith('ok') };
  }));
});
ipcMain.handle('m2:tts', async (_e, text) => {
  if (!groq) throw new Error('AI is off');
  const t = String(text || '').slice(0, 700);
  if (!t.trim()) return [];
  const wavs = await groq.speak(t, process.env.GROQ_VOICE || 'hannah');
  return wavs.map((w) => Buffer.from(w));
});
// ---- Clip mode, for slower computers. A short clip of your face is read by Presage in a separate process, one step at a time.
// A clip recorded here is written to a temporary file only while it is read, then deleted. A clip you pick is only read, never copied or deleted.
const TMP_PREFIX = 'm2-clip-';
const MAX_CLIP = 250 * 1024 * 1024;
let pickedClip = '';
function cleanOldClips() {
  try { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(TMP_PREFIX)) { try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch (e) { /* in use or gone */ } } } catch (e) { /* no temp folder access */ }
}
const runner = createClipRunner({ script: path.join(__dirname, 'scripts', 'read-clip.cjs'), electronPath: process.execPath });
ipcMain.on('clip:status', (e) => {
  const gb = os.totalmem() / 1073741824;
  e.returnValue = { available: !!readEnvKey(__dirname), cpus: os.cpus().length, memGB: Math.round(gb * 10) / 10, suggest: os.cpus().length <= 2 || gb <= 4.5 };
});
ipcMain.handle('clip:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a short video of your face', properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  pickedClip = r.filePaths[0];
  return { name: path.basename(pickedClip) };
});
ipcMain.handle('clip:read', async (e, req) => {
  if (runner.busy()) throw new Error('A clip is already being read.');
  const key = readEnvKey(__dirname);
  if (!key) throw new Error('No PRESAGE_API_KEY found in .env.');
  let file = '', owned = false;
  if (req && req.source === 'picked') {
    if (!pickedClip) throw new Error('No clip was chosen.');
    file = pickedClip;
  } else if (req && req.data instanceof ArrayBuffer) {
    if (req.data.byteLength < 1000 || req.data.byteLength > MAX_CLIP) throw new Error('The recording is empty or too large.');
    file = path.join(os.tmpdir(), TMP_PREFIX + crypto.randomBytes(6).toString('hex') + (req.ext === 'webm' ? '.webm' : '.mp4'));
    fs.writeFileSync(file, Buffer.from(req.data), { mode: 0o600 });
    owned = true;
  } else throw new Error('Bad request');
  const send = (ev) => { try { if (!e.sender.isDestroyed()) e.sender.send('clip:event', ev); } catch (x) { /* window closed */ } };
  try {
    try { return await runner.runRetrying(file, key, 'electron', send); }
    catch (err) { if (err.exitCode === 3 || err.exitCode === 127 || err.reason === 'kInputUnavailable') return await runner.runRetrying(file, key, 'node', send); throw err; } // a second runtime: on the real laptop the SDK could not open files inside Electron's node
  } finally {
    if (owned) { try { fs.unlinkSync(file); } catch (x) { /* already gone */ } }
  }
});
ipcMain.on('clip:cancel', () => runner.kill());

// Memory help for slow computers. The list tells the person what to close before a live reading. The watchdog stops the live reading before the computer freezes.
ipcMain.handle('sys:heavy', () => new Promise((resolve) => {
  const freeMB = Math.round(os.freemem() / 1048576);
  if (process.platform !== 'linux') { resolve({ freeMB, procs: [] }); return; }
  require('child_process').execFile('ps', ['-eo', 'rss=,comm=', '--sort=-rss'], { timeout: 4000 }, (err, out) => {
    if (err) { resolve({ freeMB, procs: [] }); return; }
    const sums = {};
    for (const line of String(out).split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!m) continue;
      const name = m[2].trim();
      if (/^(electron|node|npm|ps|bash|sh)$/i.test(name)) continue;
      sums[name] = (sums[name] || 0) + Number(m[1]) / 1024;
    }
    const procs = Object.keys(sums).map((n) => ({ name: n, mb: Math.round(sums[n]) })).filter((x) => x.mb >= 80).sort((a, b) => b.mb - a.mb).slice(0, 6);
    resolve({ freeMB, procs });
  });
}));
const LOW_MEM_MB = Number(readEnvKey(__dirname, 'M2_LOW_MEM_MB')) || 200;
let memTimer = null, memLow = 0;
ipcMain.on('live:state', (_e, on) => {
  clearInterval(memTimer); memLow = 0;
  if (!on) return;
  memTimer = setInterval(() => {
    const free = os.freemem() / 1048576;
    memLow = free < LOW_MEM_MB ? memLow + 1 : 0;
    if (memLow >= 2 && win && !win.isDestroyed()) { win.webContents.send('live:lowmem', Math.round(free)); memLow = -10; }
  }, 2000);
  if (memTimer.unref) memTimer.unref();
});
app.on('before-quit', () => { runner.kill(); cleanOldClips(); });

ipcMain.handle('m2:speak', (_e, text) => speaker.speak(typeof text === 'string' ? text : ''));
ipcMain.on('m2:stopspeak', () => speaker.stop());
ipcMain.on('presage:env', (e) => { e.returnValue = { available: live.available, reason: live.reason, apiKey: live.apiKey }; });

app.whenReady().then(() => {
  // Camera and microphone only, and only for our own bundled page.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    cb(permission === 'media' && url.startsWith('file://'));
  });
  const gk = readEnvKey(__dirname, 'GROQ_API_KEY');
  if (gk) groq = createGroq({ apiKey: gk, fetchImpl: chromiumFetch, model: readEnvKey(__dirname, 'GROQ_MODEL') || undefined });
  cleanOldClips();
  setupSdk();
  if (live.available) {
    // The SDK's own preload bridge runs next to ours.
    try { session.defaultSession.registerPreloadScript({ type: 'frame', filePath: sdkPreload }); }
    catch (e) { session.defaultSession.setPreloads([sdkPreload]); }
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
