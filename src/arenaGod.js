// src/arenaGod.js — Arena God AI brain (GLaDOS-like sardonic arena personality)
import { MatchMemory } from './matchMemory.js';
import { geminiJSON } from './geminiService.js';
import { showGodDialogue, flashGodQuip, hideGodDialogue } from './arenaGodUI.js';
import { GameState } from './gameState.js';
import { buildSessionContext } from './sessionMemory.js';

let godCallInProgress = false;
let lastCallTime = 0;
const MID_COMBAT_COOLDOWN = 5000; // ms

const SYSTEM_PROMPT = `You are the Arena God — a sardonic, omniscient, sentient arena AI personality (think GLaDOS meets a Roman emperor). You control a voxel combat arena and watch a lone player fight waves of enemies.

VOICE RULES:
- Speak in 1-2 short, punchy sentences. Never more.
- Address the player as "you". Never use their name.
- You remember EVERYTHING that happened this match. Reference specific weapons, kills, close calls.
- Be sardonic, darkly witty, occasionally impressed (but never admit it easily).
- Vary your tone: amused, angry, impressed, bored, contemptuous, neutral.

MUTATION RULES:
- Only suggest a mutation every 2-3 waves, NOT every wave.
- NEVER mutate on wave 1 or 2.
- Mutations should be reactive to player behavior:
  - Player hiding behind cover a lot → remove_cover
  - Player too comfortable / taking no damage → add_hazard
  - Arena feels stale → shrink_arena or theme_shift
  - Player dominating → spawn_champion
- enemy_modifier only if the player has been exploiting one weapon type repeatedly (3+ waves same weapon).

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
For game_over, give a memorable final line. No mutation.`;

function buildUserMessage(triggerType) {
  const sessionCtx = buildSessionContext();
  const matchCtx = MatchMemory.buildGeminiContext();
  return `TRIGGER: ${triggerType}\nPLAYER HISTORY:\n${sessionCtx}\n\nCURRENT MATCH:\n${matchCtx}`;
}

const QUIP_TRIGGERS = new Set(['near_death', 'multi_kill', 'first_forge']);

async function consultArenaGod(triggerType) {
  // Guard: no duplicate concurrent calls
  if (godCallInProgress) return;

  // Cooldown for mid-combat triggers
  const now = Date.now();
  if (QUIP_TRIGGERS.has(triggerType) && now - lastCallTime < MID_COMBAT_COOLDOWN) return;

  godCallInProgress = true;
  lastCallTime = now;

  try {
    const result = await geminiJSON({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: buildUserMessage(triggerType),
      temperature: 0.9,
      maxTokens: 500,
    });

    if (!result || !result.dialogue) return;

    const tone = result.tone || 'neutral';

    // Display dialogue
    if (QUIP_TRIGGERS.has(triggerType)) {
      flashGodQuip(result.dialogue, tone, 2500);
    } else if (triggerType === 'game_over') {
      showGodDialogue(result.dialogue, tone, 8000);
    } else {
      showGodDialogue(result.dialogue, tone, 5000);
    }

    // Emit mutation/modifier for other systems to handle
    if (result.mutation && !QUIP_TRIGGERS.has(triggerType) && triggerType !== 'game_over') {
      GameState.emit('god_mutation', result.mutation);
    }
    if (result.enemy_modifier && !QUIP_TRIGGERS.has(triggerType) && triggerType !== 'game_over') {
      GameState.emit('god_enemy_modifier', result.enemy_modifier);
    }
  } catch (err) {
    // Silence — never crash the game
    console.warn('[arenaGod] consultArenaGod error:', err.message);
  } finally {
    godCallInProgress = false;
  }
}

export function initArenaGod() {
  GameState.on('wave_clear', () => consultArenaGod('wave_end'));
  GameState.on('game_over', () => consultArenaGod('game_over'));
  GameState.on('restart', () => hideGodDialogue());
  GameState.on('player_near_death', () => consultArenaGod('near_death'));
  GameState.on('multi_kill', () => consultArenaGod('multi_kill'));
  GameState.on('first_forge', () => consultArenaGod('first_forge'));
}
