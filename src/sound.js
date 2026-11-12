/**
 * Low-latency Web Audio API beeper for eyes-free keyboard switch testing.
 * Uses pure synthesized tones (zero external audio asset dependencies).
 */

export class SoundBeeper {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _ensureContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone(freqHz, durationMs = 55, gainPeak = 0.16, type = "sine", delaySec = 0) {
    if (!this.enabled) return;
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const dur = durationMs / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, now);

    // Smooth attack & exponential release to avoid speaker clicks
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  /**
   * Play feedback when a physical key press is detected.
   * - Matched key on layout: crisp "嘟" (880 Hz)
   * - Unmatched key: lower "咚" (440 Hz)
   */
  beepKey({ matched }) {
    if (!this.enabled) return;
    if (matched) {
      this.playTone(880, 52, 0.16, "sine");
    } else {
      this.playTone(420, 62, 0.13, "triangle");
    }
  }

  /** Play a pleasant two-note chime when 100% of layout keys have been tested. */
  beepCompleted() {
    if (!this.enabled) return;
    this.playTone(880, 75, 0.14, "sine", 0);
    this.playTone(1174.66, 120, 0.16, "sine", 0.08);
  }
}
