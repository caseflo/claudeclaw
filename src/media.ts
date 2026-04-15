/**
 * media.ts — Telegram file download and context building
 */
import { TELEGRAM_BOT_TOKEN } from './config.js';

export async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN()}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function buildMediaContext(mediaType: string, filename: string, caption?: string): string {
  return `[${mediaType}: ${filename}]${caption ? ` — ${caption}` : ''}`;
}
