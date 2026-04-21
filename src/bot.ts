/**
 * bot.ts — Telegram bot core (1500+ lines compressed to essentials)
 * Handles all message types, commands, typing indicators, voice, and agent routing.
 */
import { Bot, Context, InputFile } from 'grammy';
import pino from 'pino';

const log = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });
import { enqueue, getQueueDepth } from './message-queue.js';
import { clearSession, getUserByChatId, getAllUsers } from './db.js';
import { buildMemoryContext } from './memory.js';
import { ingestConversation, evaluateRelevance } from './memory-ingest.js';
import { routeMessage, getAvailableAgents, getHiveMindContext } from './orchestrator.js';
import { isLocked, tryUnlock, lock, checkKillPhrase, executeEmergencyKill } from './security.js';
import { guardMessage } from './exfiltration-guard.js';
import { buildCostFooter } from './cost-footer.js';
import { emitSSE } from './state.js';
import { isVoiceReplyEnabled, toggleVoiceReply, touchActivity } from './state.js';
import { startRun, endRun, abortRun } from './state.js';
import { transcribeAudio } from './voice.js';
import {
  TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, MULTIUSER, FEATURES, DEFAULT_AGENT_MODEL,
  RAMAYNE_TELEGRAM_BOT_TOKEN, RAMAYNE_CHAT_ID,
  CHEYENNE_TELEGRAM_BOT_TOKEN, CHEYENNE_CHAT_ID,
} from './config.js';
import { listAgents } from './agent-create.js';
import {
  getMemoriesByAgent, updateSalience, saveMessage, getRecentMessages,
} from './db.js';

export interface UserBot {
  bot: Bot;
  userId: string;
  chatId: string;
}

function getUserBotConfig(userId: string): { token: string; chatId: string } | null {
  if (userId === 'ramayne') {
    const token = RAMAYNE_TELEGRAM_BOT_TOKEN();
    const chatId = RAMAYNE_CHAT_ID();
    if (!token) return null;
    return { token, chatId: chatId || '' };
  }
  if (userId === 'cheyenne') {
    const token = CHEYENNE_TELEGRAM_BOT_TOKEN();
    const chatId = CHEYENNE_CHAT_ID();
    if (!token) return null;
    return { token, chatId: chatId || '' };
  }
  return null;
}

export function createBotsForUsers(): UserBot[] {
  const users = getAllUsers();
  const bots: UserBot[] = [];

  for (const user of users) {
    const config = getUserBotConfig(user.user_id);
    if (!config) {
      log.warn(`[bot] Skipping ${user.user_id}: bot token not configured`);
      continue;
    }
    if (!config.chatId) {
      log.warn(`[bot] Skipping ${user.user_id}: telegram_chat_id not set`);
      continue;
    }

    const bot = new Bot(config.token);

    // Middleware: restrict to this user's chat_id only
    bot.use(async (ctx, next) => {
      const chatId = String(ctx.chat?.id);
      if (chatId !== config.chatId) return; // Silently ignore other chats
      touchActivity(chatId);
      await next();
    });

    // Attach userId to context for use in handlers
    bot.use(async (ctx, next) => {
      (ctx as any).userId = user.user_id;
      await next();
    });

    // ─── /start ───────────────────────────────────────────────────────────────
    bot.command('start', async ctx => {
      const chatId = String(ctx.chat.id);
      const userId = (ctx as any).userId;
      await ctx.reply(
        `Welcome to your <b>AI Business OS</b>.\n\n` +
        `I'm your personal multi-agent assistant. I run real Claude Code on your machine with full tool access.\n\n` +
        `<b>Available agents:</b>\n${getAvailableAgents()}\n\n` +
        `<b>Commands:</b>\n` +
        `/agents — list all agents\n` +
        `/newchat — start a fresh session\n` +
        `/voice — toggle voice replies\n` +
        `/status — system status\n` +
        `/help — full command list\n\n` +
        `Your chat ID: <code>${chatId}</code>`,
        { parse_mode: 'HTML' }
      );
    });

    // ─── /help ────────────────────────────────────────────────────────────────
    bot.command('help', async ctx => {
      await ctx.reply(
        `<b>Commands</b>\n\n` +
        `/start — welcome and setup\n` +
        `/agents — list all available agents\n` +
        `/newchat — clear session, start fresh\n` +
        `/voice — toggle voice replies\n` +
        `/status — system and agent status\n` +
        `/hive — recent hive mind activity\n` +
        `/tasks — list scheduled tasks\n` +
        `/lock — lock the bot\n` +
        `/help — this message\n\n` +
        `<b>Delegation:</b>\n` +
        `Use <code>@agentname: your request</code> to talk to a specific agent.\n` +
        `Use <code>@all: message</code> to broadcast to all agents.\n\n` +
        `<b>Voice:</b>\n` +
        `Send a voice note to transcribe and process it.\n` +
        `Send a photo or document for analysis.`,
        { parse_mode: 'HTML' }
      );
    });

    // ─── /chatid ─────────────────────────────────────────────────────────────
    bot.command('chatid', async ctx => {
      await ctx.reply(`Your chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
    });

    // ─── /newchat ─────────────────────────────────────────────────────────────
    bot.command('newchat', async ctx => {
      const chatId = String(ctx.chat.id);
      const userId = (ctx as any).userId;
      for (const agentId of ['ramayne', 'comms', 'content', 'ops', 'research']) {
        clearSession(userId, chatId, agentId);
      }
      await ctx.reply('Session cleared. Starting fresh.');
    });

    // ─── /agents ─────────────────────────────────────────────────────────────
    bot.command('agents', async ctx => {
      await ctx.reply(listAgents(), { parse_mode: 'HTML' });
    });

    // ─── /voice ───────────────────────────────────────────────────────────────
    bot.command('voice', async ctx => {
      const chatId = String(ctx.chat.id);
      const enabled = toggleVoiceReply(chatId);
      await ctx.reply(enabled ? 'Voice replies enabled.' : 'Voice replies disabled.');
    });

    // ─── /lock and /unlock ───────────────────────────────────────────────────
    bot.command('lock', async ctx => {
      const chatId = String(ctx.chat.id);
      lock(chatId);
      await ctx.reply('Bot locked.');
    });

    // ─── /status ──────────────────────────────────────────────────────────────
    bot.command('status', async ctx => {
      const agents = listAgents();
      await ctx.reply(
        `<b>System Status</b>\n\n` +
        `<b>Agents:</b>\n${agents}\n\n` +
        `<b>Queue depth:</b> ${getQueueDepth(String(ctx.chat.id))} pending\n` +
        `<b>Voice replies:</b> ${isVoiceReplyEnabled(String(ctx.chat.id)) ? 'ON' : 'OFF'}`,
        { parse_mode: 'HTML' }
      );
    });

    // ─── /hive ────────────────────────────────────────────────────────────────
    bot.command('hive', async ctx => {
      const context = getHiveMindContext(20);
      await ctx.reply(context || 'Hive mind is empty.', { parse_mode: 'HTML' });
    });

    // ─── Main text message handler ────────────────────────────────────────────
    bot.on('message:text', async ctx => {
      const chatId = String(ctx.chat.id);
      const userId = (ctx as any).userId;
      const text = ctx.message.text;

      // Kill phrase check (runs before lock check)
      if (checkKillPhrase(text, chatId)) {
        await ctx.reply('Emergency shutdown initiated.').catch(() => {});
        executeEmergencyKill();
      }

      // Lock check — try unlock if locked
      if (isLocked(chatId)) {
        if (tryUnlock(chatId, text)) {
          await ctx.reply('Unlocked.');
        } else {
          await ctx.reply('Bot is locked. Send your PIN to unlock.');
        }
        return;
      }

      enqueue(chatId, () => handleTextMessage(ctx, chatId, userId, text));
    });

    // ─── Voice note handler ───────────────────────────────────────────────────
    bot.on('message:voice', async ctx => {
      const chatId = String(ctx.chat.id);
      const userId = (ctx as any).userId;
      if (isLocked(chatId)) { await ctx.reply('Bot is locked.'); return; }

      enqueue(chatId, async () => {
        let statusMsg: any;
        try {
          statusMsg = await ctx.reply('Transcribing voice note...');
          const file = await ctx.getFile();
          const fileUrl = `https://api.telegram.org/file/bot${config.token}/${file.file_path}`;
          const response = await fetch(fileUrl);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const transcript = await transcribeAudio(buffer, 'audio.ogg');
          const prefixed = `[Voice transcribed]: ${transcript}`;
          if (statusMsg) {
            await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          }
          await handleTextMessage(ctx, chatId, userId, prefixed, true);
        } catch (err) {
          if (statusMsg) {
            await ctx.api.editMessageText(chatId, statusMsg.message_id, `Transcription failed: ${err}`).catch(() => {});
          }
        }
      });
    });

    // ─── Photo handler ────────────────────────────────────────────────────────
    bot.on('message:photo', async ctx => {
      const chatId = String(ctx.chat.id);
      const userId = (ctx as any).userId;
      if (isLocked(chatId)) { await ctx.reply('Bot is locked.'); return; }
      const caption = ctx.message.caption ?? 'Analyse this image';
      enqueue(chatId, () => handleTextMessage(ctx, chatId, userId, `[Photo received]: ${caption}`));
    });

    // ─── Document handler ─────────────────────────────────────────────────────
    bot.on('message:document', async ctx => {
      const chatId = String(ctx.chat.id);
      const userId = (ctx as any).userId;
      if (isLocked(chatId)) { await ctx.reply('Bot is locked.'); return; }
      const filename = ctx.message.document.file_name ?? 'document';
      const caption = ctx.message.caption ?? 'Process this document';
      enqueue(chatId, () => handleTextMessage(ctx, chatId, userId, `[Document: ${filename}]: ${caption}`));
    });

    // Error handler for Grammy — logs 409 and other Telegram errors
    bot.catch(err => {
      log.error({ err }, 'bot error — will be retried by grammy');
    });

    bots.push({ bot, userId: user.user_id, chatId: config.chatId });
    log.info({ userId: user.user_id, chatId: config.chatId }, 'Bot registered');
  }

  return bots;
}

// Keep createBot() for backwards-compatibility with single-user mode (deprecated)
export function createBot(): Bot {
  const bot = new Bot(TELEGRAM_BOT_TOKEN());

  // ─── Middleware: chat allowlist ────────────────────────────────────────────

  bot.use(async (ctx, next) => {
    const chatId = String(ctx.chat?.id);
    const allowed = ALLOWED_CHAT_IDS();
    if (!allowed.includes(chatId) && allowed.filter(Boolean).length > 0) {
      return; // Silently ignore unauthorised chats
    }
    touchActivity(chatId);
    await next();
  });

  // ─── /start ───────────────────────────────────────────────────────────────

  bot.command('start', async ctx => {
    const chatId = String(ctx.chat.id);
    await ctx.reply(
      `Welcome to your <b>AI Business OS</b>.\n\n` +
      `I'm your personal multi-agent assistant. I run real Claude Code on your machine with full tool access.\n\n` +
      `<b>Available agents:</b>\n${getAvailableAgents()}\n\n` +
      `<b>Commands:</b>\n` +
      `/agents — list all agents\n` +
      `/newchat — start a fresh session\n` +
      `/voice — toggle voice replies\n` +
      `/status — system status\n` +
      `/help — full command list\n\n` +
      `Your chat ID: <code>${chatId}</code>`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── /help ────────────────────────────────────────────────────────────────

  bot.command('help', async ctx => {
    await ctx.reply(
      `<b>Commands</b>\n\n` +
      `/start — welcome and setup\n` +
      `/agents — list all available agents\n` +
      `/newchat — clear session, start fresh\n` +
      `/voice — toggle voice replies\n` +
      `/status — system and agent status\n` +
      `/hive — recent hive mind activity\n` +
      `/tasks — list scheduled tasks\n` +
      `/lock — lock the bot\n` +
      `/help — this message\n\n` +
      `<b>Delegation:</b>\n` +
      `Use <code>@agentname: your request</code> to talk to a specific agent.\n` +
      `Use <code>@all: message</code> to broadcast to all agents.\n\n` +
      `<b>Voice:</b>\n` +
      `Send a voice note to transcribe and process it.\n` +
      `Send a photo or document for analysis.`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── /chatid ─────────────────────────────────────────────────────────────

  bot.command('chatid', async ctx => {
    await ctx.reply(`Your chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
  });

  // ─── /newchat ─────────────────────────────────────────────────────────────

  bot.command('newchat', async ctx => {
    const chatId = String(ctx.chat.id);
    clearSession('ramayne', chatId, 'main');
    clearSession('ramayne', chatId, 'comms');
    clearSession('ramayne', chatId, 'content');
    clearSession('ramayne', chatId, 'ops');
    clearSession('ramayne', chatId, 'research');
    await ctx.reply('Session cleared. Starting fresh.');
  });

  // ─── /agents ──────────────────────────────────────────────────────────────

  bot.command('agents', async ctx => {
    await ctx.reply(listAgents(), { parse_mode: 'HTML' });
  });

  // ─── /voice ───────────────────────────────────────────────────────────────

  bot.command('voice', async ctx => {
    const chatId = String(ctx.chat.id);
    const enabled = toggleVoiceReply(chatId);
    await ctx.reply(enabled ? 'Voice replies enabled.' : 'Voice replies disabled.');
  });

  // ─── /lock and /unlock ────────────────────────────────────────────────────

  bot.command('lock', async ctx => {
    const chatId = String(ctx.chat.id);
    lock(chatId);
    await ctx.reply('Bot locked.');
  });

  // ─── /status ──────────────────────────────────────────────────────────────

  bot.command('status', async ctx => {
    const agents = listAgents();
    await ctx.reply(
      `<b>System Status</b>\n\n` +
      `<b>Agents:</b>\n${agents}\n\n` +
      `<b>Queue depth:</b> ${getQueueDepth(String(ctx.chat.id))} pending\n` +
      `<b>Voice replies:</b> ${isVoiceReplyEnabled(String(ctx.chat.id)) ? 'ON' : 'OFF'}`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── /hive ────────────────────────────────────────────────────────────────

  bot.command('hive', async ctx => {
    const context = getHiveMindContext(20);
    await ctx.reply(context || 'Hive mind is empty.', { parse_mode: 'HTML' });
  });

  // ─── Main text message handler ────────────────────────────────────────────

  bot.on('message:text', async ctx => {
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text;

    // Kill phrase check (runs before lock check)
    if (checkKillPhrase(text, chatId)) {
      await ctx.reply('Emergency shutdown initiated.').catch(() => {});
      executeEmergencyKill();
    }

    // Lock check — try unlock if locked
    if (isLocked(chatId)) {
      if (tryUnlock(chatId, text)) {
        await ctx.reply('Unlocked.');
      } else {
        await ctx.reply('Bot is locked. Send your PIN to unlock.');
      }
      return;
    }

    enqueue(chatId, () => handleTextMessage(ctx, chatId, 'ramayne', text));
  });

  // ─── Voice note handler ───────────────────────────────────────────────────

  bot.on('message:voice', async ctx => {
    const chatId = String(ctx.chat.id);
    if (isLocked(chatId)) { await ctx.reply('Bot is locked.'); return; }

    enqueue(chatId, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let statusMsg: any;
      try {
        statusMsg = await ctx.reply('Transcribing voice note...');
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN()}/${file.file_path}`;

        // Download the file
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Rename .oga -> .ogg (Groq doesn't accept .oga)
        const transcript = await transcribeAudio(buffer, 'audio.ogg');
        const prefixed = `[Voice transcribed]: ${transcript}`;

        if (statusMsg) {
          await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }
        await handleTextMessage(ctx, chatId, 'ramayne', prefixed, true);
      } catch (err) {
        if (statusMsg) {
          await ctx.api.editMessageText(chatId, statusMsg.message_id, `Transcription failed: ${err}`).catch(() => {});
        }
      }
    });
  });

  // ─── Photo handler ────────────────────────────────────────────────────────

  bot.on('message:photo', async ctx => {
    const chatId = String(ctx.chat.id);
    if (isLocked(chatId)) { await ctx.reply('Bot is locked.'); return; }
    const caption = ctx.message.caption ?? 'Analyse this image';
    enqueue(chatId, () => handleTextMessage(ctx, chatId, 'ramayne', `[Photo received]: ${caption}`));
  });

  // ─── Document handler ─────────────────────────────────────────────────────

  bot.on('message:document', async ctx => {
    const chatId = String(ctx.chat.id);
    if (isLocked(chatId)) { await ctx.reply('Bot is locked.'); return; }
    const filename = ctx.message.document.file_name ?? 'document';
    const caption = ctx.message.caption ?? 'Process this document';
    enqueue(chatId, () => handleTextMessage(ctx, chatId, 'ramayne', `[Document: ${filename}]: ${caption}`));
  });

  // Error handler for Grammy — logs 409 and other Telegram errors
  bot.catch(err => {
    log.error({ err }, 'bot error — will be retried by grammy');
  });

  return bot;
}

// ─── Core message processing ──────────────────────────────────────────────────

async function handleTextMessage(
  ctx: Context,
  chatId: string,
  userId: string,
  text: string,
  forceVoice = false,
): Promise<void> {
  const runKey = `${chatId}_${Date.now()}`;
  const abortCtrl = startRun(runKey);

  // Determine which agent to route to based on user — each user has their own master agent
  const masterAgentId = userId; // ramayne → ramayne, cheyenne → cheyenne

  // Start typing indicator — refreshes every 4s (Telegram expires at ~5s)
  let typingInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
    ctx.api.sendChatAction(chatId, 'typing').catch(() => {});
  }, 4000);
  await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

  try {
    // Build memory context (scoped to this user)
    const { context: memContext, surfacedIds, summaries } = await buildMemoryContext(userId, masterAgentId, chatId, text);

    // Build hive mind context
    const hiveContext = getHiveMindContext(10);

    // Inject memory + hive mind into prompt
    let augmentedPrompt = text;
    const contextParts = [memContext, hiveContext].filter(Boolean);
    if (contextParts.length > 0) {
      augmentedPrompt = contextParts.join('\n\n') + '\n\n---\n\n' + text;
    }

    // Save user message to history
    saveMessage(userId, chatId, masterAgentId, 'user', text);

    // Route to appropriate agent
    const results = await routeMessage(augmentedPrompt, chatId, userId, masterAgentId, abortCtrl.signal);

    // Combine results
    const combinedText = results.map(r => {
      const prefix = results.length > 1 ? `**${r.agentId}:** ` : '';
      return prefix + r.result.text;
    }).join('\n\n---\n\n');

    const primaryResult = results[0].result;

    // Guard against exfiltration
    const safeText = guardMessage(combinedText, chatId, masterAgentId);

    // Add cost footer
    const footer = buildCostFooter(primaryResult.model, primaryResult.inputTokens, primaryResult.outputTokens);
    const finalText = safeText + footer;

    // Save assistant message to history
    saveMessage(userId, chatId, masterAgentId, 'assistant', safeText);

    // Fire-and-forget memory ingestion
    ingestConversation(userId, chatId, masterAgentId, [
      { role: 'user', content: text },
      { role: 'assistant', content: safeText },
    ]).catch(() => {});

    // Fire-and-forget relevance evaluation
    if (surfacedIds.length > 0) {
      evaluateRelevance(
        surfacedIds,
        summaries,
        text,
        safeText,
        (id: string, delta: number) => {
          updateSalience(id, 1.0 + delta);
        }
      ).catch(() => {});
    }

    // Emit SSE for dashboard
    emitSSE('message', { chatId, role: 'assistant', text: safeText.slice(0, 200) });

    // Send reply — voice or text
    if (forceVoice || isVoiceReplyEnabled(chatId)) {
      await sendVoiceReply(ctx, chatId, safeText);
    } else {
      await sendTextReply(ctx, finalText);
    }
  } catch (err) {
    const errMsg = abortCtrl.signal.aborted ? 'Request cancelled.' : `Error: ${err instanceof Error ? err.message : String(err)}`;
    await ctx.reply(errMsg).catch(() => {});
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
    endRun(runKey);
  }
}

// ─── Reply helpers ────────────────────────────────────────────────────────────

const MAX_TG_LENGTH = 4096;

async function sendTextReply(ctx: Context, text: string): Promise<void> {
  if (text.length <= MAX_TG_LENGTH) {
    await ctx.reply(formatForTelegram(text), { parse_mode: 'HTML' }).catch(async () => {
      // If HTML parsing fails, send as plain text
      await ctx.reply(text.slice(0, MAX_TG_LENGTH)).catch(() => {});
    });
    return;
  }

  // Split long messages
  const chunks = splitMessage(text, MAX_TG_LENGTH);
  for (const chunk of chunks) {
    await ctx.reply(formatForTelegram(chunk), { parse_mode: 'HTML' }).catch(async () => {
      await ctx.reply(chunk).catch(() => {});
    });
    await new Promise(r => setTimeout(r, 300)); // Small delay between chunks
  }
}

async function sendVoiceReply(ctx: Context, chatId: string, text: string): Promise<void> {
  try {
    const { synthesizeSpeech } = await import('./voice.js');
    const audioBuffer = await synthesizeSpeech(text.slice(0, 2000));
    if (audioBuffer) {
      await ctx.replyWithVoice(new InputFile(audioBuffer, 'reply.ogg'));
      return;
    }
  } catch {
    // TTS failed — fall back to text
  }
  await sendTextReply(ctx, text);
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt === -1) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt === -1) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function formatForTelegram(md: string): string {
  // Escape & < > first in text nodes
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (preserve content)
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => `<pre>${code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}</pre>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  html = html.replace(/_([^_]+)_/g, '<i>$1</i>');

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Remove heading hashes (not supported in TG)
  html = html.replace(/^#{1,6}\s+/gm, '<b>');
  html = html.replace(/(<b>[^\n]+)\n/g, '$1</b>\n');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '');

  return html;
}
