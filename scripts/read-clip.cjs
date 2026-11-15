// Reads a recorded video clip through the Presage SmartSpectra SDK and prints what it found.
// Run:  node scripts/read-clip.cjs /path/to/clip.mp4
// Options: --rotate180 (turn an upside-down clip first), --delay N (milliseconds between frames, default 8; 0 = as fast as possible), --json (one JSON line per event, used by the app).
// The Presage key comes from PRESAGE_API_KEY in the environment or the .env file. It is never printed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readEnvKey } = require('../env.cjs');
const { readClip, summarize } = require('../reader.cjs');

const args = process.argv.slice(2);
const json = args.includes('--json');
const rotate = args.includes('--rotate180');
const di = args.indexOf('--delay');
const delayMs = di >= 0 ? Number(args[di + 1]) : 8;
const file = args.find((a, i) => !a.startsWith("--") && !(di >= 0 && i === di + 1));
const say = (line) => { if (!json) console.log(line); };
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
// Exit explicitly (after the output is flushed): the SDK's native threads can keep this process alive once the clip is finished.
const exit = (code) => process.stdout.write('', () => process.exit(code));
const fail = (code, message, name) => { if (json) out({ type: 'error', message, name: name || '' }); else console.error('\nFAILED: ' + message); process.exit(code); }; // stops right here (pipes and terminals write synchronously on Linux)

if (!file) fail(4, 'Give the clip file: node scripts/read-clip.cjs /path/to/clip.mp4');
let size = 0;
try { size = fs.statSync(file).size; } catch (e) { fail(4, 'Cannot open the clip file: ' + file); }
const apiKey = readEnvKey(path.join(__dirname, '..'));
if (!apiKey) fail(2, 'No PRESAGE_API_KEY found in the environment or in the .env file.');
let lib;
try { lib = require('@smartspectra/node-sdk'); } catch (e) { fail(3, 'The Presage SDK could not load: ' + e.message); }

const t0 = Date.now();
say('M² clip reader');
say('Clip: ' + path.basename(file) + ' (' + (size / 1048576).toFixed(1) + ' MB)');
say('Reading with a ' + delayMs + ' ms pause between frames. This can take longer than the clip itself on a slow computer.');
let lastShown = -5;
const onEvent = (ev) => {
  if (ev.type !== 'sample') return;
  if (json) { out({ type: 'progress', t: ev.t, count: ev.count }); return; }
  if (ev.t - lastShown >= 5) { lastShown = ev.t; say('  clip time ' + ev.t.toFixed(0) + ' s, readings so far: ' + ev.count); }
};

// Makes an mp4 copy with ffmpeg. Fedora's ffmpeg has no libx264, so it tries libx264, then libopenh264, then mpeg4 (at high quality, because the pulse signal is a very small colour change).
function transcode(src, filter) {
  const dst = path.join(os.tmpdir(), 'm2-clip-conv-' + process.pid + '.mp4');
  const encoders = [
    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14'],
    ['-c:v', 'libopenh264', '-b:v', '16M', '-allow_skip_frames', '0'],
    ['-c:v', 'mpeg4', '-q:v', '2'],
  ];
  for (const enc of encoders) {
    const args = ['-y', '-loglevel', 'error', '-i', src, ...(filter ? ['-vf', filter] : []), '-an', ...enc, '-pix_fmt', 'yuv420p', dst];
    const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
    if (r.status === 0) return dst;
  }
  return '';
}

(async () => {
  let res, converted = '';
  try {
    if (rotate) {
      say('Turning the clip upside down first (--rotate180)...');
      converted = transcode(file, 'hflip,vflip');
      if (!converted) throw new Error('ffmpeg could not make the rotated copy.');
    }
    try { res = await readClip(lib, { apiKey, file: converted || file, delayMs, onEvent }); }
    catch (e) {
      // The SDK could not open this kind of file (for example a webm recording): try once with an mp4 copy made by ffmpeg.
      if (e && (e.code === 7 || e.code === 8) && !converted) {
        say('The SDK could not open this recording as it is. Trying a clean mp4 copy made with ffmpeg...');
        converted = transcode(file);
        if (!converted) throw e;
        res = await readClip(lib, { apiKey, file: converted, delayMs, onEvent });
      } else throw e;
    }
  } catch (e) {
    const names = lib.SmartSpectraErrorCode ? Object.keys(lib.SmartSpectraErrorCode).find((k) => lib.SmartSpectraErrorCode[k] === e.code) : '';
    fail(1, (e && e.message) || 'The clip could not be read.', names || String(e && e.code || ''));
  } finally { if (converted) { try { fs.unlinkSync(converted); } catch (e) { /* gone */ } } }

  const sum = summarize(res.samples);
  const stats = { seconds: (Date.now() - t0) / 1000, peakMB: Math.round(process.resourceUsage().maxRSS / 1024) };
  const vnames = {};
  if (lib.ValidationCode) for (const k of Object.keys(lib.ValidationCode)) vnames[lib.ValidationCode[k]] = k.replace(/^k/, '');
  const checks = Object.entries(res.validation).filter(([c]) => Number(c) !== 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => (vnames[c] || 'code ' + c) + ' x' + n);
  if (json) { out({ type: 'done', summary: sum, stats, checks, hint: res.hint }); exit(0); return; }
  say('\nRESULT');
  say('Readings received: ' + sum.count + ' (with breathing and pulse: ' + sum.good + ')');
  say('Messages carrying: breathing ' + sum.breathingCount + ', pulse ' + sum.pulseCount + ', HRV ' + sum.hrvCount + ', expression ' + sum.exprCount);
  say('Clip time covered: ' + sum.seconds.toFixed(0) + ' s');
  say('Breathing: ' + (Number.isFinite(sum.breathing) ? sum.breathing.toFixed(1) + ' /min' : 'no reading'));
  say('Pulse: ' + (Number.isFinite(sum.pulse) ? Math.round(sum.pulse) + ' bpm' : 'no reading'));
  say('HRV (RMSSD): ' + (sum.hrv ? Math.round(sum.hrv.rmssd) + ' ms' + (sum.hrv.stable ? '' : ' (settling)') : 'no reading'));
  say('Expression: ' + (sum.expression ? sum.expression.type + ' ' + Math.round(sum.expression.conf) + '%' : 'no reading'));
  say('Picture checks the SDK reported: ' + (checks.length ? checks.join(', ') : 'none') + (res.hint ? ' | last hint: ' + res.hint : ''));
  say('Time taken: ' + stats.seconds.toFixed(0) + ' s');
  say('Peak memory of this process: ' + stats.peakMB + ' MB');
  if (!sum.good) say('\nNo breathing and pulse readings came out. Send me this whole output.');
  exit(0);
})();
