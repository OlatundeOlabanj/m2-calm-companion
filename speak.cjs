// Spoken replies without the browser's speech voices (many Linux setups have none).
// Order: Piper (natural, offline, if you installed it), then espeak-ng or espeak (female English voice), then speech-dispatcher.
// The text goes in through stdin, never through a shell, and nothing leaves this computer.
const { spawn } = require('child_process');

function enginesFor(opts = {}) {
  const list = [];
  if (opts.piperModel) {
    list.push({
      pipe: [
        { cmd: opts.piperBin || 'piper', args: ['--model', opts.piperModel, '--output-raw'] },
        { cmd: 'aplay', args: ['-q', '-r', String(opts.piperRate || 22050), '-f', 'S16_LE', '-t', 'raw', '-'] },
      ],
    });
    list.push({
      pipe: [
        { cmd: opts.piperBin || 'piper', args: ['--model', opts.piperModel, '--output-raw'] },
        { cmd: 'paplay', args: ['--raw', '--rate=' + String(opts.piperRate || 22050), '--format=s16le', '--channels=1'] },
      ],
    });
  }
  list.push({ pipe: [{ cmd: 'espeak-ng', args: ['-v', 'en-us+f3', '-s', '165', '-p', '62', '--stdin'] }] });
  list.push({ pipe: [{ cmd: 'espeak', args: ['-v', 'en-us+f3', '-s', '165', '-p', '62', '--stdin'] }] });
  list.push({ pipe: [{ cmd: 'spd-say', args: ['-e', '-w', '-t', 'female1'] }] });
  return list;
}

function createSpeaker(spawnImpl = spawn, opts = {}) {
  const engines = enginesFor(opts);
  let kids = [];
  function stop() { kids.forEach((k) => { try { k.kill(); } catch (e) { /* gone */ } }); kids = []; }

  function run(i, text) {
    return new Promise((resolve) => {
      if (i >= engines.length) return resolve(false);
      const steps = engines[i].pipe;
      let settled = false;
      const fail = () => { if (!settled) { settled = true; stop(); resolve(run(i + 1, text)); } };
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      let procs;
      try {
        procs = steps.map((st, n) => spawnImpl(st.cmd, st.args, { stdio: [n === 0 ? 'pipe' : 'pipe', n === steps.length - 1 ? 'ignore' : 'pipe', 'ignore'] }));
      } catch (e) { return resolve(run(i + 1, text)); }
      kids = procs;
      procs.forEach((p) => p.on('error', fail));
      for (let n = 0; n < procs.length - 1; n++) {
        try { procs[n].stdout.pipe(procs[n + 1].stdin); } catch (e) { return fail(); }
      }
      const last = procs[procs.length - 1];
      last.on('close', (code) => done(code === 0 || code === null));
      try { procs[0].stdin.on('error', () => {}); procs[0].stdin.end(text); } catch (e) { fail(); }
    });
  }
  return {
    speak(text) {
      const t = String(text || '').slice(0, 600);
      if (!t.trim()) return Promise.resolve(false);
      stop();
      return run(0, t);
    },
    stop,
  };
}
module.exports = { createSpeaker, enginesFor };
