// src/aiBalancer.js — Adaptive wave balancing powered by Gemini + safe heuristics
import { GameState } from './gameState.js';
import { MatchMemory } from './matchMemory.js';
import { geminiJSON } from './geminiService.js';

const SYSTEM_PROMPT = `You are an adaptive game balance controller for a voxel arena shooter.
Use telemetry to tune NEXT wave difficulty.

Return ONLY JSON with this exact schema:
{
  "summary": "short phrase under 80 chars",
  "spawnCountMult": 1.0,
  "enemyHpMult": 1.0,
  "enemySpeedMult": 1.0,
  "enemyDamageMult": 1.0,
  "enemyCooldownMult": 1.0
}

Rules:
- Multipliers are absolute values, not deltas.
- Target challenge: player ends most waves around 35-75 HP and clears in roughly 22-38 seconds.
- Keep adjustments conservative. Avoid sudden spikes.
- Never output markdown, backticks, or commentary.`;

const PROFILE_LIMITS = {
  spawnCountMult: [0.75, 1.35],
  enemyHpMult: [0.75, 1.55],
  enemySpeedMult: [0.8, 1.35],
  enemyDamageMult: [0.75, 1.45],
  enemyCooldownMult: [0.72, 1.3],
};

const PROFILE_STEP_LIMITS = {
  spawnCountMult: 0.12,
  enemyHpMult: 0.14,
  enemySpeedMult: 0.1,
  enemyDamageMult: 0.1,
  enemyCooldownMult: 0.1,
};

const BASE_PROFILE = Object.freeze({
  spawnCountMult: 1,
  enemyHpMult: 1,
  enemySpeedMult: 1,
  enemyDamageMult: 1,
  enemyCooldownMult: 1,
  pressureScore: 1,
  summary: 'Baseline arena pressure',
  source: 'base',
  updatedFromWave: 0,
  waveApplied: 1,
});

let _profile = { ...BASE_PROFILE };
let _history = [];
let _initialized = false;
let _activeToken = 0;
let _abortCtrl = null;

function clampNumber(value, min, max, fallback) {
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function stepLimit(nextValue, prevValue, maxStep) {
  const delta = nextValue - prevValue;
  if (delta > maxStep) return prevValue + maxStep;
  if (delta < -maxStep) return prevValue - maxStep;
  return nextValue;
}

function sanitizeSummary(text, fallback = '') {
  if (typeof text !== 'string') return fallback;
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return fallback;
  return clean.slice(0, 80);
}

function parseProfile(raw, prev = _profile) {
  const out = {};
  for (const key of Object.keys(PROFILE_LIMITS)) {
    const [min, max] = PROFILE_LIMITS[key];
    const next = clampNumber(raw?.[key], min, max, prev[key]);
    out[key] = round3(stepLimit(next, prev[key], PROFILE_STEP_LIMITS[key]));
  }
  out.summary = sanitizeSummary(raw?.summary, prev.summary);
  return out;
}

function blendProfiles(a, b, t = 0.65) {
  const mix = {};
  for (const key of Object.keys(PROFILE_LIMITS)) {
    const av = Number.isFinite(a?.[key]) ? a[key] : 1;
    const bv = Number.isFinite(b?.[key]) ? b[key] : av;
    mix[key] = av + (bv - av) * t;
  }
  mix.summary = sanitizeSummary(b?.summary, a?.summary || '');
  return mix;
}

function average(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function computePressureScore(profile) {
  const cooldownPressure = profile.enemyCooldownMult > 0 ? 1 / profile.enemyCooldownMult : 1;
  return round3(
    profile.spawnCountMult * 0.24 +
    profile.enemyHpMult * 0.26 +
    profile.enemySpeedMult * 0.2 +
    profile.enemyDamageMult * 0.2 +
    cooldownPressure * 0.1
  );
}

function collectTelemetry(clearedWave) {
  const waves = MatchMemory.waves;
  const lastWave = waves[waves.length - 1] || null;
  const recent = waves.slice(-3);
  const waveEvents = MatchMemory.events.filter((e) => e.wave === clearedWave);
  const hitEvents = waveEvents.filter((e) => e.type === 'player_hit');

  const damageTaken = hitEvents.reduce((sum, e) => sum + (Number(e?.data?.damage) || 0), 0);
  const nearDeaths = hitEvents.filter((e) => (Number(e?.data?.hpRemaining) || 0) > 0 && (Number(e?.data?.hpRemaining) || 0) <= 20).length;

  const duration = Math.max(1, Number(lastWave?.duration) || 1);
  const kills = Math.max(0, Number(lastWave?.kills) || 0);
  const hpEnd = Math.max(0, Number(lastWave?.playerHpEnd) || 0);
  const hpEndRatio = clampNumber(hpEnd / 100, 0, 1, 0);
  const killsPerSecond = kills / duration;
  const movementHabits = MatchMemory.getMovementHabits();

  return {
    clearedWave,
    currentProfile: {
      spawnCountMult: _profile.spawnCountMult,
      enemyHpMult: _profile.enemyHpMult,
      enemySpeedMult: _profile.enemySpeedMult,
      enemyDamageMult: _profile.enemyDamageMult,
      enemyCooldownMult: _profile.enemyCooldownMult,
      pressureScore: _profile.pressureScore,
    },
    lastWave: {
      wave: Number(lastWave?.wave) || clearedWave,
      durationSec: duration,
      kills,
      hpEnd,
      hpEndRatio: round3(hpEndRatio),
      killsPerSecond: round3(killsPerSecond),
      hitsTaken: hitEvents.length,
      damageTaken: round3(damageTaken),
      nearDeaths,
      weaponsUsed: Array.isArray(lastWave?.weaponsUsed) ? lastWave.weaponsUsed.slice(0, 3) : [],
    },
    recentAverages: {
      waveDurationSec: round3(average(recent.map((w) => Number(w.duration) || 0))),
      waveKills: round3(average(recent.map((w) => Number(w.kills) || 0))),
      hpEnd: round3(average(recent.map((w) => Number(w.playerHpEnd) || 0))),
    },
    movementHabits: {
      strafeRatio: round3(movementHabits.strafeRatio || 0),
      sprintRatio: round3(movementHabits.sprintRatio || 0),
      closeRangeRatio: round3(movementHabits.closeRangeRatio || 0),
      longRangeRatio: round3(movementHabits.longRangeRatio || 0),
    },
    matchTotals: {
      totalKills: GameState.kills,
      score: GameState.score,
      wavesRecorded: waves.length,
    },
  };
}

function buildHeuristicProfile(telemetry) {
  const hpEndRatio = telemetry.lastWave.hpEndRatio;
  const clearTime = telemetry.lastWave.durationSec;
  const nearDeaths = telemetry.lastWave.nearDeaths;
  const hitsTaken = telemetry.lastWave.hitsTaken;
  const kps = telemetry.lastWave.killsPerSecond;

  let score = 0;
  score += (hpEndRatio - 0.58) * 1.4;
  score += ((28 - clearTime) / 28) * 0.9;
  score += Math.max(-0.2, Math.min(0.2, (kps - 0.22) * 0.8));
  score -= Math.min(0.45, nearDeaths * 0.18);
  score -= Math.min(0.35, hitsTaken * 0.02);
  score = Math.max(-0.95, Math.min(0.95, score));

  let summary = 'Balance steady';
  if (score > 0.2) summary = 'Player dominant, increasing pressure';
  else if (score < -0.2) summary = 'Player pressured, easing wave';

  return {
    summary,
    spawnCountMult: 1 + score * 0.22,
    enemyHpMult: 1 + score * 0.3,
    enemySpeedMult: 1 + score * 0.18,
    enemyDamageMult: 1 + score * 0.2,
    enemyCooldownMult: 1 - score * 0.16,
  };
}

async function requestGeminiProfile(telemetry, signal) {
  const result = await geminiJSON({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Balance telemetry JSON:\n${JSON.stringify(telemetry, null, 2)}`,
    temperature: 0.2,
    maxTokens: 280,
    signal,
  });
  if (!result || typeof result !== 'object') return null;
  return {
    summary: result.summary,
    spawnCountMult: Number(result.spawnCountMult),
    enemyHpMult: Number(result.enemyHpMult),
    enemySpeedMult: Number(result.enemySpeedMult),
    enemyDamageMult: Number(result.enemyDamageMult),
    enemyCooldownMult: Number(result.enemyCooldownMult),
  };
}

async function onWaveClear(data = {}) {
  const clearedWave = Number(data?.wave) || GameState.wave;
  if (!Number.isFinite(clearedWave) || clearedWave <= 0) return;

  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();
  const token = ++_activeToken;

  const telemetry = collectTelemetry(clearedWave);
  const heuristic = parseProfile(buildHeuristicProfile(telemetry), _profile);

  let nextProfile = { ...heuristic };
  let source = 'heuristic';

  try {
    const aiRaw = await requestGeminiProfile(telemetry, _abortCtrl.signal);
    if (token !== _activeToken) return;

    if (aiRaw) {
      const aiParsed = parseProfile(aiRaw, _profile);
      const blended = blendProfiles(heuristic, aiParsed, 0.7);
      nextProfile = parseProfile(blended, _profile);
      source = 'gemini';
    }
  } catch (err) {
    if (token !== _activeToken) return;
    console.warn('[aiBalancer] Gemini balancing failed, using heuristics:', err?.message || err);
  }

  _profile = {
    ...nextProfile,
    pressureScore: computePressureScore(nextProfile),
    source,
    updatedFromWave: clearedWave,
    waveApplied: clearedWave + 1,
  };

  _history.push(_profile);
  if (_history.length > 20) _history.splice(0, _history.length - 20);

  GameState.emit('ai_balance_updated', {
    source,
    profile: { ..._profile },
    waveCleared: clearedWave,
    waveApplied: clearedWave + 1,
  });
}

function resetState() {
  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = null;
  _activeToken++;
  _profile = { ...BASE_PROFILE };
  _history = [];
}

export function initAiBalancer() {
  if (_initialized) return;
  _initialized = true;
  GameState.on('wave_clear', onWaveClear);
  GameState.on('restart', resetState);
}

export function getAiBalanceProfile() {
  return { ..._profile };
}

export function getAiBalanceHistory() {
  return _history.map((entry) => ({ ...entry }));
}
