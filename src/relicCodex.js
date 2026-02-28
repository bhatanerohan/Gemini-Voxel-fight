// src/relicCodex.js — Relic drops, codex progression, and decree mutators
import { geminiJSON } from './geminiService.js';
import { appendLoreContext, getLoreRetrieval } from './loreContext.js';
import { showMessage } from './hud.js';

const STORAGE_KEY = 'voxel-arena.relic-codex.v1';
const MEMORY_CHANNELS = Object.freeze(['codex_milestones', 'relic_decodes']);

const REWARD_PROFILES = Object.freeze({
  fire_rate: {
    minBonus: 0.05,
    maxBonus: 0.12,
    cap: 0.35,
    label: (pct) => `+${pct}% fire rate`,
  },
  shield: {
    minBonus: 0.05,
    maxBonus: 0.12,
    cap: 0.3,
    label: (pct) => `-${pct}% incoming damage`,
  },
  weakness: {
    minBonus: 0.05,
    maxBonus: 0.12,
    cap: 0.35,
    label: (pct) => `+${pct}% enemy weakness damage`,
  },
  enemy_hp_shred: {
    minBonus: 0.04,
    maxBonus: 0.1,
    cap: 0.28,
    label: (pct) => `-${pct}% enemy HP`,
  },
  enemy_speed_shred: {
    minBonus: 0.04,
    maxBonus: 0.1,
    cap: 0.24,
    label: (pct) => `-${pct}% enemy speed`,
  },
});

const REWARD_TYPES = Object.keys(REWARD_PROFILES);

const DECREE_LIMITS = Object.freeze({
  playerFireRateMult: [0.8, 1.3],
  playerOutgoingDamageMult: [0.8, 1.3],
  playerIncomingDamageMult: [0.8, 1.35],
  spawnCountMult: [0.75, 1.3],
  enemyHpMult: [0.75, 1.35],
  enemySpeedMult: [0.8, 1.35],
  enemyDamageMult: [0.8, 1.35],
  enemyCooldownMult: [0.75, 1.3],
});

const DEFAULT_DECREE_EFFECTS = Object.freeze({
  playerFireRateMult: 1,
  playerOutgoingDamageMult: 1,
  playerIncomingDamageMult: 1,
  spawnCountMult: 1,
  enemyHpMult: 1,
  enemySpeedMult: 1,
  enemyDamageMult: 1,
  enemyCooldownMult: 1,
});

const MILESTONES = Object.freeze([
  {
    id: 'm25',
    threshold: 25,
    title: 'Codex I',
    bonus: { fire_rate: 0.08 },
    lore: 'Codex I unlocked: pulse cadence glyphs speed up weapon cycling.',
  },
  {
    id: 'm50',
    threshold: 50,
    title: 'Codex II',
    bonus: { shield: 0.1 },
    lore: 'Codex II unlocked: resonance shields bend incoming damage.',
  },
  {
    id: 'm75',
    threshold: 75,
    title: 'Codex III',
    bonus: { weakness: 0.12 },
    lore: 'Codex III unlocked: fracture maps expose enemy weak points.',
  },
  {
    id: 'm100',
    threshold: 100,
    title: 'Codex IV',
    bonus: { fire_rate: 0.08, shield: 0.08, weakness: 0.08 },
    lore: 'Codex IV unlocked: your codex now imprints all Gemini prompts with tactical memory.',
  },
]);

const RELIC_PREFIXES = Object.freeze([
  'Obsidian',
  'Mirrored',
  'Chrono',
  'Cinder',
  'Null',
  'Aether',
  'Feral',
  'Ion',
  'Fractured',
  'Hollow',
]);

const RELIC_CORES = Object.freeze([
  'Sigil',
  'Lattice',
  'Shard',
  'Tablet',
  'Fragment',
  'Lens',
  'Glyph',
  'Circuit',
  'Totem',
  'Spindle',
]);

const RELIC_TRAITS = Object.freeze([
  'etched with duel records from forgotten champions',
  'reflecting outcomes from timelines you never survived',
  'storing the final second of a thousand failed runs',
  'whispering weak-point coordinates in machine cant',
  'dripping static from a dead arena overseer',
  'humming with incomplete kill logs and warning bells',
  'warped by panic spikes from prior matches',
  'encoded with enemy adaptation signatures',
  'bent around a hidden gravitational scar',
  'bound to a decree protocol that should not exist',
]);

const RELIC_RARITIES = Object.freeze({
  Common: { bonusMult: 1, codexMult: 1 },
  Rare: { bonusMult: 1.18, codexMult: 1.12 },
  Epic: { bonusMult: 1.38, codexMult: 1.24 },
  Mythic: { bonusMult: 1.62, codexMult: 1.36 },
});

const DECREE_ARCHETYPES = Object.freeze([
  {
    title: 'Overclock Wager',
    description: 'Higher output, thinner defenses.',
    effects: {
      playerFireRateMult: 1.15,
      playerOutgoingDamageMult: 1.08,
      playerIncomingDamageMult: 1.16,
      spawnCountMult: 1.02,
      enemyHpMult: 0.95,
      enemySpeedMult: 1.06,
      enemyDamageMult: 1.06,
      enemyCooldownMult: 0.95,
    },
  },
  {
    title: 'Bulwark Tax',
    description: 'Tankier run, busier arena.',
    effects: {
      playerFireRateMult: 0.92,
      playerOutgoingDamageMult: 0.94,
      playerIncomingDamageMult: 0.82,
      spawnCountMult: 1.14,
      enemyHpMult: 1.08,
      enemySpeedMult: 0.94,
      enemyDamageMult: 0.92,
      enemyCooldownMult: 1.1,
    },
  },
  {
    title: 'Predator Cadence',
    description: 'Fast kills, faster threats.',
    effects: {
      playerFireRateMult: 1.1,
      playerOutgoingDamageMult: 1.08,
      playerIncomingDamageMult: 1.05,
      spawnCountMult: 1.05,
      enemyHpMult: 0.94,
      enemySpeedMult: 1.14,
      enemyDamageMult: 1.1,
      enemyCooldownMult: 0.93,
    },
  },
  {
    title: 'Grinder Spiral',
    description: 'More enemies, more fragility.',
    effects: {
      playerFireRateMult: 1.03,
      playerOutgoingDamageMult: 0.98,
      playerIncomingDamageMult: 1.09,
      spawnCountMult: 1.22,
      enemyHpMult: 0.86,
      enemySpeedMult: 1.06,
      enemyDamageMult: 1.04,
      enemyCooldownMult: 1.04,
    },
  },
  {
    title: 'Execution Window',
    description: 'Enemy armor breaks, but they hit harder.',
    effects: {
      playerFireRateMult: 1.05,
      playerOutgoingDamageMult: 1.16,
      playerIncomingDamageMult: 1.14,
      spawnCountMult: 0.92,
      enemyHpMult: 0.82,
      enemySpeedMult: 1.03,
      enemyDamageMult: 1.14,
      enemyCooldownMult: 0.98,
    },
  },
  {
    title: 'Stability Protocol',
    description: 'Calmer incoming pressure, slower offense.',
    effects: {
      playerFireRateMult: 0.88,
      playerOutgoingDamageMult: 0.9,
      playerIncomingDamageMult: 0.8,
      spawnCountMult: 1.08,
      enemyHpMult: 1.06,
      enemySpeedMult: 0.9,
      enemyDamageMult: 0.88,
      enemyCooldownMult: 1.12,
    },
  },
  {
    title: 'Merciless Equation',
    description: 'Everything speeds up, including danger.',
    effects: {
      playerFireRateMult: 1.14,
      playerOutgoingDamageMult: 1,
      playerIncomingDamageMult: 1.18,
      spawnCountMult: 1.08,
      enemyHpMult: 1,
      enemySpeedMult: 1.2,
      enemyDamageMult: 1.12,
      enemyCooldownMult: 0.88,
    },
  },
  {
    title: 'Collapse Bet',
    description: 'Shorter fights, no safety net.',
    effects: {
      playerFireRateMult: 1.06,
      playerOutgoingDamageMult: 1.12,
      playerIncomingDamageMult: 1.2,
      spawnCountMult: 0.9,
      enemyHpMult: 0.8,
      enemySpeedMult: 1.08,
      enemyDamageMult: 1.18,
      enemyCooldownMult: 0.94,
    },
  },
  {
    title: 'Containment Leak',
    description: 'More chaos, stronger recoil control.',
    effects: {
      playerFireRateMult: 1.08,
      playerOutgoingDamageMult: 1.04,
      playerIncomingDamageMult: 1.06,
      spawnCountMult: 1.16,
      enemyHpMult: 0.92,
      enemySpeedMult: 1.1,
      enemyDamageMult: 1.05,
      enemyCooldownMult: 1.02,
    },
  },
  {
    title: 'Hunter Truce',
    description: 'Lower enemy pace, lower player tempo.',
    effects: {
      playerFireRateMult: 0.9,
      playerOutgoingDamageMult: 0.95,
      playerIncomingDamageMult: 0.86,
      spawnCountMult: 0.96,
      enemyHpMult: 1.04,
      enemySpeedMult: 0.84,
      enemyDamageMult: 0.9,
      enemyCooldownMult: 1.18,
    },
  },
]);

const DECREES_SYSTEM_PROMPT = `You generate risk/reward mutators for a wave shooter.

Return ONLY JSON with:
{
  "decrees": [
    {
      "title": "short decree title",
      "description": "one short line",
      "playerFireRateMult": 1.0,
      "playerOutgoingDamageMult": 1.0,
      "playerIncomingDamageMult": 1.0,
      "spawnCountMult": 1.0,
      "enemyHpMult": 1.0,
      "enemySpeedMult": 1.0,
      "enemyDamageMult": 1.0,
      "enemyCooldownMult": 1.0
    }
  ]
}

Rules:
- Generate 3 decrees.
- Each decree must include both upside and downside.
- Decrees should feel different from each other.
- Multipliers must stay near 1.0 (small to medium shifts).
- No markdown, no comments, JSON only.`;

const RELIC_SYSTEM_PROMPT = `You decode a relic from a sci-fi arena shooter.

Return ONLY JSON with:
{
  "name": "short relic name",
  "insight": "one to two lines of lore insight",
  "reward": "fire_rate|shield|weakness|enemy_hp_shred|enemy_speed_shred",
  "bonus": 0.06,
  "codexGain": 20
}

Rules:
- reward must be one of fire_rate, shield, weakness, enemy_hp_shred, enemy_speed_shred.
- bonus must be between 0.04 and 0.12.
- codexGain must be between 14 and 36.
- Keep insight concise and vivid.
- JSON only.`;

const DEFAULT_PERSISTENT_STATE = Object.freeze({
  progress: 0,
  decodedCount: 0,
  milestones: {
    m25: false,
    m50: false,
    m75: false,
    m100: false,
  },
});

function createEmptyRelicBonuses() {
  return {
    fire_rate: 0,
    shield: 0,
    weakness: 0,
    enemy_hp_shred: 0,
    enemy_speed_shred: 0,
  };
}

let _persistent = loadPersistentState();
let _runtime = {
  relicBonuses: createEmptyRelicBonuses(),
  activeDecree: null,
};

let _ui = null;
let _session = null;
let _decreeAbortController = null;

function clampNumber(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function sanitizeText(text, fallback = '') {
  if (typeof text !== 'string') return fallback;
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return fallback;
  return clean.slice(0, 220);
}

function hashSeed(input) {
  const text = String(input || '');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seedInput) {
  let state = hashSeed(seedInput) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickFrom(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function pickWeighted(items, rng) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (total <= 0) return items[0]?.id || null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, Number(item.weight) || 0);
    if (roll <= 0) return item.id;
  }
  return items[items.length - 1]?.id || null;
}

function loadPersistentState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PERSISTENT_STATE);
    const parsed = JSON.parse(raw);
    return sanitizePersistentState(parsed);
  } catch (_) {
    return structuredClone(DEFAULT_PERSISTENT_STATE);
  }
}

function sanitizePersistentState(state) {
  const progress = clampNumber(state?.progress, 0, 100, 0);
  return {
    progress,
    decodedCount: Math.max(0, Math.floor(Number(state?.decodedCount) || 0)),
    milestones: {
      m25: progress >= 25 || !!state?.milestones?.m25,
      m50: progress >= 50 || !!state?.milestones?.m50,
      m75: progress >= 75 || !!state?.milestones?.m75,
      m100: progress >= 100 || !!state?.milestones?.m100,
    },
  };
}

function savePersistentState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_persistent));
  } catch (_) {
    // ignore storage failures
  }
}

function getPermanentBonuses() {
  let fireRate = 0;
  let shield = 0;
  let weakness = 0;
  for (const milestone of MILESTONES) {
    if (!_persistent.milestones[milestone.id]) continue;
    fireRate += Number(milestone.bonus.fire_rate || 0);
    shield += Number(milestone.bonus.shield || 0);
    weakness += Number(milestone.bonus.weakness || 0);
  }
  return { fire_rate: fireRate, shield, weakness };
}

function getActiveDecreeForWave(wave) {
  const decree = _runtime.activeDecree;
  if (!decree) return null;
  if (!Number.isFinite(wave) || wave <= 0) return null;
  return decree.wave === wave ? decree : null;
}

function sanitizeDecree(raw, fallbackTitle = 'Decree') {
  const title = sanitizeText(raw?.title, fallbackTitle).slice(0, 42);
  const description = sanitizeText(raw?.description, 'Risk and reward ripple through the arena.').slice(0, 120);
  const out = { title, description };
  for (const [key, [min, max]] of Object.entries(DECREE_LIMITS)) {
    out[key] = round3(clampNumber(raw?.[key], min, max, DEFAULT_DECREE_EFFECTS[key]));
  }
  return out;
}

function jitterEffects(base, wave, rng) {
  const waveFactor = Math.min(0.03, wave * 0.0025);
  const jitter = 0.015 + waveFactor;
  const out = {};
  for (const [key, [min, max]] of Object.entries(DECREE_LIMITS)) {
    const value = Number(base[key] ?? DEFAULT_DECREE_EFFECTS[key]);
    const shifted = value + (rng() * 2 - 1) * jitter;
    out[key] = clampNumber(shifted, min, max, DEFAULT_DECREE_EFFECTS[key]);
  }
  return out;
}

function fallbackDecrees(wave = 1, codexProgress = 0) {
  const nWave = Math.max(1, Math.floor(Number(wave) || 1));
  const rng = createRng(`${nWave}:${Math.round(codexProgress)}:${_persistent.decodedCount}`);
  const pool = DECREE_ARCHETYPES.slice();
  const picked = [];
  while (picked.length < 3 && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  const results = picked.map((template, i) => {
    const effects = jitterEffects(template.effects, nWave, rng);
    return sanitizeDecree(
      {
        title: `${template.title}${nWave >= 6 && i === 0 ? ' +' : ''}`,
        description: template.description,
        ...effects,
      },
      `Decree ${i + 1}`,
    );
  });

  while (results.length < 3) {
    results.push(
      sanitizeDecree(
        {
          title: `Arena Shift ${results.length + 1}`,
          description: 'Adaptive pressure with balanced risk and reward.',
          ...jitterEffects(DEFAULT_DECREE_EFFECTS, nWave, rng),
        },
        `Decree ${results.length + 1}`,
      ),
    );
  }

  return results;
}

async function generateDecrees(wave, codexProgress, signal) {
  const fallback = fallbackDecrees(wave, codexProgress);
  const retrieval = getLoreRetrieval({
    query: `wave ${wave} decree risk reward codex progress ${codexProgress}`,
    channels: MEMORY_CHANNELS,
    limit: 6,
    maxChars: 1800,
  });

  const contextBlock = retrieval.text
    ? `\n\nCombat memory context (from decoded relics + codex milestones):\n${retrieval.text}`
    : '';

  const ai = await geminiJSON({
    systemPrompt: DECREES_SYSTEM_PROMPT,
    userMessage: `Wave: ${wave}\nCodex progress: ${codexProgress}${contextBlock}\nGenerate three decrees with clear tradeoffs.`,
    temperature: 0.6,
    maxTokens: 820,
    signal,
  });

  const rawList = Array.isArray(ai?.decrees) ? ai.decrees : [];
  if (rawList.length < 2) return fallback;

  const mapped = rawList.slice(0, 3).map((entry, idx) => sanitizeDecree(entry, `Decree ${idx + 1}`));
  const usedTitles = new Set(mapped.map(d => d.title.toLowerCase()));
  for (const alt of fallback) {
    if (mapped.length >= 3) break;
    const key = alt.title.toLowerCase();
    if (usedTitles.has(key)) continue;
    mapped.push(alt);
    usedTitles.add(key);
  }
  while (mapped.length < 3) mapped.push(fallback[mapped.length]);
  return mapped;
}

function chooseRewardType(wave, rng) {
  return pickWeighted([
    { id: 'fire_rate', weight: 24 },
    { id: 'shield', weight: 24 },
    { id: 'weakness', weight: 24 },
    { id: 'enemy_hp_shred', weight: 8 + Math.min(14, wave * 2) },
    { id: 'enemy_speed_shred', weight: 8 + Math.min(14, wave * 2) },
  ], rng) || 'fire_rate';
}

function rollRarity(wave, rng) {
  const nWave = Math.max(1, Math.floor(Number(wave) || 1));
  const mythicChance = Math.min(0.11, 0.01 + nWave * 0.004);
  const epicChance = Math.min(0.25, 0.06 + nWave * 0.01);
  const rareChance = Math.min(0.44, 0.2 + nWave * 0.012);
  const roll = rng();
  if (roll < mythicChance) return 'Mythic';
  if (roll < mythicChance + epicChance) return 'Epic';
  if (roll < mythicChance + epicChance + rareChance) return 'Rare';
  return 'Common';
}

function clampRewardBonus(rewardType, value, fallback) {
  const profile = REWARD_PROFILES[rewardType] || REWARD_PROFILES.fire_rate;
  return round3(clampNumber(value, profile.minBonus, profile.maxBonus, fallback));
}

function fallbackRelicDecode(relic, wave) {
  const nWave = Math.max(1, Math.floor(Number(wave) || 1));
  const rarity = relic?.rarity && RELIC_RARITIES[relic.rarity] ? relic.rarity : 'Common';
  const rarityProfile = RELIC_RARITIES[rarity];
  const rng = createRng(`${relic?.name || 'Relic'}:${nWave}:${_persistent.decodedCount}`);

  const reward = chooseRewardType(nWave, rng);
  const rewardProfile = REWARD_PROFILES[reward] || REWARD_PROFILES.fire_rate;
  const baseBonus = rewardProfile.minBonus + (rewardProfile.maxBonus - rewardProfile.minBonus) * rng();
  const bonus = clampRewardBonus(reward, baseBonus * rarityProfile.bonusMult, rewardProfile.minBonus);

  const codexBase = 14 + Math.round(rng() * 10) + Math.round(nWave * 0.8);
  const codexGain = Math.round(clampNumber(codexBase * rarityProfile.codexMult, 14, 36, 20));

  const insightTemplates = [
    `${relic.name} exposes an exploitable cadence in the arena response loop.`,
    `${relic.name} syncs with your combat memory and rewrites enemy approach windows.`,
    `${relic.name} stabilizes a tactical echo from prior wave collapses.`,
    `${relic.name} binds to your codex and reveals a sharper pressure pattern.`,
  ];

  return {
    name: relic.name,
    rarity,
    insight: pickFrom(insightTemplates, rng),
    reward,
    bonus,
    codexGain,
  };
}

async function decodeRelic(relic, wave, signal) {
  const fallback = fallbackRelicDecode(relic, wave);
  const retrieval = getLoreRetrieval({
    query: `${relic?.name || 'relic'} decode reward codex wave ${wave}`,
    channels: MEMORY_CHANNELS,
    limit: 6,
    maxChars: 1600,
  });

  const contextBlock = retrieval.text
    ? `\nCombat memory context (decoded relics + codex milestones):\n${retrieval.text}\n`
    : '';

  const ai = await geminiJSON({
    systemPrompt: RELIC_SYSTEM_PROMPT,
    userMessage: `Relic name: ${relic?.name || 'Unknown Relic'}\nRarity: ${relic?.rarity || 'Common'}\nRelic trait: ${relic?.flavor || ''}\nWave: ${wave}\n${contextBlock}`,
    temperature: 0.52,
    maxTokens: 320,
    signal,
  });

  if (!ai || typeof ai !== 'object') return fallback;

  const reward = REWARD_TYPES.includes(ai.reward) ? ai.reward : fallback.reward;
  const rarity = relic?.rarity && RELIC_RARITIES[relic.rarity] ? relic.rarity : fallback.rarity;
  const rarityProfile = RELIC_RARITIES[rarity] || RELIC_RARITIES.Common;

  const rewardProfile = REWARD_PROFILES[reward] || REWARD_PROFILES.fire_rate;
  const aiBonus = clampNumber(ai.bonus, rewardProfile.minBonus, rewardProfile.maxBonus, fallback.bonus);
  const boostedBonus = clampRewardBonus(reward, aiBonus * rarityProfile.bonusMult, fallback.bonus);

  return {
    name: sanitizeText(ai.name, relic?.name || fallback.name).slice(0, 48),
    rarity,
    insight: sanitizeText(ai.insight, fallback.insight).slice(0, 220),
    reward,
    bonus: boostedBonus,
    codexGain: Math.round(clampNumber(ai.codexGain, 14, 36, fallback.codexGain)),
  };
}

function getRewardLabel(rewardType, bonus) {
  const profile = REWARD_PROFILES[rewardType] || REWARD_PROFILES.fire_rate;
  return profile.label(Math.round(bonus * 100));
}

function applyRelicReward(rewardType, bonus) {
  const key = REWARD_TYPES.includes(rewardType) ? rewardType : 'fire_rate';
  const profile = REWARD_PROFILES[key] || REWARD_PROFILES.fire_rate;
  const next = clampNumber((_runtime.relicBonuses[key] || 0) + bonus, 0, profile.cap, 0);
  _runtime.relicBonuses[key] = round3(next);
}

function applyCodexProgress(amount) {
  const prev = _persistent.progress;
  _persistent.progress = clampNumber(prev + amount, 0, 100, prev);
  _persistent.decodedCount += 1;
  const unlocked = [];
  for (const milestone of MILESTONES) {
    if (_persistent.progress < milestone.threshold) continue;
    if (_persistent.milestones[milestone.id]) continue;
    _persistent.milestones[milestone.id] = true;
    unlocked.push(milestone);
    appendLoreContext(`[Codex Milestone] ${milestone.lore}`, {
      fileName: 'Codex Milestones',
      sourceType: 'codex',
    });
  }
  savePersistentState();
  return unlocked;
}

function getRelicDescriptor(wave) {
  const nWave = Math.max(1, Math.floor(Number(wave) || 1));
  const rng = createRng(`${nWave}:${_persistent.decodedCount}:${Date.now()}`);
  const rarity = rollRarity(nWave, rng);
  const prefix = pickFrom(RELIC_PREFIXES, rng);
  const core = pickFrom(RELIC_CORES, rng);
  const trait = pickFrom(RELIC_TRAITS, rng);
  return {
    name: `${prefix} ${core} ${nWave}`,
    rarity,
    flavor: trait,
  };
}

function ensureUI() {
  if (_ui) return _ui;
  _ui = {
    panel: document.getElementById('codex-panel'),
    progressText: document.getElementById('codex-progress-text'),
    progressFill: document.getElementById('codex-progress-fill'),
    bonuses: document.getElementById('codex-bonuses'),
    activeDecree: document.getElementById('codex-active-decree'),
    overlay: document.getElementById('intermission-overlay'),
    waveLabel: document.getElementById('intermission-wave'),
    relicName: document.getElementById('intermission-relic-name'),
    relicFlavor: document.getElementById('intermission-relic-flavor'),
    relicResult: document.getElementById('intermission-relic-result'),
    decodeBtn: document.getElementById('relic-decode-btn'),
    skipBtn: document.getElementById('relic-skip-btn'),
    decreeStatus: document.getElementById('intermission-decree-status'),
    decreeList: document.getElementById('intermission-decree-list'),
  };
  return _ui;
}

function renderCodexPanel() {
  const ui = ensureUI();
  if (!ui.panel) return;

  const pct = Math.round(_persistent.progress);
  if (ui.progressText) ui.progressText.textContent = `${pct}%`;
  if (ui.progressFill) ui.progressFill.style.width = `${pct}%`;

  const permanent = getPermanentBonuses();
  const relic = _runtime.relicBonuses;
  const bonusLine = [
    `Fire +${Math.round((permanent.fire_rate + relic.fire_rate) * 100)}%`,
    `Shield ${Math.round((permanent.shield + relic.shield) * 100)}%`,
    `Weakness +${Math.round((permanent.weakness + relic.weakness) * 100)}%`,
    `Break HP -${Math.round((relic.enemy_hp_shred || 0) * 100)}%`,
    `Slow -${Math.round((relic.enemy_speed_shred || 0) * 100)}%`,
  ];
  if (ui.bonuses) ui.bonuses.textContent = bonusLine.join(' | ');

  if (ui.activeDecree) {
    if (_runtime.activeDecree) {
      ui.activeDecree.textContent = `Next/Active Decree: ${_runtime.activeDecree.title} (W${_runtime.activeDecree.wave})`;
    } else {
      ui.activeDecree.textContent = 'No decree selected for next wave.';
    }
  }
}

function closeIntermission() {
  const ui = ensureUI();
  if (ui.overlay) ui.overlay.classList.remove('open');
  window._blockGameInput = false;
}

function openIntermission() {
  const ui = ensureUI();
  if (ui.overlay) ui.overlay.classList.add('open');
  window._blockGameInput = true;
}

function setDecreeStatus(text) {
  const ui = ensureUI();
  if (ui.decreeStatus) ui.decreeStatus.textContent = text;
}

function clearDecreeButtons() {
  const ui = ensureUI();
  if (!ui.decreeList) return;
  ui.decreeList.innerHTML = '';
}

function renderDecreesForSession(session) {
  const ui = ensureUI();
  if (!ui.decreeList) return;

  clearDecreeButtons();
  if (!session.readyForDecree) {
    setDecreeStatus('Decode or skip relic to unlock decree choice.');
    return;
  }
  if (!session.decrees.length) {
    setDecreeStatus('Preparing decrees...');
    return;
  }

  setDecreeStatus('Choose one decree for the next wave.');
  for (const decree of session.decrees) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'decree-option';

    const title = document.createElement('span');
    title.className = 'decree-title';
    title.textContent = decree.title;

    const desc = document.createElement('span');
    desc.className = 'decree-desc';
    desc.textContent = decree.description;

    btn.append(title, desc);
    btn.addEventListener('click', () => {
      if (_session !== session) return;
      const targetWave = session.wave + 1;
      _runtime.activeDecree = {
        ...sanitizeDecree(decree, 'Decree'),
        wave: targetWave,
      };
      renderCodexPanel();
      showMessage(`Decree selected: ${decree.title}`, 2200);
      closeIntermission();
      if (session.resolve) session.resolve();
      _session = null;
    });

    ui.decreeList.appendChild(btn);
  }
}

async function handleDecode(session) {
  const ui = ensureUI();
  if (!ui.decodeBtn || !ui.skipBtn || !ui.relicResult) return;
  if (session.decoded) return;

  session.decoded = true;
  ui.decodeBtn.disabled = true;
  ui.skipBtn.disabled = true;
  ui.decodeBtn.textContent = 'Decoding...';
  ui.relicResult.textContent = 'Interpreting relic memory...';

  try {
    const decoded = await decodeRelic(session.relic, session.wave);
    const reward = REWARD_TYPES.includes(decoded.reward) ? decoded.reward : 'fire_rate';
    const bonus = clampRewardBonus(reward, decoded.bonus, 0.06);
    applyRelicReward(reward, bonus);
    const unlocked = applyCodexProgress(decoded.codexGain);

    appendLoreContext(`[Relic Decode] ${decoded.name}: ${decoded.insight}`, {
      fileName: 'Relic Decodes',
      sourceType: 'relic',
    });

    renderCodexPanel();

    const milestoneText = unlocked.length
      ? `\nUnlocked: ${unlocked.map(m => m.title).join(', ')}`
      : '';

    ui.relicResult.textContent = `${decoded.insight}\nRarity: ${decoded.rarity}\nReward: ${getRewardLabel(reward, bonus)}\nCodex +${decoded.codexGain}%${milestoneText}`;
    showMessage(`Relic decoded (${decoded.rarity}): ${getRewardLabel(reward, bonus)}`, 2600);
  } catch (err) {
    session.decoded = false;
    ui.relicResult.textContent = `Decode failed: ${err?.message || 'unknown error'}`;
    ui.decodeBtn.disabled = false;
    ui.skipBtn.disabled = false;
    ui.decodeBtn.textContent = 'Decode Relic';
    return;
  }

  ui.decodeBtn.textContent = 'Decoded';
  session.readyForDecree = true;
  loadDecreesForSession(session);
}

function handleSkipDecode(session) {
  const ui = ensureUI();
  if (!ui.decodeBtn || !ui.skipBtn || !ui.relicResult) return;

  session.decoded = true;
  session.readyForDecree = true;
  ui.decodeBtn.disabled = true;
  ui.skipBtn.disabled = true;
  ui.decodeBtn.textContent = 'Skipped';
  ui.relicResult.textContent = 'Relic archived without decode. No bonus awarded.';
  loadDecreesForSession(session);
}

async function loadDecreesForSession(session) {
  if (_decreeAbortController) _decreeAbortController.abort();
  const ctrl = new AbortController();
  _decreeAbortController = ctrl;
  const timeoutId = setTimeout(() => ctrl.abort(), 9000);

  try {
    const decrees = await generateDecrees(session.wave + 1, _persistent.progress, ctrl.signal);
    if (_session !== session || ctrl.signal.aborted) return;
    session.decrees = Array.isArray(decrees) ? decrees : [];
    renderDecreesForSession(session);
  } catch (_) {
    if (_session !== session || ctrl.signal.aborted) return;
    session.decrees = fallbackDecrees(session.wave + 1, _persistent.progress);
    renderDecreesForSession(session);
  } finally {
    clearTimeout(timeoutId);
    if (_decreeAbortController === ctrl) _decreeAbortController = null;
  }
}

export function initRelicCodexSystem() {
  const ui = ensureUI();
  renderCodexPanel();
  closeIntermission();

  if (ui.decodeBtn) {
    ui.decodeBtn.addEventListener('click', () => {
      if (_session) handleDecode(_session);
    });
  }
  if (ui.skipBtn) {
    ui.skipBtn.addEventListener('click', () => {
      if (_session) handleSkipDecode(_session);
    });
  }
}

export function beginRelicIntermission(wave) {
  const ui = ensureUI();
  if (!ui.overlay) return Promise.resolve();

  const nWave = Math.max(1, Math.floor(Number(wave) || 1));
  if (_session?.resolve) _session.resolve();
  if (_decreeAbortController) _decreeAbortController.abort();

  const relic = getRelicDescriptor(nWave);
  const session = {
    wave: nWave,
    relic,
    decoded: false,
    readyForDecree: false,
    decrees: [],
    resolve: null,
  };
  _session = session;

  if (ui.waveLabel) ui.waveLabel.textContent = `Wave ${nWave} clear`;
  if (ui.relicName) ui.relicName.textContent = `${relic.name} [${relic.rarity}]`;
  if (ui.relicFlavor) ui.relicFlavor.textContent = relic.flavor;
  if (ui.relicResult) ui.relicResult.textContent = '';

  if (ui.decodeBtn) {
    ui.decodeBtn.disabled = false;
    ui.decodeBtn.textContent = 'Decode Relic';
  }
  if (ui.skipBtn) ui.skipBtn.disabled = false;

  clearDecreeButtons();
  setDecreeStatus('Decode or skip relic to unlock decree choice.');
  openIntermission();

  return new Promise((resolve) => {
    session.resolve = () => resolve();
  });
}

export function dismissRelicIntermission() {
  if (_decreeAbortController) _decreeAbortController.abort();
  _decreeAbortController = null;
  if (_session?.resolve) _session.resolve();
  _session = null;
  closeIntermission();
}

export function getCombatModifiersForWave(wave) {
  const w = Math.max(0, Math.floor(Number(wave) || 0));
  const permanent = getPermanentBonuses();
  const relic = _runtime.relicBonuses;
  const decree = getActiveDecreeForWave(w) || DEFAULT_DECREE_EFFECTS;

  const fireRateBonus = permanent.fire_rate + (relic.fire_rate || 0);
  const weaknessBonus = permanent.weakness + (relic.weakness || 0);
  const shieldBonus = permanent.shield + (relic.shield || 0);

  return {
    fireRateMult: round3(clampNumber((1 + fireRateBonus) * decree.playerFireRateMult, 0.6, 2.4, 1)),
    outgoingDamageMult: round3(clampNumber((1 + weaknessBonus) * decree.playerOutgoingDamageMult, 0.6, 2.5, 1)),
    incomingDamageMult: round3(clampNumber((1 - shieldBonus) * decree.playerIncomingDamageMult, 0.35, 1.6, 1)),
  };
}

export function getEnemyWaveModifiersForWave(wave) {
  const decree = getActiveDecreeForWave(Math.max(0, Math.floor(Number(wave) || 0)));
  const base = decree || DEFAULT_DECREE_EFFECTS;
  const relic = _runtime.relicBonuses;

  const hpShred = clampNumber(relic.enemy_hp_shred || 0, 0, 0.35, 0);
  const speedShred = clampNumber(relic.enemy_speed_shred || 0, 0, 0.35, 0);

  return {
    playerFireRateMult: base.playerFireRateMult,
    playerOutgoingDamageMult: base.playerOutgoingDamageMult,
    playerIncomingDamageMult: base.playerIncomingDamageMult,
    spawnCountMult: base.spawnCountMult,
    enemyHpMult: round3(clampNumber(base.enemyHpMult * (1 - hpShred), 0.55, 1.6, 1)),
    enemySpeedMult: round3(clampNumber(base.enemySpeedMult * (1 - speedShred), 0.55, 1.6, 1)),
    enemyDamageMult: base.enemyDamageMult,
    enemyCooldownMult: base.enemyCooldownMult,
  };
}

export function getCodexPromptContext() {
  const perks = getPermanentBonuses();
  const relic = _runtime.relicBonuses;
  const lines = [];
  lines.push(`Codex progress: ${Math.round(_persistent.progress)}%`);
  lines.push(`Permanent perks => fire:${Math.round(perks.fire_rate * 100)}% shield:${Math.round(perks.shield * 100)}% weakness:${Math.round(perks.weakness * 100)}%`);
  lines.push(`Relic boons => fire:${Math.round((relic.fire_rate || 0) * 100)}% shield:${Math.round((relic.shield || 0) * 100)}% weak:${Math.round((relic.weakness || 0) * 100)}% hpBreak:${Math.round((relic.enemy_hp_shred || 0) * 100)}% speedBreak:${Math.round((relic.enemy_speed_shred || 0) * 100)}%`);
  if (_runtime.activeDecree) {
    lines.push(`Active decree (wave ${_runtime.activeDecree.wave}): ${_runtime.activeDecree.title}`);
    lines.push(_runtime.activeDecree.description);
  }
  return lines.join('\n');
}

export function resetRelicRunState() {
  _runtime = {
    relicBonuses: createEmptyRelicBonuses(),
    activeDecree: null,
  };
  dismissRelicIntermission();
  renderCodexPanel();
}
