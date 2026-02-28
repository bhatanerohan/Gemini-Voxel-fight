// src/llama/arenaGenAgent.js — Generative Arena Environment Agent
import { defineAgent, runAgent } from './llamaService.js';

const arenaGenAgent = defineAgent({
  name: 'ArenaGenAgent',
  systemPrompt: `You are an arena architect for a voxel combat game.
Design unique, atmospheric combat arenas. Each arena has a theme that determines colors, hazards, and mood.

Arena bounds: X and Z from -45 to 45. Player spawns at center (0,0,0).
Keep a clear area (radius ~8) around center for the player spawn.

Cover blocks provide tactical depth — mix sizes and placements.
Hazards add danger zones players must avoid.
Environmental effects set the mood.

All hex colors must be valid 6-digit codes prefixed with #.
Coordinates must be within arena bounds.

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
  temperature: 0.9,
  maxTokens: 2500,
});

const DEFAULT_ARENA = {
  theme: {
    name: 'Default Arena',
    backgroundColor: '#060612',
    fogColor: '#060612',
    fogDensity: 0.011,
    floorColor: '#0e0e1a',
    wallColor: '#0088ff',
    ambientLightColor: '#223344',
    ambientIntensity: 0.6,
  },
  coverBlocks: [
    { x: 12, z: 12, width: 2, height: 2.5, depth: 2, color: '#252540' },
    { x: -12, z: 12, width: 2, height: 2.5, depth: 2, color: '#252540' },
    { x: 12, z: -12, width: 2, height: 2.5, depth: 2, color: '#252540' },
    { x: -12, z: -12, width: 2, height: 2.5, depth: 2, color: '#252540' },
    { x: 0, z: 22, width: 6, height: 1.8, depth: 1.2, color: '#252540' },
    { x: 0, z: -22, width: 6, height: 1.8, depth: 1.2, color: '#252540' },
    { x: 22, z: 0, width: 1.2, height: 1.8, depth: 6, color: '#252540' },
    { x: -22, z: 0, width: 1.2, height: 1.8, depth: 6, color: '#252540' },
    { x: 30, z: 18, width: 3, height: 1.5, depth: 3, color: '#252540' },
    { x: -30, z: 18, width: 3, height: 1.5, depth: 3, color: '#252540' },
    { x: 30, z: -18, width: 3, height: 1.5, depth: 3, color: '#252540' },
    { x: -30, z: -18, width: 3, height: 1.5, depth: 3, color: '#252540' },
  ],
  hazards: [],
  platforms: [
    { x: -35, z: -35, width: 8, depth: 8, height: 1.5, color: '#2a2a50' },
    { x: 35, z: 35, width: 8, depth: 8, height: 1.5, color: '#2a2a50' },
  ],
  environmentalEffects: {
    particles: 'none',
    particleColor: '#ffffff',
    groundPulse: false,
    groundPulseColor: '#000000',
  },
  narrativeIntro: 'Welcome to the Arena.',
};

export async function generateArenaConfig(wave = 1, playerAvatarConcept = '') {
  const result = await runAgent(
    arenaGenAgent,
    `Design a unique combat arena for wave ${wave}.
${playerAvatarConcept ? `The player is a "${playerAvatarConcept}". Theme should contrast or complement their style.` : ''}
Create an interesting, asymmetric layout with 10-14 cover blocks, 1-3 hazards, and 1-2 platforms.
Make it atmospheric and memorable. Give it a creative name.`
  );

  if (!result || !result.theme) return { ...DEFAULT_ARENA };

  // Validate cover blocks
  const coverBlocks = Array.isArray(result.coverBlocks)
    ? result.coverBlocks.filter(b => b.x != null && b.z != null && b.width && b.height && b.depth).slice(0, 18)
    : DEFAULT_ARENA.coverBlocks;

  if (coverBlocks.length < 6) return { ...DEFAULT_ARENA, theme: result.theme };

  return {
    theme: { ...DEFAULT_ARENA.theme, ...result.theme },
    coverBlocks,
    hazards: Array.isArray(result.hazards) ? result.hazards.slice(0, 4) : [],
    platforms: Array.isArray(result.platforms) ? result.platforms.slice(0, 3) : DEFAULT_ARENA.platforms,
    environmentalEffects: { ...DEFAULT_ARENA.environmentalEffects, ...(result.environmentalEffects || {}) },
    narrativeIntro: result.narrativeIntro || 'Welcome to the Arena.',
  };
}

export function getDefaultArenaConfig() {
  return { ...DEFAULT_ARENA };
}
