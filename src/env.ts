/**
 * env.ts — reads .env without polluting process.env
 * Use readEnvFile() for secrets. Never use process.env for API keys.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

let _cache: Record<string, string> | null = null;

export function readEnvFile(): Record<string, string> {
  if (_cache) return _cache;

  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) {
    _cache = {};
    return _cache;
  }

  const raw = readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }

  _cache = env;
  return _cache;
}

export function getEnv(key: string, fallback?: string): string {
  const env = readEnvFile();
  const val = env[key] ?? process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

export function getEnvOptional(key: string, fallback = ''): string {
  const env = readEnvFile();
  return env[key] ?? process.env[key] ?? fallback;
}

export function invalidateEnvCache(): void {
  _cache = null;
}
