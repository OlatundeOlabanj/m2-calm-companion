const { contextBridge, ipcRenderer } = require('electron');

// Live camera settings from the main process. The Presage key reaches the window only so the SDK can start; it is never written anywhere.
const env = ipcRenderer.sendSync('presage:env') || { available: false, reason: '', apiKey: '' };
contextBridge.exposeInMainWorld('presageEnv', { available: !!env.available, reason: env.reason || '', apiKey: env.apiKey || '' });

// M² AI and voice bridge. Only text and short voice clips go through here; the Groq key stays in the main process.
const ai = ipcRenderer.sendSync('m2:status') || { ai: false };
contextBridge.exposeInMainWorld('m2', {
  ai: !!ai.ai,
  transcribe: (buf, mime) => ipcRenderer.invoke('m2:transcribe', buf, mime),
  chat: (messages) => ipcRenderer.invoke('m2:chat', messages),
  netTest: () => ipcRenderer.invoke('m2:nettest'),
  tts: (text) => ipcRenderer.invoke('m2:tts', text),
  speak: (text) => ipcRenderer.invoke('m2:speak', text),
  stopSpeak: () => ipcRenderer.send('m2:stopspeak'),
});

// Memory help: what to close, and a watchdog that stops live reading before the computer freezes.
contextBridge.exposeInMainWorld('m2sys', {
  heavy: () => ipcRenderer.invoke('sys:heavy'),
  liveState: (on) => ipcRenderer.send('live:state', !!on),
  onLowMem: (cb) => { ipcRenderer.on('live:lowmem', (_e, mb) => cb(mb)); },
});

// Clip mode bridge. Video goes to the main process only to be read by Presage; the Presage key never reaches the window through here.
const clipStatus = ipcRenderer.sendSync('clip:status') || { available: false, suggest: false };
contextBridge.exposeInMainWorld('m2clip', {
  available: !!clipStatus.available, suggest: !!clipStatus.suggest, cpus: clipStatus.cpus || 0, memGB: clipStatus.memGB || 0,
  pick: () => ipcRenderer.invoke('clip:pick'),
  readPicked: () => ipcRenderer.invoke('clip:read', { source: 'picked' }),
  readRecording: (data, ext) => ipcRenderer.invoke('clip:read', { source: 'recorded', data, ext }),
  cancel: () => ipcRenderer.send('clip:cancel'),
  onEvent: (cb) => { ipcRenderer.on('clip:event', (_e, ev) => cb(ev)); },
});
