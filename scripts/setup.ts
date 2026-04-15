/**
 * setup.ts — Interactive setup wizard
 * Collects API keys, writes .env, configures agents.
 */
import { createInterface } from 'readline';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

console.log(`
╔══════════════════════════════════╗
║    AI Business OS — Setup Wizard ║
╚══════════════════════════════════╝
`);

async function main() {
  console.log('This wizard will collect your API keys and write a .env file.\n');
  console.log('Press Enter to skip any optional key.\n');

  const env: Record<string, string> = {};

  // Required
  env.TELEGRAM_BOT_TOKEN = await ask('Telegram bot token (from @BotFather): ');
  env.ALLOWED_CHAT_ID = await ask('Your Telegram chat ID (leave blank — bot will tell you): ') || '';
  env.DASHBOARD_TOKEN = await ask('Dashboard token (password for web UI) [default: changeme]: ') || 'changeme';

  console.log('\n── Google AI (for Memory v2 + War Room) ──');
  console.log('Free at https://aistudio.google.com/app/apikey');
  env.GOOGLE_API_KEY = await ask('Google API key: ');

  console.log('\n── Voice STT ──');
  console.log('Groq is free: https://console.groq.com');
  env.GROQ_API_KEY = await ask('Groq API key (recommended, free): ');

  console.log('\n── Voice TTS ──');
  console.log('ElevenLabs free tier: https://elevenlabs.io');
  env.ELEVENLABS_API_KEY = await ask('ElevenLabs API key (optional): ');
  if (env.ELEVENLABS_API_KEY) {
    env.ELEVENLABS_VOICE_ID = await ask('ElevenLabs voice ID [press Enter for default]: ') || 'EXAVITQu4vr4xnSDxMaL';
  }

  console.log('\n── Security ──');
  const pin = await ask('PIN to lock/unlock bot (leave blank to skip): ');
  if (pin) {
    const { hashPIN } = await import('../src/security.js');
    env.PIN_HASH = hashPIN(pin);
    console.log('PIN hash generated.');
  }
  env.KILL_PHRASE = await ask('Emergency kill phrase (leave blank to skip): ');

  // Write .env
  const envContent = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const envPath = resolve(ROOT, '.env');
  const backup = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
  if (backup) writeFileSync(envPath + '.bak', backup);
  writeFileSync(envPath, envContent + '\n', 'utf8');

  console.log(`\n✅ .env written to ${envPath}`);
  if (!env.ALLOWED_CHAT_ID) {
    console.log('\n⚠️  No chat ID set yet. Start the bot, send it any message, and it will display your chat ID.');
    console.log('   Then add ALLOWED_CHAT_ID=<your_id> to .env and restart.');
  }

  console.log('\n── PM2 Background Service (Windows) ──');
  console.log('Run these commands to keep the bot running after you close your terminal:\n');
  console.log('  npm install -g pm2');
  console.log('  npm run build');
  console.log('  pm2 start dist/index.js --name claudeclaw-os');
  console.log('  pm2 save');
  console.log('  pm2 startup');
  console.log('\nTo start now (dev mode, no build needed):');
  console.log('  npm run dev\n');

  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
