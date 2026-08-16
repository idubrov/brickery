// Procedural Web Audio sound effects — 100% synthesized, zero audio assets.
// (spec §4.5 / §6). Runs identically across 2D and 3D render modes.
//
// Lazy AudioContext: nothing is created until the first user gesture calls
// unlock(). Every play method is a no-op until the context exists and the
// system is enabled, so the game can be driven headlessly (tests / SSR)
// without touching the Web Audio API at all.

export default class SoundSystem {
  constructor() {
    this.enabled = true;
    this._ctx = null;
    this._master = null;
    this._noiseBuffer = null;
  }

  // ---- lifecycle ----

  // Create / resume the AudioContext. MUST be called from a user gesture
  // (pointerdown / keydown) so autoplay policies allow playback.
  unlock() {
    if (!this._ensureContext()) return false;
    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return true;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
  }

  isEnabled() {
    return this.enabled;
  }

  _ensureContext() {
    if (this._ctx) return true;
    const AC =
      (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
    if (!AC) return false;
    this._ctx = new AC();
    this._master = this._ctx.createGain();
    this._master.gain.value = 0.6;
    this._master.connect(this._ctx.destination);
    return true;
  }

  _now() {
    return this._ctx ? this._ctx.currentTime : 0;
  }

  _noise() {
    if (!this._noiseBuffer) {
      const len = Math.floor(this._ctx.sampleRate * 1.5);
      const buf = this._ctx.createBuffer(1, len, this._ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuffer = buf;
    }
    return this._noiseBuffer;
  }

  // ---- low-level synth helpers ----

  // A single enveloped oscillator note.
  _tone({ freq = 440, type = 'sine', start = 0, dur = 0.2, gain = 0.3, glideTo = null }) {
    const t0 = this._now() + start;
    const osc = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this._master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // A filtered noise burst (whooshes, clacks, crackles).
  _noiseBurst({
    start = 0,
    dur = 0.3,
    gain = 0.3,
    type = 'bandpass',
    freq = 1200,
    q = 1,
    glideTo = null,
  }) {
    const t0 = this._now() + start;
    const src = this._ctx.createBufferSource();
    src.buffer = this._noise();
    src.loop = true;
    const filter = this._ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (glideTo != null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    }
    filter.Q.value = q;
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this._master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---- public SFX (spec §4.5) ----

  // Launch whoosh: rising filtered noise sweeping upward, like air rushing past.
  playLaunch() {
    if (!this.enabled || !this._ensureContext()) return;
    this._noiseBurst({ dur: 0.22, gain: 0.35, type: 'bandpass', freq: 350, q: 0.7, glideTo: 2400 });
    this._tone({ freq: 220, type: 'sine', dur: 0.22, gain: 0.12, glideTo: 480 });
  }

  // Impact clack: a short, bright percussive click as the brick docks.
  playImpact() {
    if (!this.enabled || !this._ensureContext()) return;
    this._tone({ freq: 180, type: 'triangle', dur: 0.09, gain: 0.4, glideTo: 60 });
    this._noiseBurst({ dur: 0.06, gain: 0.25, type: 'highpass', freq: 2000, q: 0.5 });
  }

  // Harmonic match chord; the whole chord rises in pitch as the combo grows.
  playMatch(combo = 1) {
    if (!this.enabled || !this._ensureContext()) return;
    const c = Math.max(1, Math.min(12, Number(combo) || 1));
    // +2 semitones per combo level above the first, capped.
    const semitones = (c - 1) * 2;
    const root = 261.63 * Math.pow(2, semitones / 12); // C4 rising
    const chord = [root, root * 1.25, root * 1.5, root * 2]; // major triad + octave
    chord.forEach((f, i) => {
      this._tone({
        freq: f,
        type: i === 3 ? 'sine' : 'triangle',
        start: i * 0.015,
        dur: 0.4,
        gain: 0.22 / (i + 1),
      });
    });
  }

  // Multi-stage wave-clear fireworks: whistling ascent + deep booms + crackles.
  playWaveClear() {
    if (!this.enabled || !this._ensureContext()) return;
    // Stage 1 — whistling rocket ascent (rising sine glissando).
    this._tone({ freq: 220, type: 'sine', dur: 0.7, gain: 0.18, glideTo: 1400 });
    this._noiseBurst({ dur: 0.7, gain: 0.12, type: 'bandpass', freq: 400, q: 2, glideTo: 2600 });

    // Stage 2 — deep explosive booms + bright radial bursts.
    const booms = [0.7, 0.95, 1.2, 1.45];
    booms.forEach((t, i) => {
      this._tone({
        freq: 90 - i * 12,
        type: 'sine',
        start: t,
        dur: 0.5,
        gain: 0.4,
        glideTo: 40,
      });
      this._noiseBurst({
        start: t,
        dur: 0.35,
        gain: 0.3,
        type: 'bandpass',
        freq: 900 + i * 300,
        q: 0.8,
        glideTo: 300,
      });
    });

    // Stage 3 — sizzling crackle shower of high-frequency sparks.
    for (let i = 0; i < 14; i++) {
      this._noiseBurst({
        start: 0.8 + Math.random() * 1.1,
        dur: 0.05 + Math.random() * 0.08,
        gain: 0.08 + Math.random() * 0.1,
        type: 'highpass',
        freq: 3000 + Math.random() * 4000,
        q: 0.4,
      });
    }

    // Closing chime.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this._tone({ freq: f, type: 'triangle', start: 1.5 + i * 0.09, dur: 0.5, gain: 0.2 });
    });
  }

  // Game-over tone: a slow, somber descending minor phrase.
  playGameOver() {
    if (!this.enabled || !this._ensureContext()) return;
    const seq = [392, 311.13, 261.63, 196];
    seq.forEach((f, i) => {
      this._tone({ freq: f, type: 'sawtooth', start: i * 0.28, dur: 0.4, gain: 0.12 });
      this._tone({ freq: f / 2, type: 'triangle', start: i * 0.28, dur: 0.42, gain: 0.16 });
    });
  }

  // UI click: a crisp, quiet blip.
  playClick() {
    if (!this.enabled || !this._ensureContext()) return;
    this._tone({ freq: 900, type: 'square', dur: 0.05, gain: 0.1, glideTo: 600 });
  }
}
