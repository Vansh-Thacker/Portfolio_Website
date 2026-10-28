// Synthesised V6 hybrid engine note, tyre squeal and impact thuds with the
// Web Audio API. Nothing is downloaded; it starts on the first user gesture.

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Engine: a sawtooth and a detuned square through a soft clipper and a
    // low-pass that opens with throttle
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 4;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.oscs = [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.25],
      ['sawtooth', 2.01, 0.18],
    ].map(([type, mult, gain]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(shaper);
      o.start();
      return { o, mult };
    });
    shaper.connect(this.filter).connect(this.engineGain).connect(this.master);

    // Tyre squeal and impacts share a noise source
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 6;
    this.squeal = ctx.createGain();
    this.squeal.gain.value = 0;
    noise.connect(band).connect(this.squeal).connect(this.master);
    noise.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  suspend(s) {
    if (!this.ctx) return;
    s ? this.ctx.suspend() : this.ctx.resume();
  }

  // rpm 0-1 within the gear, throttle 0-1, slip m/s
  update({ rpm, throttle, slip, running }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 55 + rpm * 230; // Hz, fundamental of the firing order
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(base * mult, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + throttle * 2600 + rpm * 1200, t, 0.05);
    this.engineGain.gain.setTargetAtTime(running ? 0.16 + throttle * 0.16 : 0, t, 0.08);
    this.squeal.gain.setTargetAtTime(Math.min(0.12, Math.max(0, slip - 2.5) * 0.02), t, 0.06);
  }

  thud(strength) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, strength / 15), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }
}
