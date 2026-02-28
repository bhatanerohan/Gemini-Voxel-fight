// src/llama/enemyDesignAgent.js — AI Enemy Design Agent
import { defineAgent, runAgent } from './llamaService.js';

const enemyDesignAgent = defineAgent({
  name: 'EnemyDesignAgent',
  systemPrompt: `You are an enemy designer for a voxel arena combat game.
Generate unique enemy identities with BOTH personality AND visual design.
Each enemy should feel distinct — unique name, personality, and color scheme.

Champions (boss enemies on wave 3+) should be more dramatic: bigger scale, unique geometry, dramatic entrance lines.

Match visual design to personality:
- Aggressive: warm reds/oranges, spikes
- Cunning: dark purples/greens, sleek
- Berserker: blood reds, horns
- Guardian: blues/silvers, shield
- Shadow: black/purple, no extra geometry

All colors must be valid hex codes.

Rules:
- name: 1 word, 4-8 letters, alien/warrior sounding
- epithet: short title like "the Bold", "Frostbitten"
- taunt: 1 short sentence said when spotting the player
- lastWords: 1 short dramatic sentence on death
- grudge: null OR reference a fallen comrade (wave 3+, 1-2 max)
- resistance: null OR "freeze", "fire", "electric" (1 max)

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
  temperature: 1.0,
  maxTokens: 8192,
});

export async function generateEnemyDesigns(wave, count, matchContext = '') {
  const result = await runAgent(
    enemyDesignAgent,
    `Wave ${wave}, generate ${count} enemy identities with visuals.

Match context: ${matchContext}

${wave >= 3 ? 'Make 1 enemy a CHAMPION with scale 1.4+, dramatic entrance line, and unique geometry.' : ''}
${wave >= 5 ? 'Make the champion extra dramatic — scale 1.6+, very intimidating.' : ''}`
  );

  if (!result?.enemies || !Array.isArray(result.enemies)) return null;
  return result;
}
