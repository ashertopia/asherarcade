// Sound: every effect is synthesised with Web Audio, so there are no audio
// files to license or load. Bells, a tick, a buzzer, a fanfare, and a soft
// music-box "Jingle Bells" (public domain) for the lobby.
//
// Browsers only allow sound after a tap/click, so call PGNAudio.unlock() from
// a click handler (the host's "Open room", the phone's "Join").
(function () {
  'use strict';
  const { store } = window.PGN;
  let ctx = null;
  let master = null;
  let muted = store.get('pgn:muted', false);
  let musicTimer = null;
  let musicOn = false;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function unlock() {
    const c = ac();
    if (c && c.state === 'suspended') c.resume();
  }

  function setMuted(m) {
    muted = !!m;
    store.set('pgn:muted', muted);
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
    document.querySelectorAll('[data-mute]').forEach((b) => {
      b.textContent = muted ? '🔇' : '🔊';
      b.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
      b.setAttribute('aria-pressed', String(muted));
    });
  }

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // A bell: a few inharmonic sine partials with a fast attack and long decay.
  function bell(freq, t, dur, vol) {
    const c = ac();
    if (!c) return;
    const partials = [[1, 1], [2.0, 0.45], [2.76, 0.3], [5.4, 0.12]];
    for (const [ratio, amp] of partials) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((vol || 0.25) * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 1.2) / ratio);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + (dur || 1.2) + 0.05);
    }
  }

  function tone(type, freq, t, dur, vol, slideTo) {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(t, dur, vol, hp) {
    const c = ac();
    if (!c) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp || 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  function play(fn) {
    const c = ac();
    if (!c || muted) return;
    if (c.state === 'suspended') c.resume();
    fn(c.currentTime + 0.02);
  }

  const sfx = {
    join: () => play((t) => {
      for (let i = 0; i < 5; i++) noise(t + i * 0.06, 0.07, 0.18, 7000);
      bell(midi(88), t + 0.05, 0.6, 0.12);
    }),
    chime: () => play((t) => {
      bell(midi(76), t, 1.4, 0.2);
      bell(midi(83), t + 0.12, 1.4, 0.16);
    }),
    question: () => play((t) => {
      bell(midi(72), t, 0.8, 0.18);
      bell(midi(79), t + 0.1, 1.0, 0.18);
    }),
    tick: () => play((t) => tone('sine', 1400, t, 0.05, 0.12)),
    lock: () => play((t) => tone('triangle', 660, t, 0.09, 0.14, 990)),
    tap: () => play((t) => tone('triangle', 520, t, 0.07, 0.12, 780)),
    buzzer: () => play((t) => {
      tone('sawtooth', 180, t, 0.35, 0.06, 120);
      tone('square', 90, t, 0.35, 0.04);
    }),
    correct: () => play((t) => [72, 76, 79, 84].forEach((n, i) => bell(midi(n), t + i * 0.09, 1.1, 0.16))),
    wrong: () => play((t) => {
      tone('triangle', 330, t, 0.22, 0.14, 300);
      tone('triangle', 247, t + 0.2, 0.4, 0.14, 220);
    }),
    reveal: () => play((t) => {
      noise(t, 0.45, 0.06, 2500);
      [67, 72, 76].forEach((n) => bell(midi(n), t + 0.3, 1.6, 0.12));
    }),
    fanfare: () => play((t) => {
      const seq = [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [84, 0.75]];
      seq.forEach(([n, d]) => bell(midi(n), t + d, 1.6, 0.2));
      [72, 76, 79, 84].forEach((n) => bell(midi(n), t + 1.1, 2.4, 0.12));
      for (let i = 0; i < 10; i++) noise(t + 1.1 + i * 0.07, 0.08, 0.1, 7000);
    }),
  };

  // Jingle Bells chorus (James Lord Pierpont, 1857: public domain). [midi, beats]
  const E = 76, F = 77, G = 79, C = 72, D = 74;
  const TUNE = [
    [E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4],
    [F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [E, 1], [D, 1], [D, 1], [E, 1], [D, 2], [G, 2],
    [E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4],
    [F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [G, 1], [G, 1], [F, 1], [D, 1], [C, 4],
  ];
  const BEAT = 0.34;

  function playTuneOnce() {
    const c = ac();
    if (!c || muted) return TUNE.reduce((a, n) => a + n[1], 0) * BEAT;
    let t = c.currentTime + 0.05;
    for (const [n, beats] of TUNE) {
      bell(midi(n + 12), t, 1.1, 0.045);
      t += beats * BEAT;
    }
    return TUNE.reduce((a, n) => a + n[1], 0) * BEAT;
  }

  function music(on) {
    if (on === musicOn) return;
    musicOn = on;
    clearTimeout(musicTimer);
    if (!on) return;
    (function loop() {
      if (!musicOn) return;
      const secs = playTuneOnce();
      musicTimer = setTimeout(loop, (secs + 3) * 1000);
    })();
  }

  // Optional narrator: the browser's built-in text-to-speech reads the host lines.
  let narrator = store.get('pgn:narrator', false);
  function say(text) {
    if (!narrator || muted || !text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.08;
    u.pitch = 1.05;
    const v = window.speechSynthesis.getVoices().find((x) => /en[-_](US|GB)/i.test(x.lang) && /Google|Samantha|Daniel|Natural/i.test(x.name));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }
  function setNarrator(on) {
    narrator = !!on;
    store.set('pgn:narrator', narrator);
    if (!narrator && window.speechSynthesis) window.speechSynthesis.cancel();
    document.querySelectorAll('[data-narrator]').forEach((b) => {
      b.setAttribute('aria-pressed', String(narrator));
      b.style.opacity = narrator ? '1' : '0.5';
    });
  }

  function bindButtons() {
    document.querySelectorAll('[data-mute]').forEach((b) =>
      b.addEventListener('click', () => {
        unlock();
        setMuted(!muted);
      })
    );
    document.querySelectorAll('[data-narrator]').forEach((b) => b.addEventListener('click', () => setNarrator(!narrator)));
    setMuted(muted);
    setNarrator(narrator);
  }

  window.PGNAudio = { unlock, sfx, music, say, bindButtons, isMuted: () => muted, setMuted };
})();
