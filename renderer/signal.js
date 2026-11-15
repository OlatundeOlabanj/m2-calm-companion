/* Signal sources. Both produce { breath, pulse, quality } samples (breaths per min, beats per min).
   SimulatedSource is fake data for demos and tests. SdkSource is a stub until the Presage SDK is wired in. */
(function (root) {
  const SCENARIOS = {
    calm: { breath: 13, pulse: 68 },
    stirred: { breath: 21, pulse: 94 },
  };

  class SimulatedSource {
    constructor() {
      this.scenario = 'calm';
      this.t = 0;
      this.b = SCENARIOS.calm.breath;
      this.p = SCENARIOS.calm.pulse;
      this.quality = 0.9;
      this.label = 'SIMULATED SIGNAL';
    }
    setScenario(name) {
      if (SCENARIOS[name]) this.scenario = name;
    }
    setQuality(q) {
      this.quality = q;
    }
    // dt in seconds (can be scaled by the caller for fast tests)
    tick(dt) {
      this.t += dt;
      const target = SCENARIOS[this.scenario];
      const k = 1 - Math.exp(-dt / 6); // drift towards target over about 6 s
      this.b += (target.breath - this.b) * k;
      this.p += (target.pulse - this.p) * k;
      const wob = (a) => a * Math.sin(this.t * 1.7) * 0.5 + a * Math.sin(this.t * 0.6) * 0.5;
      const stirred = this.scenario === 'stirred';
      return {
        breathing: this.b + wob(0.6), pulse: this.p + wob(1.2), quality: this.quality,
        expression: { type: stirred ? 'angry' : 'neutral', conf: stirred ? 68 : 82, stable: true },
        blinking: false, talking: false, hrv: { rmssd: stirred ? 22 : 48, stable: true, confidence: 70 },
      };
    }
  }

  // Live source: readings arrive from the live camera (Presage SmartSpectra SDK) and tick() returns the latest.
  class SdkSource {
    constructor(bridge) {
      this.label = 'LIVE CAMERA (Presage SmartSpectra)';
      this.latest = { breathing: NaN, pulse: NaN, quality: 0, hint: 'Waiting for the camera' };
      this.stream = null;
      this.error = '';
      bridge.onSample((s) => { this.latest = s; if (s.quality >= 0.4) this.error = ''; });
      bridge.onStatus((s) => { if (s.error) this.error = s.error; });
    }
    tick() {
      return this.latest;
    }
  }

  const api = { SimulatedSource, SdkSource, SCENARIOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
