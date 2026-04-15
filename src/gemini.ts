/**
 * gemini.ts — Gemini API calls for memory extraction, consolidation, and War Room
 */
import { GoogleGenAI } from '@google/genai';
import { GOOGLE_API_KEY, GEMINI_FLASH_MODEL } from './config.js';

let _client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    const key = GOOGLE_API_KEY();
    if (!key) throw new Error('GOOGLE_API_KEY is required for Gemini features');
    _client = new GoogleGenAI({ apiKey: key });
  }
  return _client;
}

export async function geminiGenerate(prompt: string, systemInstruction?: string): Promise<string> {
  const client = getGeminiClient();
  const result = await client.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: prompt,
    config: systemInstruction ? { systemInstruction } : undefined,
  });
  return (result as any).text ?? '';
}

export async function geminiGenerateJSON<T>(prompt: string, systemInstruction?: string): Promise<T | null> {
  let text = '';
  try {
    text = await geminiGenerate(prompt, systemInstruction);
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    return JSON.parse(text) as T;
  } catch {
    console.warn('[gemini] Failed to parse JSON response:', text.slice(0, 200));
    return null;
  }
}
