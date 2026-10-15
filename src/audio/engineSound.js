// Synthesized flight sounds driven by the flight model: a voice per engine (piston, turboprop,
// turbofan, afterburner), airflow that grows with speed, tyre rumble, flap/gear motors and stall
// buffet. Inside the cockpit everything is muffled; outside, wind and engines are brighter.

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function pistonVoice(audio, out) {
  const ctx = audio.ctx;
  const oscs = [['sawtooth', 1, 0.5], ['square', 2, 0.25], ['sawtooth', 4, 0.12]].map(([type, mult, g]) => {
    const o = ctx.createOscillator();
    o.type = type;
    const amp = ctx.createGain();
    amp.gain.value = g;
    o.connect(amp);
    o.start();
    return { o, amp, mult };
  });
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(257);
  for (let i = 0; i < curve.length; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(2.2 * x); }
  shaper.curve = curve;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const mix = ctx.createGain();
  for (const { amp } of oscs) amp.connect(shaper);
  shaper.connect(lp).connect(mix);
  // Propeller: band-limited noise chopped at blade-pass rate.
  const prop = audio.noise('white');
  const pbp = ctx.createBiquadFilter();
  pbp.type = 'bandpass'; pbp.Q.value = 0.8;
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 40;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.5;
  lfo.connect(lfoDepth).connect(chop.gain);
  lfo.start();
  const propGain = ctx.createGain();
  prop.connect(pbp).connect(chop).connect(propGain).connect(mix);
  mix.connect(out);
  return {
    update(n, rpm, throttle) {
      const t = ctx.currentTime;
      const f = Math.max(10, (rpm / 60) * 2); // four cylinders, four-stroke: two firings per revolution
      for (const { o, mult } of oscs) o.frequency.setTargetAtTime(f * mult, t, 0.05);
      lp.frequency.setTargetAtTime(380 + 1900 * n, t, 0.08);
      mix.gain.setTargetAtTime(n < 0.04 ? 0 : 0.18 + 0.42 * n + 0.1 * throttle, t, 0.1);
      pbp.frequency.setTargetAtTime(220 + 420 * n, t, 0.1);
      lfo.frequency.setTargetAtTime((rpm / 60) * 2, t, 0.05);
      propGain.gain.setTargetAtTime(0.25 + 0.5 * n, t, 0.1);
    },
    stop() { for (const { o } of oscs) o.stop(); lfo.stop(); prop.stop(); },
  };
}

function turbopropVoice(audio, out) {
  const ctx = audio.ctx;
  const whine = ctx.createOscillator();
  whine.type = 'sine';
  const whine2 = ctx.createOscillator();
  whine2.type = 'triangle';
  const whineGain = ctx.createGain();
  whine.connect(whineGain);
  whine2.connect(whineGain);
  whine.start(); whine2.start();
  const prop = audio.noise('white');
  const pbp = ctx.createBiquadFilter();
  pbp.type = 'bandpass'; pbp.Q.value = 0.9;
  const chop = ctx.createGain();
  chop.gain.value = 0.55;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 100;
  const depth = ctx.createGain();
  depth.gain.value = 0.45;
  lfo.connect(depth).connect(chop.gain);
  lfo.start();
  const propGain = ctx.createGain();
  prop.connect(pbp).connect(chop).connect(propGain);
  const rumble = audio.noise('brown');
  const rlp = ctx.createBiquadFilter();
  rlp.type = 'lowpass'; rlp.frequency.value = 160;
  const rumbleGain = ctx.createGain();
  rumble.connect(rlp).connect(rumbleGain);
  const mix = ctx.createGain();
  whineGain.connect(mix); propGain.connect(mix); rumbleGain.connect(mix);
  mix.connect(out);
  return {
    update(n) {
      const t = ctx.currentTime;
      const on = n > 0.04;
      whine.frequency.setTargetAtTime(500 + 1500 * n, t, 0.08);
      whine2.frequency.setTargetAtTime((500 + 1500 * n) * 1.5, t, 0.08);
      whineGain.gain.setTargetAtTime(on ? 0.02 + 0.07 * n : 0, t, 0.1);
      pbp.frequency.setTargetAtTime(260 + 380 * n, t, 0.1);
      lfo.frequency.setTargetAtTime(60 + 90 * n, t, 0.1);
      propGain.gain.setTargetAtTime(on ? 0.15 + 0.5 * n : 0, t, 0.1);
      rumbleGain.gain.setTargetAtTime(on ? 0.2 + 0.5 * n : 0, t, 0.1);
      mix.gain.setTargetAtTime(1, t, 0.1);
    },
    stop() { whine.stop(); whine2.stop(); lfo.stop(); prop.stop(); rumble.stop(); },
  };
}

function turbofanVoice(audio, out, { afterburner = false, big = false } = {}) {
  const ctx = audio.ctx;
  const roar = audio.noise('white');
  const rlp = ctx.createBiquadFilter();
  rlp.type = 'lowpass';
  const roarGain = ctx.createGain();
  roar.connect(rlp).connect(roarGain);
  const rumble = audio.noise('brown');
  const lowp = ctx.createBiquadFilter();
  lowp.type = 'lowpass'; lowp.frequency.value = big ? 110 : 150;
  const rumbleGain = ctx.createGain();
  rumble.connect(lowp).connect(rumbleGain);
  const fan = ctx.createOscillator();
  fan.type = 'sawtooth';
  const fbp = ctx.createBiquadFilter();
  fbp.type = 'bandpass'; fbp.Q.value = 6;
  const fanGain = ctx.createGain();
  fan.connect(fbp).connect(fanGain);
  fan.start();
  let abNoise = null; let abLp = null; let abGain = null; let crackle = null;
  if (afterburner) {
    abNoise = audio.noise('white');
    abLp = ctx.createBiquadFilter();
    abLp.type = 'lowpass'; abLp.frequency.value = 2400;
    abGain = ctx.createGain();
    crackle = ctx.createOscillator();
    crackle.frequency.value = 23; crackle.type = 'square';
    const cd = ctx.createGain(); cd.gain.value = 0.35;
    const cm = ctx.createGain(); cm.gain.value = 0.65;
    crackle.connect(cd).connect(cm.gain);
    crackle.start();
    abNoise.connect(abLp).connect(cm).connect(abGain);
  }
  const mix = ctx.createGain();
  roarGain.connect(mix); rumbleGain.connect(mix); fanGain.connect(mix);
  if (abGain) abGain.connect(mix);
  mix.connect(out);
  return {
    update(n, _rpm, _thr, ab = 0) {
      const t = ctx.currentTime;
      const on = n > 0.03;
      rlp.frequency.setTargetAtTime(500 + 3200 * n ** 1.4, t, 0.1);
      roarGain.gain.setTargetAtTime(on ? 0.06 + 0.5 * n ** 1.6 : 0, t, 0.12);
      rumbleGain.gain.setTargetAtTime(on ? (big ? 0.55 : 0.35) * (0.3 + 0.7 * n) : 0, t, 0.12);
      fan.frequency.setTargetAtTime(900 + 2800 * n, t, 0.1);
      fbp.frequency.setTargetAtTime(900 + 2800 * n, t, 0.1);
      fanGain.gain.setTargetAtTime(on ? 0.01 + 0.07 * n ** 0.7 : 0, t, 0.1);
      if (abGain) abGain.gain.setTargetAtTime(ab * 0.75, t, 0.12);
    },
    stop() { roar.stop(); rumble.stop(); fan.stop(); abNoise?.stop(); crackle?.stop(); },
  };
}

export class EngineSound {
  constructor(audio) {
    this.audio = audio;
    this.voices = [];
    this.built = false;
    this.model = null;
    this.cabin = false;
  }

  #build(model) {
    const audio = this.audio;
    const ctx = audio.context();
    if (!ctx) return;
    this.#teardown();
    const bus = audio.buses.fx;
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 12000;
    this.cabinFilter.connect(bus);
    const engineMix = ctx.createGain();
    engineMix.gain.value = 0.6 / Math.sqrt(Math.max(1, model.engines.length));
    engineMix.connect(this.cabinFilter);
    this.engineMix = engineMix;
    const type = model.spec.engines.spec.type;
    const big = model.spec.mass.ref > 100000;
    this.voices = model.engines.map(() => {
      if (type === 'piston') return pistonVoice(audio, engineMix);
      if (type === 'turboprop') return turbopropVoice(audio, engineMix);
      return turbofanVoice(audio, engineMix, { afterburner: !!model.spec.engines.spec.afterburner, big });
    });
    // Airflow.
    this.wind = audio.noise('white');
    this.windBp = ctx.createBiquadFilter();
    this.windBp.type = 'bandpass'; this.windBp.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windBp).connect(this.windGain).connect(this.cabinFilter);
    // Tyres on the ground.
    this.roll = audio.noise('brown');
    this.rollLp = ctx.createBiquadFilter();
    this.rollLp.type = 'lowpass'; this.rollLp.frequency.value = 200;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.roll.connect(this.rollLp).connect(this.rollGain).connect(this.cabinFilter);
    // Stall buffet.
    this.buffet = audio.noise('brown');
    const bl = ctx.createBiquadFilter();
    bl.type = 'lowpass'; bl.frequency.value = 90;
    this.buffetGain = ctx.createGain();
    this.buffetGain.gain.value = 0;
    this.buffet.connect(bl).connect(this.buffetGain).connect(this.cabinFilter);
    // Flap and gear motors.
    this.servo = ctx.createOscillator();
    this.servo.type = 'sawtooth';
    this.servo.frequency.value = 150;
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass'; sbp.frequency.value = 420; sbp.Q.value = 3;
    this.servoGain = ctx.createGain();
    this.servoGain.gain.value = 0;
    this.servo.connect(sbp).connect(this.servoGain).connect(this.cabinFilter);
    this.servo.start();
    this.model = model;
    this.last = { flaps: model.surfaces.flap, gear: model.gear.extension };
    this.built = true;
  }

  #teardown() {
    for (const v of this.voices) v.stop();
    this.voices = [];
    for (const n of [this.wind, this.roll, this.buffet, this.servo]) { try { n?.stop(); } catch { /* already stopped */ } }
    try { this.cabinFilter?.disconnect(); } catch { /* ignore */ }
    this.built = false;
  }

  /** Call when a flight starts (or restarts). */
  attach(model) {
    this.model = model;
    this.built = false;
    this.pendingModel = model;
  }

  stopAll() {
    this.#teardown();
    this.pendingModel = null;
  }

  /** Per-frame update. `cockpit` true when the camera is inside the aircraft. */
  update(dt, tel, cockpit) {
    const audio = this.audio;
    if (!audio.ready || !this.model) return;
    if (!this.built) {
      if (!this.pendingModel) return;
      this.#build(this.pendingModel);
      if (!this.built) return;
    }
    const model = this.model;
    const ctx = audio.ctx;
    const t = ctx.currentTime;
    // Engines.
    model.engines.forEach((e, i) => {
      const g = e.gauges;
      const dead = model.crashed || e.failed;
      this.voices[i].update(dead ? 0 : g.n1 / 100, g.rpm, e.throttle ?? tel.throttle?.[i] ?? 0, g.afterburner ?? 0);
    });
    // Cabin muffling.
    if (cockpit !== this.cabin) {
      this.cabin = cockpit;
      this.cabinFilter.frequency.setTargetAtTime(cockpit ? 1300 : 12000, t, 0.12);
    }
    // Airflow: grows with the square of airspeed, brighter with speed, noisier with flaps and gear out.
    const s = clamp01(tel.iasTrue / (model.spec.limits.vne * 0.85));
    const drag = 1 + 0.5 * clamp01(tel.flaps / 30) + (model.spec.gear.retractable ? 0.5 * tel.gear : 0.3);
    this.windBp.frequency.setTargetAtTime(350 + 2800 * s, t, 0.15);
    this.windGain.gain.setTargetAtTime(model.crashed ? 0 : 0.7 * s ** 1.7 * drag * (cockpit ? 0.55 : 1), t, 0.12);
    // Tyres.
    const gs = tel.groundSpeed * 0.514444;
    this.rollLp.frequency.setTargetAtTime(110 + gs * 9, t, 0.1);
    this.rollGain.gain.setTargetAtTime(tel.onGround && !model.crashed ? clamp01(gs / 45) * 0.9 : 0, t, 0.08);
    // Buffet and servos.
    this.buffetGain.gain.setTargetAtTime(tel.stalled && !tel.onGround ? 0.8 : tel.stallWarning ? 0.2 : 0, t, 0.1);
    const moving = Math.abs(tel.flaps - this.last.flaps) > 0.01 || Math.abs(tel.gear - this.last.gear) > 0.002;
    this.servoGain.gain.setTargetAtTime(moving ? 0.07 : 0, t, 0.06);
    this.servo.frequency.setTargetAtTime(moving ? 140 + 40 * Math.sin(t * 6) : 140, t, 0.1);
    this.last.flaps = tel.flaps;
    this.last.gear = tel.gear;
  }
}
