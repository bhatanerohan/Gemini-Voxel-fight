// src/llama/avatarAgent.js — AI Avatar Generation Agent
import { defineAgent, runAgent } from './llamaService.js';

const avatarAgent = defineAgent({
  name: 'AvatarAgent',
  systemPrompt: `You are a voxel character designer for a combat arena game.
Given a player's description of their fighter, generate a complete visual config.
Characters are built from colored boxes (voxel aesthetic — think Minecraft meets arena shooter).

Be creative with colors — avoid plain/boring palettes. Make them vivid and thematic.
Match the personality to the visual style.

All hex colors must be valid 6-digit hex codes prefixed with #.
Proportions are multipliers where 1.0 = normal human proportions.

Respond with ONLY valid JSON in this exact format:
{
  "name": "Display Name",
  "colors": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "visor": "#hex",
    "glow": "#hex"
  },
  "proportions": {
    "headScale": 1.0,
    "bodyWidth": 1.0,
    "armLength": 1.0,
    "legLength": 1.0,
    "bulk": 1.0
  },
  "accessories": [
    { "type": "horns|shoulder_pads|spikes|crown|wings", "scale": 1.0, "color": "#hex" }
  ],
  "effects": {
    "trailColor": "#hex",
    "auraParticles": false,
    "auraColor": "#hex",
    "glowIntensity": 1.0,
    "idleAnimation": "bob|hover|sway|pulse|none"
  },
  "personality": "One-line flavor text"
}`,
  temperature: 0.9,
  maxTokens: 4096,
});

const DEFAULT_CONFIG = {
  name: 'Arena Fighter',
  colors: { primary: '#4488ff', secondary: '#2244aa', accent: '#ffaa00', visor: '#00ffff', glow: '#4488ff' },
  proportions: { headScale: 1, bodyWidth: 1, armLength: 1, legLength: 1, bulk: 1 },
  accessories: [],
  effects: { trailColor: '#4488ff', auraParticles: false, auraColor: '#4488ff', glowIntensity: 1, idleAnimation: 'bob' },
  personality: 'Ready for battle.',
};

export async function generateAvatarConfig(playerDescription) {
  const result = await runAgent(
    avatarAgent,
    `Design a voxel arena fighter based on this description: "${playerDescription}"
Make the design vivid, creative, and unique. Max 2 accessories.`
  );
  if (!result || !result.colors) return { ...DEFAULT_CONFIG };
  // Validate and fill defaults
  return {
    name: result.name || 'Arena Fighter',
    colors: { ...DEFAULT_CONFIG.colors, ...result.colors },
    proportions: { ...DEFAULT_CONFIG.proportions, ...result.proportions },
    accessories: Array.isArray(result.accessories) ? result.accessories.slice(0, 3) : [],
    effects: { ...DEFAULT_CONFIG.effects, ...result.effects },
    personality: result.personality || 'Ready for battle.',
  };
}

export function getDefaultAvatarConfig() {
  return { ...DEFAULT_CONFIG };
}
