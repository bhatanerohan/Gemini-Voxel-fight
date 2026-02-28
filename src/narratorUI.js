// src/narratorUI.js — Cinematic battle narrator text overlay + Gemini TTS audio

const TTS_STORAGE_KEY = 'voxel-arena.narrator-tts.v1';
const GOOGLE_TTS_VOICES = Object.freeze([
  { name: 'Kore', style: 'Firm' },
  { name: 'Zephyr', style: 'Bright' },
  { name: 'Puck', style: 'Upbeat' },
  { name: 'Charon', style: 'Informative' },
  { name: 'Fenrir', style: 'Excitable' },
  { name: 'Leda', style: 'Youthful' },
  { name: 'Orus', style: 'Firm' },
  { name: 'Aoede', style: 'Breezy' },
  { name: 'Callirrhoe', style: 'Easy-going' },
  { name: 'Autonoe', style: 'Bright' },
  { name: 'Enceladus', style: 'Breathy' },
  { name: 'Iapetus', style: 'Clear' },
  { name: 'Umbriel', style: 'Easy-going' },
  { name: 'Algieba', style: 'Smooth' },
  { name: 'Despina', style: 'Smooth' },
  { name: 'Erinome', style: 'Clear' },
  { name: 'Algenib', style: 'Gravelly' },
  { name: 'Rasalgethi', style: 'Informative' },
  { name: 'Laomedeia', style: 'Upbeat' },
  { name: 'Achernar', style: 'Soft' },
  { name: 'Alnilam', style: 'Firm' },
  { name: 'Schedar', style: 'Even' },
  { name: 'Gacrux', style: 'Mature' },
  { name: 'Pulcherrima', style: 'Forward' },
]);

let narratorEl = null;
let hideTimeout = null;
let streamInterval = null;

let _ttsEnabled = true;
let _ttsRate = 1;
let _ttsVoiceName = 'Kore';

let _ttsEnabledEl = null;
let _ttsVoiceEl = null;
let _ttsRateEl = null;
let _ttsRateLabelEl = null;

let _ttsAbortController = null;
let _ttsAudio = null;
let _ttsAudioUrl = '';
let _ttsErrorCooldownUntil = 0;

function clampRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.75, Math.min(1.3, n));
}

function sanitizeLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function loadTtsPrefs() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(TTS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    _ttsEnabled = parsed?.enabled !== false;
    _ttsRate = clampRate(parsed?.rate);
    const voice = String(parsed?.voiceName || '');
    if (GOOGLE_TTS_VOICES.some(v => v.name === voice)) {
      _ttsVoiceName = voice;
    }
  } catch (_) {
    // ignore invalid saved prefs
  }
}

function saveTtsPrefs() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify({
      enabled: _ttsEnabled,
      rate: _ttsRate,
      voiceName: _ttsVoiceName,
    }));
  } catch (_) {
    // ignore storage errors
  }
}

function updateTtsUi() {
  if (_ttsEnabledEl) _ttsEnabledEl.checked = _ttsEnabled;
  if (_ttsVoiceEl) _ttsVoiceEl.value = _ttsVoiceName;
  if (_ttsRateEl) _ttsRateEl.value = String(_ttsRate);
  if (_ttsRateLabelEl) _ttsRateLabelEl.textContent = `${_ttsRate.toFixed(2)}x`;

  const disabled = !_ttsEnabled;
  if (_ttsVoiceEl) _ttsVoiceEl.disabled = disabled;
  if (_ttsRateEl) _ttsRateEl.disabled = disabled;
}

function clearTtsAudio() {
  if (_ttsAudio) {
    try {
      _ttsAudio.pause();
      _ttsAudio.src = '';
    } catch (_) {
      // ignore
    }
  }
  _ttsAudio = null;

  if (_ttsAudioUrl) {
    try { URL.revokeObjectURL(_ttsAudioUrl); } catch (_) { /* ignore */ }
    _ttsAudioUrl = '';
  }
}

function stopTtsPlayback() {
  if (_ttsAbortController) {
    try { _ttsAbortController.abort(); } catch (_) { /* ignore */ }
    _ttsAbortController = null;
  }
  clearTtsAudio();
}

function warnTts(message, err) {
  const now = Date.now();
  if (now < _ttsErrorCooldownUntil) return;
  _ttsErrorCooldownUntil = now + 4000;
  console.warn(`[narrator-tts] ${message}`, err || '');
}

function buildTtsPrompt(line, mood, rate) {
  const moodStyle = ({
    epic: 'Narrate with cinematic weight and confidence.',
    ominous: 'Narrate in a tense, ominous tone.',
    triumphant: 'Narrate with energetic triumph and momentum.',
    desperate: 'Narrate with urgency and strain.',
    quiet: 'Narrate softly but clearly.',
  })[String(mood || '').toLowerCase()] || 'Narrate clearly with dramatic pacing.';

  const paceStyle = rate > 1.08
    ? 'Keep delivery brisk.'
    : rate < 0.92
      ? 'Keep delivery measured and deliberate.'
      : 'Keep delivery natural.';

  return `${moodStyle} ${paceStyle} Speak this exact line: "${line}"`;
}

function decodeBase64ToBytes(base64) {
  const cleaned = String(base64 || '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pcmBytesToWavBlob(pcmBytes, sampleRate = 24000, channels = 1) {
  const bytesPerSample = 2;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataSize = pcmBytes.length;

  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  const out = new Uint8Array(wav);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  out.set(pcmBytes, 44);

  return new Blob([out], { type: 'audio/wav' });
}

async function fetchGeminiTts(line, mood, signal) {
  const payload = {
    contents: [{
      parts: [{ text: buildTtsPrompt(line, mood, _ttsRate) }],
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: _ttsVoiceName },
        },
      },
    },
  };

  const res = await fetch('/gemini/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `TTS request failed (${res.status})`;
    try {
      const body = await res.json();
      const detail = body?.error?.message || body?.message;
      if (typeof detail === 'string' && detail.trim()) message = detail.trim();
    } catch (_) {
      // keep default message
    }
    throw new Error(message);
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('audio/')) {
    return res.blob();
  }

  const json = await res.json().catch(() => null);
  const parts = json?.candidates?.[0]?.content?.parts;
  const audioPart = Array.isArray(parts)
    ? parts.find(p => typeof p?.inlineData?.data === 'string' && p.inlineData.data)
    : null;
  const bytes = decodeBase64ToBytes(audioPart?.inlineData?.data || '');
  if (!bytes || !bytes.length) {
    throw new Error('Gemini TTS returned no audio content.');
  }
  return pcmBytesToWavBlob(bytes, 24000, 1);
}

async function speakNarrator(text, mood) {
  if (!_ttsEnabled) return;
  const line = sanitizeLine(text);
  if (!line) return;

  stopTtsPlayback();
  const ctrl = new AbortController();
  _ttsAbortController = ctrl;

  try {
    const audioBlob = await fetchGeminiTts(line, mood, ctrl.signal);
    if (ctrl.signal.aborted) return;

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    _ttsAudioUrl = audioUrl;
    _ttsAudio = audio;
    audio.volume = 0.95;

    audio.addEventListener('ended', () => {
      clearTtsAudio();
    }, { once: true });
    audio.addEventListener('error', () => {
      clearTtsAudio();
    }, { once: true });

    await audio.play();
  } catch (err) {
    if (!ctrl.signal.aborted) {
      warnTts(err?.message || 'Unexpected TTS failure', err);
    }
  } finally {
    if (_ttsAbortController === ctrl) {
      _ttsAbortController = null;
    }
  }
}

function initTtsControls() {
  _ttsEnabledEl = document.getElementById('narrator-tts-enabled');
  _ttsVoiceEl = document.getElementById('narrator-tts-voice');
  _ttsRateEl = document.getElementById('narrator-tts-rate');
  _ttsRateLabelEl = document.getElementById('narrator-tts-rate-label');
  if (!_ttsEnabledEl || !_ttsVoiceEl || !_ttsRateEl || !_ttsRateLabelEl) return;

  loadTtsPrefs();

  _ttsVoiceEl.innerHTML = '';
  for (const voice of GOOGLE_TTS_VOICES) {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.style})`;
    _ttsVoiceEl.appendChild(option);
  }

  _ttsEnabledEl.addEventListener('change', () => {
    _ttsEnabled = !!_ttsEnabledEl.checked;
    if (!_ttsEnabled) stopTtsPlayback();
    updateTtsUi();
    saveTtsPrefs();
  });

  _ttsVoiceEl.addEventListener('change', () => {
    const next = String(_ttsVoiceEl.value || '');
    if (GOOGLE_TTS_VOICES.some(v => v.name === next)) {
      _ttsVoiceName = next;
      saveTtsPrefs();
    }
  });

  _ttsRateEl.addEventListener('input', () => {
    _ttsRate = clampRate(_ttsRateEl.value);
    updateTtsUi();
    saveTtsPrefs();
  });

  updateTtsUi();
}

export function initNarrator() {
  narratorEl = document.getElementById('narrator-overlay');
  initTtsControls();
}

export function showNarratorLine(text, mood = 'epic', duration = 3500) {
  if (!narratorEl || !text) return;
  if (hideTimeout) clearTimeout(hideTimeout);
  if (streamInterval) clearInterval(streamInterval);

  narratorEl.textContent = '';
  narratorEl.className = `narrator-overlay narrator-${mood} narrator-show`;
  void speakNarrator(text, mood);

  // Stream words one at a time
  const words = text.split(/\s+/);
  let idx = 0;
  streamInterval = setInterval(() => {
    if (idx >= words.length) {
      clearInterval(streamInterval);
      streamInterval = null;
      hideTimeout = setTimeout(() => {
        narratorEl.classList.remove('narrator-show');
        narratorEl.classList.add('narrator-hide');
      }, duration);
      return;
    }
    narratorEl.textContent += (idx > 0 ? ' ' : '') + words[idx];
    idx++;
  }, 120);
}
