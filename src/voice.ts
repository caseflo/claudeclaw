/**
 * voice.ts — STT/TTS cascade (504 lines compressed to essentials)
 * STT: Groq Whisper → OpenAI Whisper (fallback)
 * TTS: ElevenLabs → Gradium → Kokoro → pyttsx3 (Windows SAPI, offline fallback)
 */
import { GROQ_API_KEY, OPENAI_API_KEY_VOICE, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, KOKORO_URL, GRADIUM_API_KEY } from './config.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ─── Speech-to-Text ───────────────────────────────────────────────────────────

export async function transcribeAudio(audioBuffer: Buffer, filename = 'audio.ogg'): Promise<string> {
  const groqKey = GROQ_API_KEY();
  if (groqKey) {
    try {
      return await transcribeGroq(audioBuffer, filename, groqKey);
    } catch (err) {
      console.warn('[voice] Groq STT failed, trying OpenAI:', err);
    }
  }

  const openaiKey = OPENAI_API_KEY_VOICE();
  if (openaiKey) {
    try {
      return await transcribeOpenAI(audioBuffer, filename, openaiKey);
    } catch (err) {
      console.warn('[voice] OpenAI STT failed:', err);
    }
  }

  throw new Error('No STT service available. Add GROQ_API_KEY or OPENAI_API_KEY to .env');
}

async function transcribeGroq(buffer: Buffer, filename: string, apiKey: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: 'audio/ogg' });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-large-v3-turbo');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) throw new Error(`Groq STT HTTP ${res.status}`);
  const data = await res.json() as { text: string };
  return data.text;
}

async function transcribeOpenAI(buffer: Buffer, filename: string, apiKey: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: 'audio/ogg' });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) throw new Error(`OpenAI STT HTTP ${res.status}`);
  const data = await res.json() as { text: string };
  return data.text;
}

// ─── Text-to-Speech ───────────────────────────────────────────────────────────

export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  // Cascade: ElevenLabs → Gradium → Kokoro → pyttsx3
  const elevenlabsKey = ELEVENLABS_API_KEY();
  if (elevenlabsKey) {
    try {
      return await ttsElevenLabs(text, elevenlabsKey);
    } catch (err) {
      console.warn('[voice] ElevenLabs TTS failed:', err);
    }
  }

  const gradiumKey = GRADIUM_API_KEY();
  if (gradiumKey) {
    try {
      return await ttsGradium(text, gradiumKey);
    } catch (err) {
      console.warn('[voice] Gradium TTS failed:', err);
    }
  }

  const kokoroUrl = KOKORO_URL();
  if (kokoroUrl) {
    try {
      return await ttsKokoro(text, kokoroUrl);
    } catch (err) {
      console.warn('[voice] Kokoro TTS failed:', err);
    }
  }

  // Windows fallback: pyttsx3 (Windows SAPI, offline)
  try {
    return await ttsPyttsx3(text);
  } catch (err) {
    console.warn('[voice] pyttsx3 TTS failed:', err);
  }

  return null;
}

async function ttsElevenLabs(text: string, apiKey: string): Promise<Buffer> {
  const voiceId = ELEVENLABS_VOICE_ID();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ttsGradium(text: string, apiKey: string): Promise<Buffer> {
  const res = await fetch('https://api.gradium.ai/tts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`Gradium HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ttsKokoro(text: string, baseUrl: string): Promise<Buffer> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/audio/speech`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', input: text, voice: 'af_sky', response_format: 'opus' }),
  });
  if (!res.ok) throw new Error(`Kokoro HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ttsPyttsx3(text: string): Promise<Buffer> {
  // Windows SAPI via Python pyttsx3 — offline, no API key needed
  const tmpOut = join(tmpdir(), `tts-${randomUUID()}.wav`);
  const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const script = `
import pyttsx3
engine = pyttsx3.init()
engine.setProperty('rate', 175)
engine.save_to_file("""${escapedText}""", r"${tmpOut.replace(/\\/g, '\\\\')}")
engine.runAndWait()
`;
  const scriptFile = join(tmpdir(), `tts-${randomUUID()}.py`);
  writeFileSync(scriptFile, script, 'utf8');

  execSync(`python "${scriptFile}"`, { timeout: 30000 });

  if (!existsSync(tmpOut)) throw new Error('pyttsx3 did not produce output file');
  const buffer = readFileSync(tmpOut);
  return buffer;
}
