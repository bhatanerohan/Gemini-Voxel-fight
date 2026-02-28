// src/warChronicle.js — War Chronicle: dramatic AI-generated match retelling
import { MatchMemory } from './matchMemory.js';
import { geminiJSON } from './geminiService.js';
import { GameState } from './gameState.js';

let _typewriterInterval = null;

const SYSTEM_PROMPT = `You are a war chronicler. Write a 150-250 word dramatic retelling of a combat arena match. Reference actual enemy names and weapon names from the match data. Build tension. End with a memorable line about the player's fall.

Respond with JSON only:
{
  "title": "The Battle of Arena [number] — A Chronicle",
  "chronicle": "Full narrative text...",
  "keyMoment": "One-sentence highlight of the most dramatic moment"
}`;

export async function generateChronicle() {
  const context = MatchMemory.buildGeminiContext();

  const result = await geminiJSON({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Here is the match data:\n${context}`,
    temperature: 0.95,
    maxTokens: 4096,
  });

  if (result && result.title && result.chronicle) {
    return result;
  }

  return generateFallbackChronicle();
}

export function generateFallbackChronicle() {
  const waveCount = MatchMemory.waves.length;
  const totalKills = MatchMemory.enemyDeaths.length;
  const weaponCount = MatchMemory.forgedWeapons.length;

  return {
    title: `Arena Record — Wave ${waveCount}`,
    chronicle: `The challenger reached wave ${waveCount}, slaying ${totalKills} foes with ${weaponCount} forged weapon${weaponCount !== 1 ? 's' : ''}. Score: ${GameState.score}. The arena claims another.`,
    keyMoment: 'The details have been lost to time.',
  };
}

export function displayChronicle(chronicle) {
  const titleEl = document.getElementById('chronicle-title');
  const textEl = document.getElementById('chronicle-text');
  const momentEl = document.getElementById('chronicle-moment');
  const container = document.getElementById('chronicle-container');

  if (!titleEl || !textEl || !momentEl || !container) return;

  titleEl.textContent = chronicle.title || '';
  momentEl.textContent = chronicle.keyMoment || '';
  textEl.textContent = '';

  // Typewriter effect
  const fullText = chronicle.chronicle || '';
  let i = 0;
  if (_typewriterInterval) clearInterval(_typewriterInterval);
  _typewriterInterval = setInterval(() => {
    if (i < fullText.length) {
      textEl.textContent += fullText[i];
      i++;
    } else {
      clearInterval(_typewriterInterval);
      _typewriterInterval = null;
    }
  }, 20);

  container.classList.add('visible');
}

export function hideChronicle() {
  if (_typewriterInterval) {
    clearInterval(_typewriterInterval);
    _typewriterInterval = null;
  }
  const container = document.getElementById('chronicle-container');
  const titleEl = document.getElementById('chronicle-title');
  const textEl = document.getElementById('chronicle-text');
  const momentEl = document.getElementById('chronicle-moment');
  if (container) container.classList.remove('visible');
  if (titleEl) titleEl.textContent = '';
  if (textEl) textEl.textContent = '';
  if (momentEl) momentEl.textContent = '';
}
