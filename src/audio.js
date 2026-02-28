// src/audio.js — Procedural audio engine (Web Audio API, no asset files)

let ctx = null;
let sfxVol = 0.5;
let musicVol = 0.3;
let masterGain = null;

export function initAudio() {
  const unlock = () => {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = sfxVol;
    masterGain.connect(ctx.destination);
    document.removeEventListener('click', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('click', unlock);
  document.addEventListener('keydown', unlock);
}

export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  if (masterGain) masterGain.gain.value = sfxVol;
}

function ensureCtx() {
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// ── Utility helpers ──

function noise(duration, filter = 2000) {
  if (!ensureCtx()) return;
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = filter;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(filt).connect(gain).connect(masterGain);
  src.start();
  return { src, gain };
}

function tone(freq, duration, type = 'sine', volume = 0.3) {
  if (!ensureCtx()) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + duration);
  return { osc, gain };
}

function sweep(startFreq, endFreq, duration, type = 'sine', volume = 0.3) {
  if (!ensureCtx()) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

// ── Sound effects ──

export function playShoot() {
  noise(0.06, 3000);
  sweep(800, 200, 0.08, 'square', 0.15);
}

export function playHit() {
  sweep(300, 80, 0.1, 'sine', 0.25);
  noise(0.05, 1500);
}

export function playExplosion() {
  sweep(100, 30, 0.4, 'sine', 0.35);
  noise(0.3, 800);
}

export function playEnemyDeath() {
  sweep(500, 80, 0.25, 'sawtooth', 0.15);
  noise(0.15, 1200);
}

export function playPlayerHit() {
  sweep(150, 50, 0.2, 'sine', 0.4);
  noise(0.1, 600);
}

export function playForgeOpen() {
  if (!ensureCtx()) return;
  [523, 659, 784].forEach((f, i) => {
    setTimeout(() => tone(f, 0.15, 'sine', 0.15), i * 80);
  });
}

export function playForgeComplete() {
  if (!ensureCtx()) return;
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => tone(f, 0.2, 'sine', 0.2), i * 100);
  });
}

export function playWaveStart() {
  if (!ensureCtx()) return;
  tone(440, 0.15, 'square', 0.2);
  setTimeout(() => tone(440, 0.15, 'square', 0.2), 200);
  setTimeout(() => tone(660, 0.25, 'square', 0.25), 400);
}

export function playWeaponSwitch() {
  tone(1200, 0.05, 'sine', 0.15);
}

export function playUIClick() {
  tone(800, 0.03, 'sine', 0.1);
}

// ── Ambient music (generative pad) ──

let musicNodes = [];

export function startAmbientMusic() {
  if (!ensureCtx()) return;
  stopAmbientMusic();

  const notes = [65.41, 82.41, 98.00, 130.81]; // C2, E2, G2, C3
  const musicGain = ctx.createGain();
  musicGain.gain.value = musicVol;
  musicGain.connect(ctx.destination);

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0.04;
    // Slow tremolo
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.1 + i * 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(musicGain);
    osc.start();
    lfo.start();
    musicNodes.push(osc, lfo);
  });
}

export function stopAmbientMusic() {
  musicNodes.forEach(n => { try { n.stop(); } catch(e) {} });
  musicNodes = [];
}

export function setMusicVolume(v) { musicVol = Math.max(0, Math.min(1, v)); }
