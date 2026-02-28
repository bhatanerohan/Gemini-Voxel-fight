# CLAUDE.md — Project conventions for Gemini Voxel Fight

## Project Overview
3D voxel arena combat game using Three.js r128. AI-powered features via Google Gemini API (OpenAI-compatible endpoint).

## Architecture

### Gemini API Flow
```
Browser → geminiService.js → Vite proxy (/gemini/* → generativelanguage.googleapis.com/v1beta/openai/*) → Google Gemini API
```
- **Model**: `gemini-3-flash-preview` (validated by server.js allowlist: prefix `gemini-3`)
- **API Key**: stored in `.env` as `GEMINI_API_KEY`, injected by Vite proxy via `loadEnv`
- **Dev server**: `npm run dev` (Vite with proxy). Production: `npm start` (Express server.js)

### Critical Pattern: JSON Mode for All JSON Agents
All agents expecting JSON output MUST go through `geminiJSON()` in `geminiService.js`, which automatically sets `response_format: { type: 'json_object' }`. This forces the Gemini API to return valid JSON. **Never call `callGemini()` directly for JSON responses.**

- `geminiJSON()` → uses `jsonMode: true` → structured JSON output
- `geminiText()` → raw text output (used only for weapon code generation in forge.js)

### Agent System (Two Layers)
1. **Direct callers** (import `geminiJSON` from `geminiService.js`):
   - `arenaGod.js` — Arena God personality (GLaDOS-like)
   - `themeManager.js` — AI theme generation
   - `warChronicle.js` — Post-match narrative
   - `main.js` — Inline AI calls

2. **LlamaIndex-style agents** (import `runAgent` from `llama/llamaService.js`, which wraps `geminiJSON`):
   - `arenaGenAgent.js` — Arena layout generation
   - `avatarAgent.js` — Player avatar design
   - `damageMutationAgent.js` — Damage visual effects
   - `enemyDesignAgent.js` — Enemy identity + visuals
   - `narratorAgent.js` — Battle narration lines
   - `weaponVisualsAgent.js` — Weapon VFX design

### Default Token Limits
- Default `max_tokens`: 8192 (set in `geminiService.js` and `llamaService.js`)
- Gemini context window: 100K tokens — generous limits are fine

## Key Files
- `src/geminiService.js` — Central Gemini API client (ALL AI calls go through here)
- `src/llama/llamaService.js` — Agent wrapper around geminiJSON
- `vite.config.js` — Vite proxy config (injects API key)
- `server.js` — Production Express server (rate limiting, model allowlist)
- `src/prompt.js` — Weapon architect + coder system prompts
- `src/themeManager.js` — Theme presets + AI generation + scene application

## Testing
- `node tests/agentTest.js [runs] [agent]` — Comprehensive agent output validation
- Tests call Gemini directly (bypasses Vite proxy), validates JSON schema compliance
- Available agents: `themeGenerator`, `arenaGod`, `warChronicle`, `arenaGen`, `avatar`, `damageMutation`, `enemyDesign`, `narrator`, `weaponVisuals`

## Common Pitfalls
- **JSON parse failures**: Always use `geminiJSON()` which sets `response_format: { type: 'json_object' }`. Never rely on prompt instructions alone for JSON output.
- **File reverts**: Some files may be reverted by linter/formatter. Always re-read before editing.
- **Two theme systems**: `themeManager.js` (player-facing presets + AI) and `arenaBuilder.js` (arena generation) both modify scene visuals independently. They don't coordinate.
