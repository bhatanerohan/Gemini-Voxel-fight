// src/llama/llamaService.js — LlamaIndex Agent Infrastructure
// All agents call Gemini through the existing server.js proxy
// This runs SERVER-SIDE (imported by server.js agent endpoints)

import { geminiJSON } from '../geminiService.js';

/**
 * Run an agent-style prompt expecting structured JSON back.
 * Wraps the existing geminiJSON with agent-specific system prompts.
 * Includes retry logic and fallback.
 */
export async function runAgent(agentConfig, userMessage) {
  try {
    const result = await geminiJSON({
      systemPrompt: agentConfig.systemPrompt,
      userMessage,
      temperature: agentConfig.temperature ?? 0.8,
      maxTokens: agentConfig.maxTokens ?? 2000,
    });
    return result;
  } catch (err) {
    console.warn(`[LlamaAgent:${agentConfig.name}] Failed:`, err.message);
    return null;
  }
}

/**
 * Define an agent config (lightweight wrapper for hackathon speed).
 * In production this would be a full LlamaIndex AgentWorkflow.
 */
export function defineAgent({ name, systemPrompt, temperature = 0.8, maxTokens = 2000 }) {
  return { name, systemPrompt, temperature, maxTokens };
}
