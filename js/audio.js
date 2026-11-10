// Tiny chiptune-style sound effects made with WebAudio (no audio files).
// iOS only allows sound after the first touch, so unlock() is called on the first tap.
let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = !!on; }

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* sound is optional */ }
}

function tone(freq, start, dur, type = 'square', vol = 0.05) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  tap:     () => tone(520, 0, 0.05, 'square', 0.03),
  coin:    () => { tone(988, 0, 0.07); tone(1319, 0.07, 0.14); },
  build:   () => { tone(196, 0, 0.08, 'triangle', 0.09); tone(262, 0.08, 0.1, 'triangle', 0.09); },
  open:    () => { tone(523, 0, 0.09); tone(659, 0.09, 0.09); tone(784, 0.18, 0.16); },
  restock: () => { tone(440, 0, 0.06); tone(660, 0.06, 0.1); },
  movein:  () => { tone(392, 0, 0.1, 'triangle', 0.09); tone(523, 0.1, 0.16, 'triangle', 0.09); },
  ride:    () => { tone(660, 0, 0.08); tone(660, 0.12, 0.08); },
  oops:    () => tone(330, 0, 0.12, 'triangle', 0.06),
  dream:   () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.2)),
  rent:    () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25)),
  goal:    () => { tone(784, 0, 0.1); tone(1047, 0.1, 0.22); },
};

export function play(name) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name]?.(); } catch { /* ignore */ }
}
