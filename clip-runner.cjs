/* Runs the clip reader (scripts/read-clip.cjs) as a separate process and passes its progress on.
   Kept apart from main.cjs so it can be tested without Electron. */
'use strict';
const { spawn } = require('child_process');

function createClipRunner({ script, electronPath, spawnImpl }) {
  const doSpawn = spawnImpl || spawn;
  let child = null;
  const api = {
    busy: () => !!child,
    kill() { if (child) { try { child.kill(); } catch (e) { /* already ended */ } } },
    // runtime: 'electron' runs this app's own Node, anything else is the command to run (for example 'node').
    run(file, key, runtime, onEvent) {
      return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env, { PRESAGE_API_KEY: key }); // the key goes to the child by environment, never on the command line
        let cmd = runtime;
        if (runtime === 'electron') { cmd = electronPath; env.ELECTRON_RUN_AS_NODE = '1'; }
        let c;
        try { c = doSpawn(cmd, [script, file, '--json', '--delay', '8'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { reject(Object.assign(new Error('Could not start the reader: ' + e.message), { exitCode: 3 })); return; }
        child = c;
        let buf = '', errText = '', done = null, failed = null, settled = false;
        // Once the result has arrived we do not wait for the process to exit (the SDK's native threads can keep it alive): answer now and stop it shortly after.
        const finishNow = () => { if (settled) return; settled = true; if (child === c) child = null; resolve(done); const k = setTimeout(() => { try { c.kill(); } catch (e) { /* ended */ } }, 2000); if (k.unref) k.unref(); };
        c.stdout.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
            if (ev.type === 'done') { done = ev; finishNow(); } else if (ev.type === 'error') failed = ev; else onEvent(ev);
          }
        });
        c.stderr.on('data', (d) => { errText = (errText + d).slice(-2000); });
        c.on('error', (e) => { if (child === c) child = null; if (settled) return; settled = true; reject(Object.assign(new Error('Could not start the reader: ' + e.message), { exitCode: 3 })); });
        c.on('close', (code, sig) => {
          if (child === c) child = null;
          if (settled) return;
          settled = true;
          if (done) resolve(done);
          else if (sig) reject(Object.assign(new Error('The reading was stopped.'), { exitCode: -1 }));
          else reject(Object.assign(new Error((failed && failed.message) || errText.trim().split('\n').pop() || 'The reader stopped without a result.'), { reason: (failed && failed.name) || '', exitCode: code, sdkName: failed && failed.name }));
        });
      });
    },
    // Presage's servers sometimes drop a request on a slow connection (seen on the real laptop), so a network failure is tried again a couple of times.
    async runRetrying(file, key, runtime, onEvent, opts) {
      const retries = opts && opts.retries != null ? opts.retries : 4;
      const delayMs = opts && opts.delayMs != null ? opts.delayMs : 5000;
      for (let attempt = 0; ; attempt++) {
        try { return await api.run(file, key, runtime, onEvent); }
        catch (e) {
          const network = e && (e.reason === 'kNetworkError' || /network/i.test(e.message || ''));
          if (!network || attempt >= retries || /stopped/i.test(e.message || '')) throw e;
          onEvent({ type: 'retry', n: attempt + 1, of: retries });
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    },
  };
  return api;
}
module.exports = { createClipRunner };
