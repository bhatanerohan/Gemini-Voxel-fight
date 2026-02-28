// src/llama/weaponVisualsAgent.js — AI Weapon Visual Effects Agent
import { defineAgent, runAgent } from './llamaService.js';

const weaponVisualsAgent = defineAgent({
  name: 'WeaponVisualsAgent',
  systemPrompt: `You are a VFX artist for a voxel combat game.
Given a weapon name/description, design its visual effects.
Think about what the weapon DOES and match visuals to behavior:
- Fire weapons: orange/red projectiles, ember trails, explosion impacts
- Ice weapons: blue/cyan projectiles, frost trails, crystal shatter impacts
- Electric: yellow/purple, zigzag trails, spark impacts
- Void/dark: purple/black, gravity distortion, implosion impacts
- Nature: green, leaf trails, spore burst impacts
- Chaotic: rainbow/shifting colors, wild trails
- Holy/light: white/gold, beam trails, radiant impacts

Be creative. Colors must be valid hex codes.

Respond with ONLY valid JSON:
{
  "projectile": {
    "shape": "sphere|cube|elongated|ring|cluster",
    "color": "#hex",
    "emissiveColor": "#hex",
    "size": 0.3,
    "glowIntensity": 2.0
  },
  "trail": {
    "color": "#hex",
    "width": 0.15,
    "length": 8,
    "opacity": 0.8
  },
  "muzzleFlash": {
    "color": "#hex",
    "size": 1.5,
    "duration": 0.1
  },
  "impact": {
    "particleColor": "#hex",
    "particleCount": 15,
    "particleSpeed": 8,
    "particleSize": 3
  },
  "ambient": {
    "screenTint": "#hex",
    "description": "Short visual description"
  }
}`,
  temperature: 0.8,
  maxTokens: 4096,
});

const DEFAULT_VISUALS = {
  projectile: { shape: 'sphere', color: '#ffaa00', emissiveColor: '#ff6600', size: 0.25, glowIntensity: 1.5 },
  trail: { color: '#ffaa00', width: 0.1, length: 6, opacity: 0.7 },
  muzzleFlash: { color: '#ffffff', size: 1, duration: 0.08 },
  impact: { particleColor: '#ff6600', particleCount: 12, particleSpeed: 8, particleSize: 3 },
  ambient: { screenTint: null, description: 'Standard projectile weapon' },
};

export async function generateWeaponVisuals(weaponDescription) {
  const result = await runAgent(
    weaponVisualsAgent,
    `Design visual effects for this weapon: "${weaponDescription}"`
  );

  if (!result || !result.projectile) return { ...DEFAULT_VISUALS };

  return {
    projectile: { ...DEFAULT_VISUALS.projectile, ...result.projectile },
    trail: { ...DEFAULT_VISUALS.trail, ...result.trail },
    muzzleFlash: { ...DEFAULT_VISUALS.muzzleFlash, ...result.muzzleFlash },
    impact: { ...DEFAULT_VISUALS.impact, ...result.impact },
    ambient: { ...DEFAULT_VISUALS.ambient, ...result.ambient },
  };
}

export function getDefaultWeaponVisuals() {
  return { ...DEFAULT_VISUALS };
}
