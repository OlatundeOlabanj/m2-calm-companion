/* Baseline and tension score. Pure functions, no browser or Electron needed.
   Tension is how far breathing rate and pulse sit above THIS person's own calm baseline.
   It is not an emotion label and not a medical measure. */
(function (root) {
  const MIN_SAMPLES = 10;
  const SCALE_FLOOR = { breathing: 1.5, pulse: 3 };

  function median(values) {
    const a = values.slice().sort((x, y) => x - y);
    if (a.length === 0) return NaN;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function mad(values) {
    const m = median(values);
    return median(values.map((v) => Math.abs(v - m)));
  }

  // samples: [{breathing, pulse}] collected while the person sits calmly.
  function makeBaseline(samples) {
    const good = samples.filter((s) => Number.isFinite(s.breathing) && Number.isFinite(s.pulse));
    if (good.length < MIN_SAMPLES) return null;
    const b = good.map((s) => s.breathing);
    const p = good.map((s) => s.pulse);
    return {
      breathing: median(b),
      pulse: median(p),
      breathingScale: Math.max(mad(b) * 1.4826, SCALE_FLOOR.breathing),
      pulseScale: Math.max(mad(p) * 1.4826, SCALE_FLOOR.pulse),
      samples: good.length,
    };
  }

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  // 0 (at or below your calm level) to 100 (far above it). Only increases count.
  function rawTension(sample, base) {
    if (!base || !Number.isFinite(sample.breathing) || !Number.isFinite(sample.pulse)) return 0;
    const zb = (sample.breathing - base.breathing) / base.breathingScale;
    const zp = (sample.pulse - base.pulse) / base.pulseScale;
    const combined = 0.6 * Math.max(0, zb) + 0.4 * Math.max(0, zp);
    return clamp((combined / 4) * 100, 0, 100);
  }

  class Smoother {
    constructor(alpha = 0.3) {
      this.alpha = alpha;
      this.value = null;
    }
    push(x) {
      this.value = this.value === null ? x : this.value + this.alpha * (x - this.value);
      return this.value;
    }
    reset() {
      this.value = null;
    }
  }

  const api = { median, mad, makeBaseline, rawTension, Smoother, MIN_SAMPLES, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
