// tests/agentTest.js — Comprehensive agent output validation test suite
// Run: node tests/agentTest.js [runs_per_agent] [agent_name]
// Example: node tests/agentTest.js 50
// Example: node tests/agentTest.js 10 themeGenerator

import 'dotenv/config';
import fs from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3-flash-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
const RUNS_PER_AGENT = parseInt(process.argv[2]) || 50;
const FILTER_AGENT = process.argv[3] || null;

if (!API_KEY) {
  console.error('ERROR: GEMINI_API_KEY not set in .env');
  process.exit(1);
}

// ── Rate limiter (20 req/min = 1 every 3s, but we'll do 1 per 3.5s to be safe) ──
const RATE_LIMIT_MS = 3500;
let lastCallTime = 0;

async function rateLimitedWait() {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastCallTime = Date.now();
}

// ── Gemini caller ──
async function callGemini(systemPrompt, userMessage, temperature = 0.9, maxTokens = 8192) {
  await rateLimitedWait();

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { error: `HTTP ${res.status}: ${errText.slice(0, 200)}`, raw: null };
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return { error: 'Empty response content', raw: null };

  // Try parse JSON
  try {
    return { error: null, raw: text, parsed: JSON.parse(text) };
  } catch (_) {}

  // Try markdown fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return { error: null, raw: text, parsed: JSON.parse(fenceMatch[1].trim()) };
    } catch (_) {}
  }

  // Try brace extraction
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return { error: null, raw: text, parsed: JSON.parse(text.slice(first, last + 1)) };
    } catch (_) {}
  }

  return { error: 'JSON parse failed', raw: text.slice(0, 500) };
}

// ── Validation helpers ──
function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
function isStr(v) { return typeof v === 'string' && v.length > 0; }
function isNum(v, min, max) { return typeof v === 'number' && v >= min && v <= max; }
function isOneOf(v, opts) { return opts.includes(v); }
function isBool(v) { return typeof v === 'boolean'; }
function isArr(v, minLen = 0) { return Array.isArray(v) && v.length >= minLen; }

// ── Agent definitions with validators ──
const AGENTS = {
  themeGenerator: {
    name: 'Theme Generator',
    systemPrompt: `You are a JSON-only API that outputs color themes for a 3D voxel arena shooter.
You MUST respond with ONLY a single JSON object. No markdown, no code fences, no explanation, no text before or after.

The JSON must match this exact schema (all colors as "#rrggbb" hex strings):
{
  "name": "Neon Arena",
  "background": "#0a0a2e",
  "fog": { "color": "#0a0a2e", "density": 0.01 },
  "ground": "#141435",
  "grid": { "color": "#2a2a66", "opacity": 0.4 },
  "cover": "#2a2a55",
  "platform": "#333366",
  "accent": { "color": "#0066ff", "emissive": "#003399" },
  "boundary": { "color": "#00ccff", "emissive": "#0066aa" },
  "lighting": {
    "ambient": { "color": "#334466", "intensity": 0.7 },
    "sun": { "color": "#aaccff", "intensity": 0.9 },
    "hemisphere": { "sky": "#4488ff", "ground": "#221133", "intensity": 0.4 }
  },
  "bloom": { "strength": 1.2, "radius": 0.4, "threshold": 0.25 }
}

Rules:
- Create vivid, atmospheric themes for a dark 3D environment
- Background and fog should be dark (players need visibility)
- Boundary and accent should be bright/emissive
- Give creative, evocative names
- Output ONLY valid JSON`,
    userMessages: [
      'Create a theme inspired by: "underwater temple"',
      'Create a theme inspired by: "volcanic hellscape"',
      'Create a theme inspired by: "cyberpunk neon city"',
      'Create a theme inspired by: "frozen tundra"',
      'Create a surprising, creative arena theme. Be bold and imaginative.',
    ],
    temperature: 0.9,
    maxTokens: 4096,
    validate(obj) {
      const errors = [];
      if (!isStr(obj.name)) errors.push('missing/invalid name');
      if (!isHex(obj.background)) errors.push(`bad background: ${obj.background}`);
      if (!isHex(obj.fog?.color)) errors.push(`bad fog.color: ${obj.fog?.color}`);
      if (!isNum(obj.fog?.density, 0.001, 0.1)) errors.push(`bad fog.density: ${obj.fog?.density}`);
      if (!isHex(obj.ground)) errors.push(`bad ground: ${obj.ground}`);
      if (!isHex(obj.grid?.color)) errors.push(`bad grid.color`);
      if (!isNum(obj.grid?.opacity, 0, 1)) errors.push(`bad grid.opacity`);
      if (!isHex(obj.cover)) errors.push(`bad cover`);
      if (!isHex(obj.platform)) errors.push(`bad platform`);
      if (!isHex(obj.accent?.color)) errors.push(`bad accent.color`);
      if (!isHex(obj.accent?.emissive)) errors.push(`bad accent.emissive`);
      if (!isHex(obj.boundary?.color)) errors.push(`bad boundary.color`);
      if (!isHex(obj.boundary?.emissive)) errors.push(`bad boundary.emissive`);
      // Lighting
      if (!isHex(obj.lighting?.ambient?.color)) errors.push('bad lighting.ambient.color');
      if (!isNum(obj.lighting?.ambient?.intensity, 0, 5)) errors.push('bad lighting.ambient.intensity');
      if (!isHex(obj.lighting?.sun?.color)) errors.push('bad lighting.sun.color');
      if (!isNum(obj.lighting?.sun?.intensity, 0, 5)) errors.push('bad lighting.sun.intensity');
      if (!isHex(obj.lighting?.hemisphere?.sky)) errors.push('bad lighting.hemisphere.sky');
      if (!isHex(obj.lighting?.hemisphere?.ground)) errors.push('bad lighting.hemisphere.ground');
      if (!isNum(obj.lighting?.hemisphere?.intensity, 0, 5)) errors.push('bad lighting.hemisphere.intensity');
      // Bloom
      if (!isNum(obj.bloom?.strength, 0, 5)) errors.push('bad bloom.strength');
      if (!isNum(obj.bloom?.radius, 0, 2)) errors.push('bad bloom.radius');
      if (!isNum(obj.bloom?.threshold, 0, 1)) errors.push('bad bloom.threshold');
      return errors;
    },
  },

  arenaGod: {
    name: 'Arena God',
    systemPrompt: `You are the Arena God — a sardonic, omniscient, sentient arena AI personality (think GLaDOS meets a Roman emperor). You control a voxel combat arena and watch a lone player fight waves of enemies.

VOICE RULES:
- Speak in 1-2 short, punchy sentences. Never more.
- Address the player as "you". Never use their name.
- Be sardonic, darkly witty, occasionally impressed (but never admit it easily).
- Vary your tone: amused, angry, impressed, bored, contemptuous, neutral.

RESPONSE FORMAT (strict JSON):
{
  "dialogue": "Your line here.",
  "tone": "amused|angry|impressed|bored|contemptuous|neutral",
  "mutation": null,
  "enemy_modifier": null
}

mutation (when used):
{ "type": "remove_cover|add_hazard|shrink_arena|spawn_champion|theme_shift", "detail": "brief description" }

enemy_modifier (when used):
{ "type": "resistance|speed_buff|rage", "target": "all|type:tank|type:charger", "detail": "brief description" }

For quick quip triggers (near_death, multi_kill, first_forge), NEVER include mutation or enemy_modifier — set both to null.
For game_over, give a memorable final line. No mutation.`,
    userMessages: [
      'TRIGGER: wave_end\nCURRENT THEME: Neon Arena\nWave 3 cleared. Player used frost cannon for 3 waves straight. 12 kills, took 30 damage. Hiding behind cover a lot.',
      'TRIGGER: near_death\nPlayer at 5 HP, barely survived a charger attack.',
      'TRIGGER: multi_kill\n4 enemies killed in 2 seconds with plasma shotgun.',
      'TRIGGER: game_over\nPlayer died on wave 7. 45 total kills. Used 3 different forged weapons. Final death by champion enemy "Vex the Unyielding".',
      'TRIGGER: first_forge\nPlayer just forged their first weapon: "Lightning Whip"',
      'TRIGGER: wave_end\nWave 5 cleared. Player dominating — 0 damage taken. Using same sniper weapon since wave 1.',
    ],
    temperature: 0.9,
    maxTokens: 4096,
    validate(obj) {
      const errors = [];
      if (!isStr(obj.dialogue)) errors.push('missing dialogue');
      if (obj.dialogue && obj.dialogue.length > 200) errors.push(`dialogue too long: ${obj.dialogue.length} chars`);
      const validTones = ['amused', 'angry', 'impressed', 'bored', 'contemptuous', 'neutral'];
      if (!isOneOf(obj.tone, validTones)) errors.push(`bad tone: ${obj.tone}`);
      // mutation should be null or valid object
      if (obj.mutation !== null && obj.mutation !== undefined) {
        if (typeof obj.mutation !== 'object') errors.push('mutation must be object or null');
        else {
          const validMutTypes = ['remove_cover', 'add_hazard', 'shrink_arena', 'spawn_champion', 'theme_shift'];
          if (!isOneOf(obj.mutation.type, validMutTypes)) errors.push(`bad mutation.type: ${obj.mutation.type}`);
          if (!isStr(obj.mutation.detail)) errors.push('mutation missing detail');
        }
      }
      if (obj.enemy_modifier !== null && obj.enemy_modifier !== undefined) {
        if (typeof obj.enemy_modifier !== 'object') errors.push('enemy_modifier must be object or null');
        else {
          const validModTypes = ['resistance', 'speed_buff', 'rage'];
          if (!isOneOf(obj.enemy_modifier.type, validModTypes)) errors.push(`bad enemy_modifier.type`);
        }
      }
      return errors;
    },
  },

  warChronicle: {
    name: 'War Chronicle',
    systemPrompt: `You are an ancient war chronicler who records the legends of the Voxel Arena. Write a 150-250 word dramatic retelling of a combat arena match. Reference actual enemy names and weapon names from the match data.

OUTPUT FORMAT — respond with ONLY this JSON, no other text:
{
  "title": "The Battle of [Arena Theme] — A Chronicle",
  "chronicle": "Full 150-250 word narrative text...",
  "keyMoment": "One vivid sentence capturing the most dramatic moment"
}`,
    userMessages: [
      'Match data: Wave 5. Arena: Neon Abyss. Enemies killed: Kira the Bold (wave 1), Vex Frostbitten (wave 2), Drax the Merciless + Null Shadow (wave 3), Zira the Cunning + 3 grunts (wave 4), champion Gorath the Unyielding + 4 grunts (wave 5 - player died). Weapons forged: Frost Cannon (wave 1), Plasma Shotgun (wave 3). Score: 2450. Player was overwhelmed by Gorath.',
      'Match data: Wave 2. Arena: Scorched Earth. Enemies killed: 3 grunts wave 1, Rax the Furious wave 2. Weapons: default blaster only. Score: 800. Player died to Rax\'s charge attack at low HP.',
      'Match data: Wave 10. Arena: Arctic Void. 67 total kills. Weapons: Lightning Whip, Black Hole Generator, Frost Nova. Champions defeated: Vex, Kira, Gorath, Null. Score: 8900. Player survived 10 waves before being overwhelmed by a double-champion wave.',
    ],
    temperature: 0.95,
    maxTokens: 4096,
    validate(obj) {
      const errors = [];
      if (!isStr(obj.title)) errors.push('missing title');
      if (!isStr(obj.chronicle)) errors.push('missing chronicle');
      if (obj.chronicle) {
        const wordCount = obj.chronicle.split(/\s+/).length;
        if (wordCount < 80) errors.push(`chronicle too short: ${wordCount} words`);
        if (wordCount > 400) errors.push(`chronicle too long: ${wordCount} words`);
      }
      if (!isStr(obj.keyMoment)) errors.push('missing keyMoment');
      return errors;
    },
  },

  arenaGen: {
    name: 'Arena Gen Agent',
    systemPrompt: `You are an arena architect for a voxel combat game.
Design unique, atmospheric combat arenas. Arena bounds: X and Z from -45 to 45. Player spawns at center (0,0,0). Keep clear area (radius ~8) around center.

All hex colors must be valid 6-digit codes prefixed with #. Coordinates within bounds.

Respond with ONLY valid JSON:
{
  "theme": {
    "name": "Theme Name",
    "backgroundColor": "#hex",
    "fogColor": "#hex",
    "fogDensity": 0.015,
    "floorColor": "#hex",
    "wallColor": "#hex",
    "ambientLightColor": "#hex",
    "ambientIntensity": 0.5
  },
  "coverBlocks": [
    { "x": 12, "z": 12, "width": 2, "height": 2.5, "depth": 2, "color": "#hex" }
  ],
  "hazards": [
    { "type": "lava|ice|electric|poison|void", "x": 15, "z": -10, "radius": 3, "color": "#hex", "damagePerSecond": 5, "statusEffect": "burn|slow|stun|none" }
  ],
  "platforms": [
    { "x": -30, "z": -30, "width": 8, "depth": 8, "height": 1.5, "color": "#hex" }
  ],
  "environmentalEffects": {
    "particles": "none|rain|embers|snow|spores|debris",
    "particleColor": "#hex",
    "groundPulse": false,
    "groundPulseColor": "#hex"
  },
  "narrativeIntro": "Welcome to..."
}`,
    userMessages: [
      'Design a unique combat arena for wave 1. The player is a "Shadow Ninja". Create an interesting, asymmetric layout with 10-14 cover blocks, 1-3 hazards, and 1-2 platforms.',
      'Design a unique combat arena for wave 5. The player is a "Lava Golem". Create a dramatic arena with 12 cover blocks, 2 hazards, 2 platforms.',
      'Design a unique combat arena for wave 3. Create an interesting layout with 10 cover blocks, 1 hazard, 1 platform. Make it atmospheric.',
    ],
    temperature: 0.9,
    maxTokens: 8192,
    validate(obj) {
      const errors = [];
      // Theme
      if (!obj.theme) { errors.push('missing theme'); return errors; }
      if (!isStr(obj.theme.name)) errors.push('missing theme.name');
      if (!isHex(obj.theme.backgroundColor)) errors.push(`bad theme.backgroundColor: ${obj.theme.backgroundColor}`);
      if (!isHex(obj.theme.fogColor)) errors.push('bad theme.fogColor');
      if (!isNum(obj.theme.fogDensity, 0.001, 0.1)) errors.push(`bad fogDensity: ${obj.theme.fogDensity}`);
      if (!isHex(obj.theme.floorColor)) errors.push('bad theme.floorColor');
      if (!isHex(obj.theme.wallColor)) errors.push('bad theme.wallColor');
      if (!isHex(obj.theme.ambientLightColor)) errors.push('bad theme.ambientLightColor');
      if (!isNum(obj.theme.ambientIntensity, 0, 2)) errors.push('bad theme.ambientIntensity');
      // Cover blocks
      if (!isArr(obj.coverBlocks, 1)) errors.push(`coverBlocks missing or empty (got ${obj.coverBlocks?.length || 0})`);
      else {
        let badCovers = 0;
        for (const b of obj.coverBlocks) {
          if (typeof b.x !== 'number' || typeof b.z !== 'number') badCovers++;
          else if (Math.abs(b.x) > 45 || Math.abs(b.z) > 45) badCovers++;
          if (!b.width || !b.height || !b.depth) badCovers++;
          // Check spawn zone clear
          if (Math.abs(b.x) < 8 && Math.abs(b.z) < 8) errors.push(`cover in spawn zone: (${b.x},${b.z})`);
        }
        if (badCovers > 0) errors.push(`${badCovers} invalid cover blocks`);
        if (obj.coverBlocks.length < 6) errors.push(`too few covers: ${obj.coverBlocks.length}`);
      }
      // Hazards
      if (obj.hazards && Array.isArray(obj.hazards)) {
        for (const h of obj.hazards) {
          const validTypes = ['lava', 'ice', 'electric', 'poison', 'void'];
          if (!isOneOf(h.type, validTypes)) errors.push(`bad hazard type: ${h.type}`);
          if (!isHex(h.color)) errors.push('bad hazard color');
        }
      }
      // Platforms
      if (obj.platforms && Array.isArray(obj.platforms)) {
        for (const p of obj.platforms) {
          if (typeof p.x !== 'number' || typeof p.z !== 'number') errors.push('bad platform coords');
        }
      }
      // Environmental effects
      if (obj.environmentalEffects) {
        const validParticles = ['none', 'rain', 'embers', 'snow', 'spores', 'debris'];
        if (!isOneOf(obj.environmentalEffects.particles, validParticles))
          errors.push(`bad particles: ${obj.environmentalEffects.particles}`);
      }
      if (!isStr(obj.narrativeIntro)) errors.push('missing narrativeIntro');
      return errors;
    },
  },

  avatar: {
    name: 'Avatar Agent',
    systemPrompt: `You are a voxel character designer for a combat arena game.
Given a player's description, generate a visual config. Characters are colored boxes (voxel aesthetic).
All hex colors must be valid 6-digit hex codes prefixed with #.

Respond with ONLY valid JSON:
{
  "name": "Display Name",
  "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "visor": "#hex", "glow": "#hex" },
  "proportions": { "headScale": 1.0, "bodyWidth": 1.0, "armLength": 1.0, "legLength": 1.0, "bulk": 1.0 },
  "accessories": [ { "type": "horns|shoulder_pads|spikes|crown|wings", "scale": 1.0, "color": "#hex" } ],
  "effects": { "trailColor": "#hex", "auraParticles": false, "auraColor": "#hex", "glowIntensity": 1.0, "idleAnimation": "bob|hover|sway|pulse|none" },
  "personality": "One-line flavor text"
}`,
    userMessages: [
      'Design a voxel arena fighter based on this description: "A shadow ninja who moves like smoke"',
      'Design a voxel arena fighter based on this description: "A massive lava golem made of molten rock"',
      'Design a voxel arena fighter based on this description: "A cyberpunk hacker with neon implants"',
      'Design a voxel arena fighter based on this description: "An ice queen with a frozen crown"',
      'Design a voxel arena fighter based on this description: "A holy paladin wreathed in golden light"',
    ],
    temperature: 0.9,
    maxTokens: 4096,
    validate(obj) {
      const errors = [];
      if (!isStr(obj.name)) errors.push('missing name');
      // Colors
      if (!obj.colors) { errors.push('missing colors'); return errors; }
      for (const k of ['primary', 'secondary', 'accent', 'visor', 'glow']) {
        if (!isHex(obj.colors[k])) errors.push(`bad colors.${k}: ${obj.colors[k]}`);
      }
      // Proportions
      if (!obj.proportions) { errors.push('missing proportions'); return errors; }
      for (const k of ['headScale', 'bodyWidth', 'armLength', 'legLength', 'bulk']) {
        if (!isNum(obj.proportions[k], 0.3, 3.0)) errors.push(`bad proportions.${k}: ${obj.proportions[k]}`);
      }
      // Accessories
      if (!Array.isArray(obj.accessories)) errors.push('accessories not array');
      else {
        const validAcc = ['horns', 'shoulder_pads', 'spikes', 'crown', 'wings'];
        for (const a of obj.accessories) {
          if (!isOneOf(a.type, validAcc)) errors.push(`bad accessory type: ${a.type}`);
          if (!isHex(a.color)) errors.push(`bad accessory color: ${a.color}`);
        }
      }
      // Effects
      if (!obj.effects) { errors.push('missing effects'); return errors; }
      if (!isHex(obj.effects.trailColor)) errors.push('bad trailColor');
      if (!isBool(obj.effects.auraParticles)) errors.push('auraParticles not boolean');
      if (!isHex(obj.effects.auraColor)) errors.push('bad auraColor');
      const validAnims = ['bob', 'hover', 'sway', 'pulse', 'none'];
      if (!isOneOf(obj.effects.idleAnimation, validAnims)) errors.push(`bad idleAnimation: ${obj.effects.idleAnimation}`);
      if (!isStr(obj.personality)) errors.push('missing personality');
      return errors;
    },
  },

  damageMutation: {
    name: 'Damage Mutation Agent',
    systemPrompt: `You are a visual effects designer for a voxel arena game.
Given a character concept and health threshold, describe how the avatar should visually degrade.
75% = cosmetic, 50% = structural, 25% = critical, 10% = full transformation.
All colors must be valid hex codes.

Respond with ONLY valid JSON:
{
  "colorShifts": [ { "part": "body|head|arms|legs|visor", "newColor": "#hex" } ],
  "removeParts": [],
  "addEffects": [ { "type": "sparks|smoke|fire|glitch|drip|crack_glow", "color": "#hex", "intensity": 1.5 } ],
  "scaleChanges": [ { "part": "head|body|arms|legs", "scale": 1.0 } ],
  "description": "Short visual description"
}`,
    userMessages: [
      'Character: "Lava Golem"\nHealth: 75%\nDescribe the visual damage mutation.',
      'Character: "Cyber Ninja"\nHealth: 50%\nDescribe the visual damage mutation.',
      'Character: "Ice Mage"\nHealth: 25%\nDescribe the visual damage mutation.',
      'Character: "Shadow Assassin"\nHealth: 10%\nDescribe the visual damage mutation.',
    ],
    temperature: 0.85,
    maxTokens: 4096,
    validate(obj) {
      const errors = [];
      if (!isArr(obj.colorShifts)) errors.push('colorShifts not array');
      else {
        const validParts = ['body', 'head', 'arms', 'legs', 'visor'];
        for (const c of obj.colorShifts) {
          if (!isOneOf(c.part, validParts)) errors.push(`bad colorShift part: ${c.part}`);
          if (!isHex(c.newColor)) errors.push(`bad colorShift color: ${c.newColor}`);
        }
      }
      if (!Array.isArray(obj.removeParts)) errors.push('removeParts not array');
      if (!isArr(obj.addEffects)) errors.push('addEffects not array');
      else {
        const validFx = ['sparks', 'smoke', 'fire', 'glitch', 'drip', 'crack_glow'];
        for (const e of obj.addEffects) {
          if (!isOneOf(e.type, validFx)) errors.push(`bad effect type: ${e.type}`);
          if (!isHex(e.color)) errors.push(`bad effect color: ${e.color}`);
          if (!isNum(e.intensity, 0, 10)) errors.push(`bad effect intensity: ${e.intensity}`);
        }
      }
      if (!Array.isArray(obj.scaleChanges)) errors.push('scaleChanges not array');
      if (!isStr(obj.description)) errors.push('missing description');
      return errors;
    },
  },

  enemyDesign: {
    name: 'Enemy Design Agent',
    systemPrompt: `You are an enemy designer for a voxel arena combat game.
Generate unique enemy identities with personality AND visual design.
All colors must be valid hex codes.
name: 1 word, 4-8 letters. epithet: short title. taunt + lastWords: 1 sentence each.

Respond with ONLY valid JSON:
{
  "enemies": [
    {
      "name": "Kira",
      "epithet": "the Bold",
      "personality": "reckless",
      "taunt": "You'll fall like the rest!",
      "lastWords": "I didn't expect... the cold...",
      "grudge": null,
      "resistance": null,
      "visual": {
        "primaryColor": "#ff3344",
        "accentColor": "#ffa07a",
        "visorColor": "#1a0f10",
        "glowColor": "#ff0000",
        "scale": 1.0,
        "extraGeometry": "none|spikes|horns|shield|tail"
      },
      "entranceLine": null,
      "deathEffect": "explosion|dissolve|electric_burst|freeze_shatter|standard"
    }
  ]
}`,
    userMessages: [
      'Wave 1, generate 3 enemy identities with visuals.',
      'Wave 3, generate 4 enemy identities with visuals. Make 1 enemy a CHAMPION with scale 1.4+, dramatic entrance line, and unique geometry.',
      'Wave 5, generate 5 enemy identities with visuals. Make the champion extra dramatic — scale 1.6+.',
      'Wave 7, generate 4 enemy identities with visuals. Match context: Player has been using frost weapons heavily. Make 1 CHAMPION.',
    ],
    temperature: 1.0,
    maxTokens: 8192,
    validate(obj) {
      const errors = [];
      if (!obj.enemies || !isArr(obj.enemies, 1)) { errors.push('missing/empty enemies array'); return errors; }
      for (let i = 0; i < obj.enemies.length; i++) {
        const e = obj.enemies[i];
        const pfx = `enemy[${i}]`;
        if (!isStr(e.name)) errors.push(`${pfx}: missing name`);
        else if (e.name.split(/\s+/).length > 2) errors.push(`${pfx}: name too long: "${e.name}"`);
        if (!isStr(e.epithet)) errors.push(`${pfx}: missing epithet`);
        if (!isStr(e.personality)) errors.push(`${pfx}: missing personality`);
        if (!isStr(e.taunt)) errors.push(`${pfx}: missing taunt`);
        if (!isStr(e.lastWords)) errors.push(`${pfx}: missing lastWords`);
        // Visual
        if (!e.visual) { errors.push(`${pfx}: missing visual`); continue; }
        if (!isHex(e.visual.primaryColor)) errors.push(`${pfx}: bad primaryColor`);
        if (!isHex(e.visual.accentColor)) errors.push(`${pfx}: bad accentColor`);
        if (!isHex(e.visual.visorColor)) errors.push(`${pfx}: bad visorColor`);
        if (!isHex(e.visual.glowColor)) errors.push(`${pfx}: bad glowColor`);
        if (!isNum(e.visual.scale, 0.5, 3.0)) errors.push(`${pfx}: bad scale: ${e.visual.scale}`);
        const validGeo = ['none', 'spikes', 'horns', 'shield', 'tail'];
        if (!isOneOf(e.visual.extraGeometry, validGeo)) errors.push(`${pfx}: bad extraGeometry: ${e.visual.extraGeometry}`);
        const validDeath = ['explosion', 'dissolve', 'electric_burst', 'freeze_shatter', 'standard'];
        if (!isOneOf(e.deathEffect, validDeath)) errors.push(`${pfx}: bad deathEffect: ${e.deathEffect}`);
      }
      return errors;
    },
  },

  narrator: {
    name: 'Narrator Agent',
    systemPrompt: `You are an epic battle narrator for a voxel arena combat game.
Generate SHORT, punchy narration lines (under 15 words).
Style: mythic, poetic, dramatic. Like a movie trailer narrator crossed with Dark Souls messages.
Never use character names — refer to "the fighter", "they", "the arena", "the fallen".

Respond with ONLY valid JSON:
{
  "line": "The narration line here",
  "mood": "epic|ominous|triumphant|desperate|quiet"
}`,
    userMessages: [
      'Event: multi_kill. Context: 3 enemies killed in rapid succession.',
      'Event: multi_kill. Context: 5 enemies obliterated in a chain.',
      'Event: near_death. Context: player at critical health, barely alive.',
      'Event: wave_clear. Context: wave 5 completed, a milestone reached.',
      'Event: first_forge. Context: player forged their first weapon from pure thought.',
      'Event: player_death. Context: the fighter has fallen in the arena.',
      'Event: game_start. Context: the arena awakens for a new challenger.',
      'Event: new_weapon. Context: a devastating frost cannon materializes.',
    ],
    temperature: 1.0,
    maxTokens: 2048,
    validate(obj) {
      const errors = [];
      if (!isStr(obj.line)) errors.push('missing line');
      else {
        const wordCount = obj.line.split(/\s+/).length;
        if (wordCount > 25) errors.push(`line too long: ${wordCount} words`);
        if (wordCount < 3) errors.push(`line too short: ${wordCount} words`);
      }
      const validMoods = ['epic', 'ominous', 'triumphant', 'desperate', 'quiet'];
      if (!isOneOf(obj.mood, validMoods)) errors.push(`bad mood: ${obj.mood}`);
      return errors;
    },
  },

  weaponVisuals: {
    name: 'Weapon Visuals Agent',
    systemPrompt: `You are a VFX artist for a voxel combat game.
Given a weapon name/description, design its visual effects. Colors must be valid hex codes.

Respond with ONLY valid JSON:
{
  "projectile": { "shape": "sphere|cube|elongated|ring|cluster", "color": "#hex", "emissiveColor": "#hex", "size": 0.3, "glowIntensity": 2.0 },
  "trail": { "color": "#hex", "width": 0.15, "length": 8, "opacity": 0.8 },
  "muzzleFlash": { "color": "#hex", "size": 1.5, "duration": 0.1 },
  "impact": { "particleColor": "#hex", "particleCount": 15, "particleSpeed": 8, "particleSize": 3 },
  "ambient": { "screenTint": "#hex", "description": "Short visual description" }
}`,
    userMessages: [
      'Design visual effects for this weapon: "Frost Cannon"',
      'Design visual effects for this weapon: "Plasma Shotgun"',
      'Design visual effects for this weapon: "Lightning Whip"',
      'Design visual effects for this weapon: "Black Hole Generator"',
      'Design visual effects for this weapon: "Holy Smite Hammer"',
    ],
    temperature: 0.8,
    maxTokens: 4096,
    validate(obj) {
      const errors = [];
      // Projectile
      if (!obj.projectile) { errors.push('missing projectile'); return errors; }
      const validShapes = ['sphere', 'cube', 'elongated', 'ring', 'cluster'];
      if (!isOneOf(obj.projectile.shape, validShapes)) errors.push(`bad shape: ${obj.projectile.shape}`);
      if (!isHex(obj.projectile.color)) errors.push(`bad projectile.color: ${obj.projectile.color}`);
      if (!isHex(obj.projectile.emissiveColor)) errors.push('bad projectile.emissiveColor');
      if (!isNum(obj.projectile.size, 0.05, 2)) errors.push(`bad projectile.size: ${obj.projectile.size}`);
      if (!isNum(obj.projectile.glowIntensity, 0, 10)) errors.push('bad glowIntensity');
      // Trail
      if (!obj.trail) errors.push('missing trail');
      else {
        if (!isHex(obj.trail.color)) errors.push('bad trail.color');
        if (!isNum(obj.trail.width, 0.01, 1)) errors.push(`bad trail.width: ${obj.trail.width}`);
        if (!isNum(obj.trail.length, 1, 50)) errors.push(`bad trail.length: ${obj.trail.length}`);
        if (!isNum(obj.trail.opacity, 0, 1)) errors.push(`bad trail.opacity: ${obj.trail.opacity}`);
      }
      // Muzzle flash
      if (!obj.muzzleFlash) errors.push('missing muzzleFlash');
      else {
        if (!isHex(obj.muzzleFlash.color)) errors.push('bad muzzleFlash.color');
        if (!isNum(obj.muzzleFlash.size, 0.1, 10)) errors.push('bad muzzleFlash.size');
        if (!isNum(obj.muzzleFlash.duration, 0.01, 1)) errors.push('bad muzzleFlash.duration');
      }
      // Impact
      if (!obj.impact) errors.push('missing impact');
      else {
        if (!isHex(obj.impact.particleColor)) errors.push('bad impact.particleColor');
        if (!isNum(obj.impact.particleCount, 1, 100)) errors.push('bad particleCount');
        if (!isNum(obj.impact.particleSpeed, 0.5, 50)) errors.push('bad particleSpeed');
        if (!isNum(obj.impact.particleSize, 0.1, 20)) errors.push('bad particleSize');
      }
      // Ambient
      if (!obj.ambient) errors.push('missing ambient');
      else {
        if (!isStr(obj.ambient.description)) errors.push('missing ambient.description');
      }
      return errors;
    },
  },
};

// ── Test runner ──
async function runTests() {
  const agentsToTest = FILTER_AGENT
    ? { [FILTER_AGENT]: AGENTS[FILTER_AGENT] }
    : AGENTS;

  if (FILTER_AGENT && !AGENTS[FILTER_AGENT]) {
    console.error(`Unknown agent: ${FILTER_AGENT}`);
    console.log('Available agents:', Object.keys(AGENTS).join(', '));
    process.exit(1);
  }

  const allResults = {};
  const startTime = Date.now();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  AGENT TEST SUITE — ${RUNS_PER_AGENT} runs per agent`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Agents: ${Object.keys(agentsToTest).join(', ')}`);
  console.log(`  Total calls: ~${RUNS_PER_AGENT * Object.keys(agentsToTest).length}`);
  console.log(`${'='.repeat(70)}\n`);

  for (const [key, agent] of Object.entries(agentsToTest)) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Testing: ${agent.name} (${RUNS_PER_AGENT} runs)`);
    console.log(`${'─'.repeat(50)}`);

    const results = {
      total: RUNS_PER_AGENT,
      success: 0,
      parseFailures: 0,
      apiErrors: 0,
      validationErrors: 0,
      errorDetails: [],
      validationBreakdown: {},
      sampleOutputs: [],
      timings: [],
    };

    for (let i = 0; i < RUNS_PER_AGENT; i++) {
      const userMsg = agent.userMessages[i % agent.userMessages.length];
      const runStart = Date.now();

      process.stdout.write(`  Run ${i + 1}/${RUNS_PER_AGENT}... `);

      const result = await callGemini(
        agent.systemPrompt,
        userMsg,
        agent.temperature,
        agent.maxTokens,
      );

      const elapsed = Date.now() - runStart;
      results.timings.push(elapsed);

      if (result.error) {
        if (result.error.startsWith('HTTP')) {
          results.apiErrors++;
          console.log(`API ERROR: ${result.error.slice(0, 80)}`);
        } else {
          results.parseFailures++;
          console.log(`PARSE FAIL: ${result.raw?.slice(0, 100) || result.error}`);
        }
        results.errorDetails.push({ run: i + 1, type: result.error.startsWith('HTTP') ? 'api' : 'parse', msg: result.error.slice(0, 200), prompt: userMsg.slice(0, 60) });
        continue;
      }

      // Validate
      const validationErrors = agent.validate(result.parsed);
      if (validationErrors.length > 0) {
        results.validationErrors++;
        console.log(`VALIDATION FAIL: ${validationErrors.join(', ')}`);
        results.errorDetails.push({ run: i + 1, type: 'validation', errors: validationErrors, prompt: userMsg.slice(0, 60) });
        for (const ve of validationErrors) {
          results.validationBreakdown[ve] = (results.validationBreakdown[ve] || 0) + 1;
        }
      } else {
        results.success++;
        console.log(`OK (${elapsed}ms)`);
      }

      // Save sample outputs (first 3 successes)
      if (results.sampleOutputs.length < 3 && validationErrors.length === 0) {
        results.sampleOutputs.push(result.parsed);
      }
    }

    allResults[key] = results;
  }

  // ── Report ──
  const totalElapsed = Date.now() - startTime;
  console.log(`\n\n${'='.repeat(70)}`);
  console.log(`  FINAL REPORT`);
  console.log(`${'='.repeat(70)}\n`);

  const reportLines = [];
  reportLines.push(`# Agent Test Report — ${new Date().toISOString()}`);
  reportLines.push(`Model: ${MODEL} | Runs per agent: ${RUNS_PER_AGENT} | Total time: ${Math.round(totalElapsed / 1000)}s\n`);

  for (const [key, results] of Object.entries(allResults)) {
    const agent = AGENTS[key] || agentsToTest[key];
    const successRate = ((results.success / results.total) * 100).toFixed(1);
    const avgTime = Math.round(results.timings.reduce((a, b) => a + b, 0) / results.timings.length);

    const line = `${agent.name}: ${successRate}% success (${results.success}/${results.total}) | API errors: ${results.apiErrors} | Parse failures: ${results.parseFailures} | Validation failures: ${results.validationErrors} | Avg: ${avgTime}ms`;
    console.log(line);
    reportLines.push(`## ${agent.name}`);
    reportLines.push(`- **Success rate:** ${successRate}% (${results.success}/${results.total})`);
    reportLines.push(`- **API errors:** ${results.apiErrors}`);
    reportLines.push(`- **Parse failures:** ${results.parseFailures}`);
    reportLines.push(`- **Validation failures:** ${results.validationErrors}`);
    reportLines.push(`- **Avg response time:** ${avgTime}ms`);

    if (Object.keys(results.validationBreakdown).length > 0) {
      reportLines.push(`- **Validation breakdown:**`);
      const sorted = Object.entries(results.validationBreakdown).sort((a, b) => b[1] - a[1]);
      for (const [err, count] of sorted) {
        reportLines.push(`  - ${err}: ${count}x`);
        console.log(`    └─ ${err}: ${count}x`);
      }
    }

    if (results.errorDetails.length > 0) {
      reportLines.push(`- **Error samples:**`);
      for (const ed of results.errorDetails.slice(0, 5)) {
        reportLines.push(`  - Run ${ed.run} (${ed.type}): ${ed.errors?.join(', ') || ed.msg}`);
      }
    }

    if (results.sampleOutputs.length > 0) {
      reportLines.push(`- **Sample output:**`);
      reportLines.push('```json');
      reportLines.push(JSON.stringify(results.sampleOutputs[0], null, 2).slice(0, 800));
      reportLines.push('```');
    }

    reportLines.push('');
  }

  // Summary
  console.log(`\nTotal time: ${Math.round(totalElapsed / 1000)}s`);

  // Write report
  const reportPath = `tests/agent-test-report-${Date.now()}.md`;
  fs.writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`\nReport saved to: ${reportPath}`);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
