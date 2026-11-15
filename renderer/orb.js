/* The M² presence: a living constellation of nodes joined by light.
   It breathes, leans toward your cursor, ripples when you type or speak, runs thoughts along its
   links while it thinks, and changes colour with your tension (teal, amber, soft coral; never alarm red).
   Original design, drawn with the 2D canvas, no libraries. */
(function (root) {
  const TAU = Math.PI * 2;
  const N = 190;

  const PALETTES = {
    founder: [[96, 232, 192], [246, 194, 106], [240, 143, 122]],
    courtship: [[255, 170, 196], [246, 194, 106], [240, 143, 122]],
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  function tensionColor(tension, mode) {
    const p = PALETTES[mode] || PALETTES.founder;
    const t = Math.max(0, Math.min(100, tension)) / 100;
    return t < 0.5 ? mix(p[0], p[1], t / 0.5) : mix(p[1], p[2], (t - 0.5) / 0.5);
  }

  class Orb {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.p = { tension: 0, mode: 'founder', breath: 0, pacing: false, level: 0, listening: false, thinking: false, speaking: false, quality: 1 };
      this.col = [96, 232, 192];
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.ripples = [];
      this.pulses = [];
      this.nextPulse = 0;
      this.pointer = null;
      this.ang = 0;
      this.t = 0;
      this.last = 0;
      this.frameMs = 30;
      this.lit = 0;
      this.breathSm = 0;
      this.levelSm = 0;
      this._build();
      this._events();
      this.resize();
    }

    _build() {
      const nodes = [];
      const ga = Math.PI * (3 - Math.sqrt(5));
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const th = ga * i;
        nodes.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, rf: 0.86 + rnd() * 0.28, ph: rnd() * TAU, sz: 0.7 + rnd() * 0.9, sx: 0, sy: 0, d: 0, glow: 0 });
      }
      this.nodes = nodes;
      // each node links to its 3 nearest neighbours on the sphere
      const edges = new Set();
      for (let i = 0; i < N; i++) {
        const ds = [];
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z;
          ds.push([dx * dx + dy * dy + dz * dz, j]);
        }
        ds.sort((a, b) => a[0] - b[0]);
        for (let k = 0; k < 3; k++) edges.add(Math.min(i, ds[k][1]) + ':' + Math.max(i, ds[k][1]));
      }
      this.edges = [...edges].map((s) => s.split(':').map(Number));
    }

    _events() {
      const cv = this.cv;
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('pointermove', (e) => { this.pointer = { x: e.clientX, y: e.clientY }; });
      window.addEventListener('pointerleave', () => { this.pointer = null; });
      cv.addEventListener('pointerdown', (e) => this.ripple(1, e.clientX, e.clientY));
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.cv.width = Math.round(this.w * dpr);
      this.cv.height = Math.round(this.h * dpr);
      this.cv.style.width = this.w + 'px';
      this.cv.style.height = this.h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cx = this.w / 2;
      this.cy = this.h * 0.33;
      this.R = Math.max(90, Math.min(this.w * 0.28, this.h * 0.235));
    }

    set(patch) { Object.assign(this.p, patch); }

    // Draw rate cap in milliseconds per frame: 30 is about 30 fps. Heavy phases (recording, reading a clip) use a larger number to leave the processor free.
    setFrameMs(ms) { this.frameMs = Math.max(16, ms | 0); }

    // a wave of light leaving the centre (or a point)
    ripple(strength = 1) { this.ripples.push({ t0: this.t, s: strength }); if (this.ripples.length > 6) this.ripples.shift(); }

    start() {
      const loop = (now) => { if (!this._drawn || now - this._drawn >= this.frameMs) { this._drawn = now; this.frame(now); } this._raf = requestAnimationFrame(loop); };
      this._raf = requestAnimationFrame(loop);
    }

    frame(now) {
      const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
      this.last = now;
      const slow = this.reduced ? 0.25 : 1;
      this.t += dt;
      const p = this.p;
      const ctx = this.ctx;
      const tens = p.tension / 100;

      // smooth inputs so nothing ever jumps
      const target = tensionColor(p.tension, p.mode);
      for (let i = 0; i < 3; i++) this.col[i] += (target[i] - this.col[i]) * Math.min(1, dt * 2.2);
      this.breathSm += ((p.pacing ? p.breath : 0.5 + 0.5 * Math.sin(this.t * 0.9) * 0.15) - this.breathSm) * Math.min(1, dt * 4);
      this.levelSm += (p.level - this.levelSm) * Math.min(1, dt * 10);

      const speed = (0.12 + 0.1 * tens + (p.thinking ? 0.5 : 0)) * slow;
      this.ang += dt * speed;
      const ca = Math.cos(this.ang), sa = Math.sin(this.ang), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
      const R = this.R * (1 + 0.16 * (p.pacing ? this.breathSm : this.breathSm * 0.25));
      const wob = (0.008 + 0.03 * Math.pow(tens, 1.5)) * slow;
      const wobSpeed = 1.2 + 2.5 * tens;
      const [r, g, b] = this.col.map(Math.round);
      const rgba = (a) => 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';

      ctx.clearRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';

      // ambient glow
      const gl = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, R * 2.1);
      gl.addColorStop(0, rgba(0.2 + 0.1 * this.levelSm));
      gl.addColorStop(0.45, rgba(0.06));
      gl.addColorStop(1, rgba(0));
      ctx.fillStyle = gl;
      ctx.fillRect(0, 0, this.w, this.h);

      // project nodes
      const px = this.pointer ? this.pointer.x : -9999, py = this.pointer ? this.pointer.y : -9999;
      const near = [];
      this.ripples = this.ripples.filter((rp) => this.t - rp.t0 < 1.8);
      let lit = 0;
      for (const n of this.nodes) {
        // rotate around Y then tilt around X
        let x = n.x * ca + n.z * sa, z = -n.x * sa + n.z * ca, y = n.y;
        const y2 = y * ct - z * st, z2 = y * st + z * ct;
        y = y2; z = z2;
        let rad = n.rf * (1 + wob * Math.sin(this.t * wobSpeed + n.ph) + this.levelSm * 0.16 * Math.sin(this.t * 9 + n.ph * 3) * (p.listening || p.speaking ? 1 : 0.3));
        const persp = 1 + z * 0.22;
        let sx = this.cx + x * R * rad * persp, sy = this.cy + y * R * rad * persp;
        let glow = 0;
        const dn = Math.hypot(sx - this.cx, sy - this.cy) / R;
        for (const rp of this.ripples) {
          const age = this.t - rp.t0;
          const front = age * 0.95;
          const k = Math.exp(-Math.pow((dn - front) / 0.2, 2)) * rp.s * (1 - age / 1.8);
          if (k > 0.01) { glow += k; const out = 1 + 0.09 * k; sx = this.cx + (sx - this.cx) * out; sy = this.cy + (sy - this.cy) * out; }
        }
        if (p.thinking) glow += 0.12 * (0.5 + 0.5 * Math.sin(this.t * 4 - n.ph * 2));
        const dxp = px - sx, dyp = py - sy, dp = Math.hypot(dxp, dyp);
        if (dp < 150) {
          const k = 1 - dp / 150;
          sx += (dxp / (dp || 1)) * k * 14 * slow;
          sy += (dyp / (dp || 1)) * k * 14 * slow;
          glow += k * 0.7;
          near.push([dp, n]);
        }
        n.sx = sx; n.sy = sy; n.d = (z + 1) / 2; n.glow = Math.min(1.4, glow);
        if (n.glow > 0.25) lit++;
      }
      this.lit = lit;

      // links
      ctx.lineWidth = 1;
      const poorSignal = p.quality < 0.4 ? 0.55 : 1;
      for (const [i, j] of this.edges) {
        const a = this.nodes[i], bn = this.nodes[j];
        const depth = (a.d + bn.d) / 2;
        const al = (0.05 + 0.2 * depth + 0.35 * Math.max(a.glow, bn.glow)) * poorSignal;
        ctx.strokeStyle = rgba(al);
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(bn.sx, bn.sy); ctx.stroke();
      }

      // thoughts travelling along links
      if (p.thinking && this.t > this.nextPulse) { this.pulses.push({ e: (Math.random() * this.edges.length) | 0, t0: this.t, rev: Math.random() < 0.5 }); this.nextPulse = this.t + 0.07; }
      this.pulses = this.pulses.filter((q) => this.t - q.t0 < 0.55);
      for (const q of this.pulses) {
        const [i, j] = this.edges[q.e];
        let u = (this.t - q.t0) / 0.55; if (q.rev) u = 1 - u;
        const a = this.nodes[i], bn = this.nodes[j];
        ctx.fillStyle = rgba(0.9 * (1 - Math.abs(0.5 - u) * 1.2));
        ctx.beginPath(); ctx.arc(lerp(a.sx, bn.sx, u), lerp(a.sy, bn.sy, u), 2.2, 0, TAU); ctx.fill();
      }

      // nodes
      for (const n of this.nodes) {
        const sz = (n.sz * (0.8 + 1.6 * n.d) + n.glow * 2.4) * (1 + 0.5 * this.levelSm * (p.speaking ? 1 : 0));
        ctx.fillStyle = rgba((0.3 + 0.5 * n.d + 0.5 * n.glow) * poorSignal);
        ctx.beginPath(); ctx.arc(n.sx, n.sy, sz, 0, TAU); ctx.fill();
      }

      // tendrils from the nearest nodes to the cursor: M² reaches for you
      near.sort((a, b) => a[0] - b[0]);
      for (const [d, n] of near.slice(0, 5)) {
        ctx.strokeStyle = rgba(0.35 * (1 - d / 150));
        ctx.beginPath(); ctx.moveTo(n.sx, n.sy); ctx.lineTo(px, py); ctx.stroke();
      }

      // core
      const core = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, R * 0.36);
      core.addColorStop(0, rgba(0.55 + 0.25 * this.levelSm));
      core.addColorStop(1, rgba(0));
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, R * 0.36, 0, TAU); ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(240,250,248,0.9)';
      ctx.font = '600 ' + Math.round(R * 0.2) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('M²', this.cx, this.cy + 1);
    }

    stats() { return { nodes: this.nodes.length, edges: this.edges.length, lit: this.lit, color: this.col.map(Math.round), ripples: this.ripples.length }; }
  }

  const api = { Orb, tensionColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
