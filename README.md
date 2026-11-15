# M²

A calm voice beside you when a message has shaken you. You talk to M² out loud (no typing needed) and it talks back in a female voice. With consent, a camera reads your breathing, pulse, HRV and face (Presage SmartSpectra SDK), so M² can tell when you are tense and help you slow down. M² learns YOUR calm as you go, with no waiting screen. It only advises. Sending any message is always your choice, and M² never touches your messages.

How to use it: tap **Talk with me** (or press Space). M² listens, notices when you stop speaking, answers, and listens again, until you say "stop listening", tap the button, or stay quiet for three turns. If you received a message that upset you, tap **Paste a message**, paste it, and just talk about it. Say "help me reply" and M² offers a short calm reply you can copy or ignore. Press **Light** in a dark room to turn your screen into a lamp. **Details** shows every signal M² sees and everything that leaves the computer.

## What it is for
M² is a wellness companion for the minutes after a message shakes you: you talk it through out loud, M² listens, reflects back what it heard, guides one slow breath at a time, and notices from the camera when your body is settling. Then it helps you decide what to say. It is not therapy and not a medical device: it does not diagnose, treat or monitor anyone, and it says so. If someone says they may hurt themselves or others, it points them to a trusted person or local emergency services.

## Two modes: Live and Clip
Live mode reads your camera continuously. It needs a fast computer: on the 2-core Intel Celeron N4020 with 3.6 GB of memory that M² was built on, the reading engine could not keep up (the camera frame rate collapsed and the system froze). I have not measured where the limit is, so I cannot give a minimum specification.

Clip mode is for slower computers. M² records about a minute of your face into a temporary file (or you choose a clip you already have), then a separate small process reads it with the Presage SDK's file input, one step at a time. The SDK takes the frame rate from the clip's own timestamps, so a clip can be read slower than real time without the live "frame rate too low" failure. The first clip you read while calm becomes your calm; later clips are compared with it, and drive the tension number, the send gate and what M² says. Only one heavy thing runs at a time: recording, then reading, then talking. A reading is held for 15 minutes, then M² asks for a new one. The cost is that the reading arrives about a minute after you sit down, not continuously.

M² offers Clip first when the computer has 2 or fewer cores or 4.5 GB or less of memory. You choose on the first screen.

To test the reader on its own: `node scripts/read-clip.cjs /path/to/clip.mp4` prints the readings, the time taken and the peak memory. The phone's own camera app (or `scrcpy --video-source=camera --record=clip.mp4`) is a light way to make a clip. Videos from the app are mp4 when the browser can record mp4, otherwise webm; if the SDK refuses a webm file the reader makes an mp4 copy with ffmpeg, if ffmpeg is installed.

## Status, honestly
- Tested here: baseline and tension maths, the face-expression nudge, commands, the AI prompt builder (including what it is told so it does not repeat itself and does not talk about a body it cannot see), the Groq client, voice fallbacks and the live-camera logic against MOCKS (90 unit tests, including the clip reader and its process runner against a MOCK of the SDK); the clip mode screens in headless Chromium with a pretend reader and pretend camera; the full screen in headless Chromium with a fake AI bridge and fake microphone; the camera choice (DroidCam first) with pretend cameras; and Presage's REAL renderer SDK code, bundled, running in headless Chromium against a fake camera.
- NOT tested here: the real Presage native backend with a real face, real Groq calls and real speech transcription, a real room's noise level with the silence detector, whether your camera accepts the brightness request, DroidCam itself, and spoken replies on every Linux setup.
- Tested on the 2-core Celeron laptop (14 and 15 Nov 2026): Presage's file reader opened real 60 second mp4 clips from a phone camera, found the face and gave breathing and pulse readings, taking about 2 to 4 minutes and about 480 MB of memory. Two reads of the same clip agreed (14.3 and 13.7 breaths a minute, pulse 79 and 76), and inside the app, Clip mode read the clip and M² spoke the result (about 14 breaths a minute, pulse near 84). Agreement between reads shows the reading is repeatable. It does NOT show it is accurate, because I have not compared it with a medical device. Early clips failed for ordinary reasons: too much motion, too dark, upside down (a phone camera clip may need turning: `node scripts/read-clip.cjs clip.mp4 --rotate180`).
- HRV needs about 60 seconds of settled signal. A 59 second clip never gives it, so use a still clip of 80 to 90 seconds. I have not yet confirmed an HRV value on a real clip.
- Known quirk: on the test laptop the Presage SDK could not open video files inside Electron's built-in runtime ("SmartSpectra input is unavailable"). The same files open fine with a normal Node install, so M² runs the clip reader with the system `node` (it must be on your PATH) when that happens. If the SDK still refuses a file, the reader makes a clean mp4 copy with ffmpeg and tries once more.
- Recording with the laptop's own camera (Read me) is the part I have tested least. The most reliable path on a slow computer is: record a clip with a phone, then choose Use a clip.
- Presage needs to see your face AND chest, in decent light. "Chest not visible" and "SmartSpectra processing failed" in Details mean the picture does not show your head and upper chest clearly. Put the camera so your head, shoulders and chest are in frame, with a light in front of you.
- There is no demo or simulated mode. Without the live camera (Presage key and a working camera) M² does not start, and it tells you why. Without a Groq key the AI features are off.
- Not a medical device. No diagnosis, treatment or medical decisions.

## Phone camera (DroidCam)
M² uses the DroidCam phone camera by default, and opens another camera only if you press "Use another camera anyway". It recognises DroidCam, Iriun, EpocCam and a v4l2loopback "Dummy video device".
1. Phone: install DroidCam from the Play Store. Open it and allow camera access. Keep the screen on. It shows an IP address and port (usually 4747).
2. Laptop: connect to the same Wi-Fi as the phone. Start the DroidCam client with that IP and port: `droidcam-cli 192.168.X.X 4747` (use your phone's numbers), or open the DroidCam desktop app. For USB instead: turn on USB debugging, run `adb forward tcp:4747 tcp:4747`, then `droidcam-cli adb 4747`.
3. Start M². Tick the consent box. It should say "Phone camera found". Press Meet M².
4. Put the phone on a stack of books or a stand, at eye level, 50 to 80 cm away, so your head, shoulders and chest are in the picture. Face a lamp or window, not the other way round.

## Demo
The demo video shows Clip mode: a phone-recorded clip is read by Presage inside the app, then M² talks it through by voice. It does not show Live mode, which needs a faster computer than the one I built this on.

## Voice
M² speaks with Groq's Orpheus voice (female voice "hannah"; change it with GROQ_VOICE=autumn or diana in .env). The first time, Groq asks you to accept the model's terms. Until you do, every voice request fails with "requires terms acceptance" and M² falls back to this computer's plain voice, which sounds robotic.
1. Open https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english in a browser, signed in to the account that owns your Groq key.
2. Accept the terms.
3. In M², open Details and press **Test natural voice**. No restart is needed.
Replies are sent to Groq as text for this. Optional offline voice with Piper: install piper and a voice model, then set M2_PIPER_MODEL=/path/to/voice.onnx in .env (and M2_PIPER_RATE if the voice is not 22050 Hz). Untested here.

## Setup (Fedora)
1. Presage key: physiology.presagetech.com. Groq key: console.groq.com.
2. cp .env.example .env, then type the keys in yourself (never commit .env).
3. npm install
4. npm test
5. npm start   (this first bundles Presage's window code, then opens the app)
6. To hear M² without Groq on Linux: sudo dnf install espeak-ng.
7. If the camera picture is black on a laptop whose camera only appears through PipeWire, add M2_PIPEWIRE_CAMERA=1 to .env.
If the window does not open: npx electron --no-sandbox .
Needs Node 22.12+ (SDK requirement) and glibc 2.35+.

## Consent and data handling
- Live mode saves nothing: no video, audio, messages or readings are written to disk.
- Clip mode records about a minute of video into a temporary file in the system temp folder (permissions limited to you), only so Presage can read it, and deletes it as soon as the reading ends, when you cancel, and when M² starts or quits. A clip you choose yourself is read in place and is never copied or deleted. The clip reader runs as a separate process and receives the Presage key by environment, not on its command line. Audio, messages and readings are never written to disk.
- Camera: processed by the Presage SmartSpectra SDK. SDK telemetry is switched off (enableTelemetry false); per Presage's Telemetry and Privacy page, when on it sends only an aggregate session summary and never video frames or measured values. The SDK also keeps an authenticated server session with Presage while it runs (what that carries is not detailed in the docs we read), covered by Presage's Privacy Policy (https://api.physiology.presagetech.com/privacypolicy).
- Microphone: open only while Talk with me is on and M² is not speaking. It closes by itself when you stop talking, when you tap the button, and after three quiet turns. Audio is never written to disk.
- Groq (optional, off unless you tick the box on the first screen): each thing you say is sent as a short voice clip for transcription, then as text for the reply, together with the recent conversation, a few numbers (breathing, your calm, tension, and the expression label with its confidence, only when the camera really has a reading) and the message you pasted, if any. M²'s replies are sent as text so a natural voice can speak them. The Details panel counts everything sent. Never camera frames.
- Network check (Details, on request): a DNS lookup and a HEAD request to Presage's and Groq's servers. No data is sent.
- The Groq key stays in the main process. The Presage key is handed to the window only so the SDK can start (as in Presage's own sample). Neither is written anywhere or committed (.env is git-ignored).

## If something cannot connect
Open Details, press **Check network**. "NOT reachable" for Presage means the camera reading cannot start from this network. The SDK also needs cont-api.physiology.presagetech.com (it downloads its face and expression models and checks usage there). If that name does not resolve, the SDK stays in "not in a valid state" and never reads you. Fix: change this computer's DNS (for example 1.1.1.1 and 8.8.8.8) or use a phone hotspot. Try a phone hotspot. The same check in a terminal: `curl -4 -I -m 15 https://api.physiology.presagetech.com/privacypolicy`.

## Spoken or typed commands
Short phrases can be commands (long, free talk is always a conversation): stop listening, help me reply, breathe with me, calm me down, recalibrate, show details, be quiet, voice on. Anything else goes to the AI.

## Tests
    npm test
    NODE_PATH=$(npm root -g) node scripts/smoke.cjs
    NODE_PATH=$(npm root -g) node scripts/smoke-camera.cjs
    NODE_PATH=$(npm root -g) node scripts/smoke-clip.cjs
(they need Playwright. Only the automated tests use a stand-in signal, switched on by a flag the app itself never sets.)

## Diagrams
Design diagrams (data flow, data model, classes, sequences, use cases, components, send-gate states, deployment) are in docs/diagrams, as Mermaid source plus SVG and PNG images.

## Licence and credit
MIT licence (see LICENSE). Made by TJS Code for the DEV Presage SmartSpectra challenge. Presage SmartSpectra, Groq and Electron belong to their owners.
