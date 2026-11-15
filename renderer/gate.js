/* The send gate. It only ADVISES: it holds the Send button while tension is high,
   then asks for one more read of the message once the body has settled.
   States: open, locked, review. If the signal is poor it pauses and never locks. */
(function (root) {
  const DEFAULTS = {
    lockAt: 55, // tension at or above this...
    lockHold: 3, // ...for this many seconds locks Send
    unlockBelow: 30, // tension below this...
    unlockHold: 8, // ...for this many seconds moves to review
    minQuality: 0.4,
  };

  class Gate {
    constructor(options = {}) {
      this.opt = Object.assign({}, DEFAULTS, options);
      this.state = 'open';
      this.noSignal = false;
      this._high = 0;
      this._low = 0;
    }

    update(tension, dt, quality) {
      if (quality < this.opt.minQuality) {
        this.noSignal = true;
        this._high = 0;
        this._low = 0;
        return this.state;
      }
      this.noSignal = false;

      if (tension >= this.opt.lockAt) {
        this._high += dt;
        this._low = 0;
      } else if (tension < this.opt.unlockBelow) {
        this._low += dt;
        this._high = 0;
      } else {
        // in between: keep what we have, do not build either timer
        this._high = Math.max(0, this._high - dt);
        this._low = Math.max(0, this._low - dt);
      }

      if (this.state === 'open' && this._high >= this.opt.lockHold) {
        this.state = 'locked';
        this._low = 0;
      } else if (this.state === 'locked' && this._low >= this.opt.unlockHold) {
        this.state = 'review';
      } else if (this.state === 'review' && this._high >= this.opt.lockHold) {
        this.state = 'locked';
        this._low = 0;
      }
      return this.state;
    }

    // The person read the message again and confirms.
    confirmReview() {
      if (this.state === 'review') {
        this.state = 'open';
        this._high = 0;
        this._low = 0;
        return true;
      }
      return false;
    }

    // Manual escape, always available: the gate is advice, not a prison.
    override() {
      this.state = 'open';
      this._high = 0;
      this._low = 0;
    }

    get canSend() {
      return this.state === 'open';
    }
  }

  const api = { Gate, GATE_DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
