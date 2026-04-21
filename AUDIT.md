# Claudeclaw OS — Audit Report

**Auditor:** Opus 4.7
**Date:** 2026-04-21
**Commit audited:** `595b42e` (`fix: add baseURL for MiniMax M2.7`) + uncommitted CRLF-only diff on `src/config.ts`
**Scope:** full repository read, no changes written
**Users in scope:** Ramayne (founder), Cheyenne (co-founder)
**Primary product supported:** CaseFlo (UK IFA SaaS)

---

## 1. Current State Inventory

### 1.1 File-by-file (non-generated)

| Path | Classification | One-liner |
|------|----------------|-----------|
| `CLAUDE.md` | core (docs) | Root system prompt — names "Wendy" as sole user, lists 4 worker agents, declares hive-mind + UK English behaviour. |
| `agent.yaml` | config | Registers 5 agents (main + comms/content/ops/research) all pinned to `claude-sonnet-4-6`. Loaded by `agent-config.ts`. |
| `package.json` | config | NPM manifest. Declares 10 runtime deps, 5 dev deps. Has broken script `mission` → missing file. |
| `package-lock.json` | config | Lockfile. `@anthropic-ai/sdk@0.81.0` present as a transitive dep only. |
| `tsconfig.json` | config | ES2022 strict build to `./dist`. Excludes `warroom/` and `scripts/`. |
| `.env` | secret (local-only) | Real Telegram / Google / Groq / MiniMax-Anthropic tokens. `.gitignore` excludes it — but see §4.3. |
| `.env.example` | docs | Template with comments. Missing several keys the code reads (§4.1). |
| `.gitignore` | config | Ignores `node_modules`, `dist`, `store`, `.env`, `*.pid`, audio files. |
| `start.bat` | config (Windows) | One-liner: `npm run dev`. No PM2, no service wrapper. |
| `src/index.ts` | **core entry** | Boots dashboard, scheduler, consolidation loop, salience decay, Telegram bot. Single shutdown path. |
| `src/config.ts` | **core** | 46-ish typed env getters + feature flags + path constants. All secrets are lazy-getter functions. |
| `src/env.ts` | **core** | Hand-rolled `.env` parser with in-memory cache. Falls back to `process.env`. No `dotenv` dep. |
| `src/db.ts` | **core** | `node:sqlite` layer. 10 tables (sessions, messages, memories, memories_fts, consolidations, hive_mind, scheduled_tasks, audit_log, agents, token_usage). WAL + FTS5. |
| `src/bot.ts` | **core** | Grammy Telegram bot. Commands, voice/photo/doc handlers, message queueing, HTML formatter, chunked replies. Single-bot singleton. |
| `src/agent.ts` | **core** | Thin `@anthropic-ai/sdk` streaming wrapper targeting MiniMax endpoint. Four critical gaps (§2.4). |
| `src/orchestrator.ts` | **core** | `@agentname:` delegation + `@all:` broadcast. Builds hive-mind context. |
| `src/agent-config.ts` | **core** | Loads `agent.yaml` (30s cache), resolves per-agent working dir and CLAUDE.md. |
| `src/agent-create.ts` | **core** | CRUD for dynamically-created agents — writes CLAUDE.md, `config.yml`, updates `agent.yaml` and DB. |
| `src/memory.ts` | **core** | 5-layer retrieval (embeddings + FTS + importance + consolidation + history). **Contains a bug at line 72.** |
| `src/memory-ingest.ts` | **core** | Gemini-powered memory extraction from conversation pairs. Fire-and-forget. |
| `src/memory-consolidate.ts` | **core** | 30-min Gemini consolidation loop; finds patterns and contradictions. |
| `src/embeddings.ts` | **core** | Gemini `text-embedding-004` wrapper. Hex-packed float32 storage. |
| `src/gemini.ts` | **core** | Gemini Flash generate + JSON-strict generate. |
| `src/dashboard.ts` | core (optional) | Hono web server on port 3141. SSE endpoint leaks listeners (§2.6). |
| `src/dashboard-html.ts` | core (optional) | Embedded SPA (dark theme). |
| `src/scheduler.ts` | core (optional) | Mission-Control cron loop (60s poll). |
| `src/schedule-cli.ts` | CLI | `tsx src/schedule-cli.ts create|list|delete|pause|resume`. |
| `src/security.ts` | core (optional) | PIN lock, idle auto-lock, kill phrase, audit log. |
| `src/exfiltration-guard.ts` | core | 15 regex patterns redacting secrets from outgoing messages. |
| `src/state.ts` | **core** | In-memory abort controllers, SSE bus, lock state, voice-toggle set, nudge state, war-room handle. |
| `src/cost-footer.ts` | core | 5-mode cost/token footer appended to Telegram replies. |
| `src/voice.ts` | core (optional) | STT (Groq → OpenAI) + TTS cascade (ElevenLabs → Gradium → Kokoro → pyttsx3). Shells out to Python. |
| `src/errors.ts` | **dead** | Error classifier — never imported anywhere. |
| `src/media.ts` | **dead** | Telegram file download helper — never imported. |
| `src/message-classifier.ts` | **dead** | Simple/complex classifier — never imported. |
| `scripts/setup.ts` | setup | Interactive wizard to write `.env`. Excluded from tsc build. |
| `agents/main/CLAUDE.md` | agent prompt | Main agent system prompt. **Never actually injected into any API call** (§2.4.3). |
| `agents/comms/CLAUDE.md` | agent prompt | Comms agent prompt. Same problem. |
| `agents/content/CLAUDE.md` | agent prompt | Content agent prompt. Same problem. |
| `agents/ops/CLAUDE.md` | agent prompt | Ops agent prompt. Same problem. |
| `agents/research/CLAUDE.md` | agent prompt | Research agent prompt. Same problem. |
| `agents/_template/{CLAUDE.md,config.yml}` | template | Scaffold for new agents. |
| `warroom/` | **empty dir** | Referenced by config (`FEATURE_WAR_ROOM`, `WARROOM_MODE`) but contains zero files. |
| `store/claudeclaw.db*` | runtime state | SQLite DB + WAL + SHM. Not in git. |
| `store/claudeclaw.pid` | runtime state | Current process PID. |
| `.playwright-cli/*` | **dead weight (committed)** | 30+ Playwright console/page dumps from 15 Apr debugging — should be `.gitignore`d and removed. |
| `dist/*` | generated | Compiled JS. Not in git but present on disk. |

**Dead weight to delete:** `src/errors.ts`, `src/media.ts`, `src/message-classifier.ts`, `warroom/` (empty), `.playwright-cli/` (committed, stale).

**Broken references in `package.json`:**
- `"status": "tsx scripts/status.ts"` → file does not exist.
- `"mission": "tsx src/mission-cli.ts"` → file does not exist.

### 1.2 Actual architecture

```
                           ┌─────────────────────────────┐
                           │  Telegram (long polling)    │
                           │  single bot, single token   │
                           └──────────────┬──────────────┘
                                          │ grammy
                                          ▼
┌──────────────────────────────────── src/bot.ts ────────────────────────────────────┐
│ • allowlist middleware (ALLOWED_CHAT_IDS)                                           │
│ • commands /start /help /chatid /newchat /agents /voice /lock /status /hive         │
│ • typing indicator loop (4 s)                                                       │
│ • per-chat FIFO queue (message-queue.ts) → handleTextMessage()                      │
└─────────────────┬───────────────────────────────────────────────────────────────────┘
                  │
                  ▼                               ┌──── voice.ts (Groq / OpenAI /      │
   ┌───────── handleTextMessage ──────────┐      │                ElevenLabs / …)    │
   │ 1. memory.buildMemoryContext()       │◀────┤                                    │
   │ 2. orchestrator.getHiveMindContext() │      └────────────────────────────────── │
   │ 3. saveMessage(user)                 │
   │ 4. orchestrator.routeMessage() ──────┼────▶ agent.runAgentWithRetry()
   │ 5. exfiltration-guard.guardMessage() │          └─▶ @anthropic-ai/sdk
   │ 6. cost-footer.buildCostFooter()     │              baseURL = api.minimax.io
   │ 7. saveMessage(assistant)            │
   │ 8. fire-and-forget: ingestConversation + evaluateRelevance (gemini)
   │ 9. emitSSE → dashboard
   │10. sendTextReply / sendVoiceReply    │
   └──────────────────────────────────────┘

 Parallel background jobs (started from index.ts):
   • startScheduler()               scheduler.ts  — 60 s cron poll
   • startConsolidationLoop('main') memory-consolidate.ts — 30 min
   • runSalienceDecay / 24 h        db.ts
   • startDashboard()               dashboard.ts — Hono on :3141

 Persistent state: store/claudeclaw.db   (SQLite WAL, 10 tables)
 Ephemeral state:  src/state.ts          (Maps + EventEmitter, lost on restart)
 Process identity: store/claudeclaw.pid  (single-instance lock — dangerous under PM2)
```

### 1.3 Worker agents — implemented vs. referenced

| Agent | `agent.yaml` entry | `agents/<id>/CLAUDE.md` | Actually distinct behaviour? |
|-------|--------------------|--------------------------|------------------------------|
| `main` | yes | yes | no — CLAUDE.md never injected |
| `comms` | yes | yes | no — same reason |
| `content` | yes | yes | no — same reason |
| `ops` | yes | yes | no — same reason |
| `research` | yes | yes | no — same reason |

All five agents hit the same model (`claude-sonnet-4-6`) through the same code path with **no system prompt passed** (see §2.4.3). Delegation via `@agentname:` is wired and the `hive_mind` delegation event is logged, but the agent being "delegated to" is functionally identical to the default agent. In effect, today there is **one agent with five cosmetic labels**.

---

## 2. What's Broken / Why It Was Shutting Down

Ordered roughly by "most likely direct cause of the VPS crashes" first.

### 2.1 No PM2 ecosystem file anywhere in the repo
- **Impact:** no autorestart policy, no `max_memory_restart`, no `min_uptime`, no log paths, no kill timeout. If PM2 was being used on the VPS it was from an untracked ad-hoc `pm2 start dist/index.js` (the wording `scripts/setup.ts:77` literally prints that command).
- **Fix:** create `ecosystem.config.cjs` (§7.1).

### 2.2 `killExistingInstance()` pattern fights PM2
- **File:** `src/index.ts:30-41`, called at `src/index.ts:67`.
- **What it does:** on startup, reads `store/claudeclaw.pid` and `SIGTERM`s whoever is there.
- **Why it breaks under PM2:** when PM2 restarts the process after an OOM or hang, there is a brief window where the old PM2-managed process is still dying and the new one starts. The new one calls `process.kill(oldPid, 'SIGTERM')` on the dying instance — which PM2 interprets as an unexpected exit and may issue another restart. Under rapid restart storms the two can kill each other in a loop until PM2 hits `max_restarts` and gives up → **process permanently down**. This is almost certainly one of the "shutting down" symptoms you saw.
- **Fix:** remove `killExistingInstance()` entirely and switch to a hard-fail PID check: if `pid` is alive, `process.exit(1)` with a clear message; let PM2 be the sole process manager.

### 2.3 No `unhandledRejection` or `uncaughtException` handler
- **File:** `src/index.ts` has only `SIGINT` / `SIGTERM` handlers.
- **Impact:** Node 15+ defaults to crashing on unhandled rejection. Any `.catch(() => {})` that is *missed* kills the process. Obvious exposures:
  - `src/agent.ts:96-108` — `runAgentWithRetry` throws after N retries; only some call sites catch.
  - `src/memory-consolidate.ts:80-83` — chained timer calls `.catch(() => {})` but the inner `runConsolidation` reassigns `_processing` without try-guarding the Gemini JSON parse (it does, but any future regression is one crash away).
  - `src/scheduler.ts:17-22` — the interval callback catches, but `runTask` uses `updateTaskRun` inside which can throw if DB is mid-migration.
  - `src/bot.ts:177-192` — voice handler's `statusMsg` is declared inside the `try`, but referenced in the `catch` where it may be undefined → `ReferenceError` → unhandled rejection.
- **Fix (one-line class):** add in `src/index.ts` before `main()`:
  ```
  process.on('unhandledRejection', e => log.error({ err: e }, 'unhandledRejection'));
  process.on('uncaughtException',  e => log.error({ err: e }, 'uncaughtException'));
  ```
  combined with PM2 autorestart, this stops crashes while still recovering from fatal states.

### 2.4 `src/agent.ts` — four compounding bugs

#### 2.4.1 Missing direct dependency on `@anthropic-ai/sdk`
- **File:** `src/agent.ts:4` — `import Anthropic from '@anthropic-ai/sdk';`
- **Problem:** `package.json` does **not** list `@anthropic-ai/sdk`. It resolves today only because `@anthropic-ai/claude-agent-sdk@0.2.109` pulls it as a transitive dep. The day `claude-agent-sdk` drops that dep (or you run `npm ci` in an environment that prunes transitives), the bot fails at import time with `MODULE_NOT_FOUND` → PM2 restart loop → permanently down.
- **Fix:** add `"@anthropic-ai/sdk": "^0.81.0"` to `dependencies` in `package.json`.

#### 2.4.2 Hardcoded MiniMax `baseURL`
- **File:** `src/agent.ts:9` — `new Anthropic({ apiKey: ANTHROPIC_API_KEY(), baseURL: "https://api.minimax.io/anthropic" });`
- **Problem:** no env override. If MiniMax is down, you cannot flip to the real Anthropic API without a code change + redeploy. Also `ANTHROPIC_API_KEY` is optional (`getEnvOptional`) — if it's missing, the client initialises with an empty string and every call returns 401 forever without a clean error message.
- **Fix:** read `ANTHROPIC_BASE_URL` from env with MiniMax as default, and `throw` early in `main()` if `ANTHROPIC_API_KEY` is empty.

#### 2.4.3 System prompt is never forwarded to the model
- **File:** `src/agent.ts:88-108` (`runAgentWithRetry`) + `src/orchestrator.ts:46-68`.
- **Problem:** every `runAgentWithRetry(prompt, chatId, agentId, undefined, signal)` call site passes `undefined` as the system prompt. Even though `agent.ts` *supports* a `systemPrompt` arg, nobody loads the per-agent `agents/<id>/CLAUDE.md` file. Result: all five worker agents are indistinguishable.
- **Fix:** in `orchestrator.routeMessage`, resolve `resolveAgentClaudeMd(agentId)` via `agent-config.ts:75`, read the file (cache it), and pass it down.

#### 2.4.4 Conversation history is never replayed
- **File:** `src/agent.ts:38-40` — `messages = [{ role: 'user', content: prompt }]`.
- **Problem:** the DB stores messages (`saveMessage` in `bot.ts:250,271`) but nothing ever calls `getRecentMessages` when building the Anthropic request. So the model sees a single new-user-turn every time, with no prior conversation. The injected memory context (from `buildMemoryContext`) partially masks this, but it's an LLM-summarised facsimile, not the actual turn history. Users will perceive the bot as forgetful. Combined with §2.4.5 below, session state is completely fictional.

#### 2.4.5 Session-ID fabrication
- **File:** `src/agent.ts:72` — `newSessionId = fullText.slice(0, 100);`
- **Problem:** stores the first 100 characters of the **response text** as a "session id". Nothing consumes that string usefully later. The `sessions` table is write-only noise.

### 2.5 `memory.ts:72` — Layer 1 semantic retrieval fetches wrong rows
- **File:** `src/memory.ts:71-74`.
  ```ts
  for (const { id } of scored) {
    const results = searchConversationHistory(id, agentId, 365, 1);  // <-- passes UUID as keyword
    results.forEach(addMemory);
  }
  ```
- **Problem:** `searchConversationHistory` does `summary LIKE '%<id>%'`. A UUID will never match memory text, so Layer 1 (semantic) silently returns nothing and falls through to Layer 2 (FTS). Embeddings are effectively disabled for retrieval.
- **Fix:** replace with a direct `getMemoryById(id)` helper in `db.ts`.

### 2.6 Dashboard SSE leaks listeners
- **File:** `src/dashboard.ts:62-87`.
- **Problem:** `sseEvents.on('event', send)` is added on connection, but only removed inside the `controller.enqueue` catch handlers. When a browser tab closes cleanly, no event is emitted, no `catch` fires, and the listener stays forever. `sseEvents.setMaxListeners(100)` in `state.ts:82` postpones the warning; at listener 101 Node logs `MaxListenersExceededWarning` and memory creeps. Under a long-lived dashboard session with reconnects this leaks fast.
- **Fix:** use Hono's `c.req.raw.signal` / the controller's `cancel` hook to remove the listener and clear the heartbeat interval.

### 2.7 Abort signal is not wired into the streaming call
- **File:** `src/agent.ts:19-86`.
- **Problem:** `bot.ts:227` creates an `AbortController` (via `startRun`) and passes the signal to `runAgentWithRetry`, which only honours it **between retries** (`agent.ts:101`). Inside `runAgent`, the Anthropic SDK `stream: true` call is not given the signal, so a user typing `/newchat` (or another instance of the same chat starting a new run) cannot actually kill an in-flight generation. Tokens keep burning until `AGENT_TIMEOUT_MS` (15 min default). On the VPS this manifests as runaway requests chewing memory until OOM.
- **Fix:** pass `{ signal }` option on `client.messages.create({...})` and let the SDK cancel the stream.

### 2.8 Scheduler can overlap itself
- **File:** `src/scheduler.ts:17-22`.
- **Problem:** `setInterval` fires every 60 s regardless of whether the previous `checkDueTasks` is still running. If a single autonomous task takes >60 s (likely — agent calls often take minutes), the next tick re-enters `checkDueTasks` with no guard. The `getDueTasks()` filter `status='pending'` partly protects us because `runTask` sets `status='running'` before awaiting, but there is a race between the two SQL calls.
- **Fix:** convert to a self-rescheduling `setTimeout` that only re-arms after the prior invocation settles.

### 2.9 Telegram long-polling has no backoff and no webhook mode
- **File:** `src/index.ts:107` — `bot.start({...})`.
- **Problem:** long polling fights any concurrent run using the same bot token (classic `409 Conflict`). Combined with §2.2, this is exactly the "session drop" symptom you described. There is no `webhook` option, no `run(...)` concurrency flag, and no graceful handling of 409.
- **Fix:** either (a) keep long polling but add `bot.catch()` and retry-on-409 with backoff, or (b) switch to webhook via `grammy`'s `webhookCallback` on Hono (the dashboard already runs Hono on :3141; a second route at `/telegram/<secret>` is 10 lines).

### 2.10 `db.close()` never called on shutdown
- **File:** `src/index.ts:97-101`.
- **Problem:** `shutdown()` calls `bot.stop()` fire-and-forget then `process.exit(0)`. SQLite WAL is usually safe because WAL is journaled, but a hard `process.exit` during `PRAGMA wal_checkpoint` can leave a `.db-wal` of arbitrary size. You already have stale `claudeclaw.db-wal` and `-shm` files in `store/` from 16 Apr 09:21.
- **Fix:** `await bot.stop()`, then `db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();`, then exit.

### 2.11 `bot.ts:177-192` voice handler — `statusMsg` used outside its scope in the catch
- **File:** `src/bot.ts:173-193`.
- **Problem:** `const statusMsg = await ctx.reply(...)` is declared in the try block; the catch references it (`ctx.api.editMessageText(chatId, statusMsg.message_id, ...)`). If `ctx.reply` itself throws (network blip, 429), `statusMsg` is `undefined` and the catch throws `TypeError` → unhandled rejection → PM2 restart.
- **Fix:** hoist `let statusMsg: Message.TextMessage | undefined;` above the try; check `if (statusMsg)` in catch.

### 2.12 Hardcoded `'main'` agent used for consolidation loop
- **File:** `src/index.ts:78-79`.
- **Problem:** only the `main` agent gets its memories consolidated. The other four will accumulate unconsolidated memories forever. Not a crash cause, but a quiet disk-growth bug.
- **Fix:** iterate all agents from `getAllAgents()` and start one loop each (staggered, e.g. 5 min apart).

### 2.13 Queue map never shrinks
- **File:** `src/message-queue.ts:8`.
- **Problem:** `queues = new Map<chatId, []>()` — empty arrays are never deleted. Under multi-user this is negligible but worth tracking.
- **Fix:** after `processNext` completes with `queue.length === 0`, `queues.delete(chatId)`.

### 2.14 `gemini.ts` logs its own 500-char preview on every failure
- **File:** `src/gemini.ts:36` — `console.warn('[gemini] Failed to parse JSON response:', text.slice(0, 200));`
- **Problem:** under a quota-outage Gemini returns an HTML error body; each failed call logs 200 chars of HTML. Not a crash, but fills disk if the `pino` rotation isn't set (which it isn't — §7.4).

### 2.15 `FEATURE_WAR_ROOM` defaults to `true` but `warroom/` is empty
- **File:** `src/config.ts:93`, `warroom/` folder.
- **Problem:** cosmetic — nothing reads `warroom.*` in the TS sources, so a `true` flag is harmless. But it's a footgun if someone later writes code assuming War Room is real.
- **Fix:** flip default to `false` and note "Python War Room not yet shipped".

### 2.16 `ALLOWED_CHAT_ID` is declared required but bot uses `ALLOWED_CHAT_IDS`
- **File:** `src/config.ts:22` uses `getEnv` (throws if missing); `src/bot.ts:31` uses `ALLOWED_CHAT_IDS()` only.
- **Problem:** if a future user sets only `ALLOWED_CHAT_IDS` (plural) and omits the singular, `config.ts:22` won't throw because nothing imports `ALLOWED_CHAT_ID` today — but any future import will mysteriously fail. Soft bug to clean up when adding multi-user.

### 2.17 Dead/broken `npm` scripts
- **File:** `package.json:11,13`.
- **Problem:** `"status": "tsx scripts/status.ts"` and `"mission": "tsx src/mission-cli.ts"` both reference missing files. Not crash-causing, but `npm run status` fails → confusion during debugging.

### 2.18 Dead modules still in the build
- **Files:** `src/errors.ts`, `src/media.ts`, `src/message-classifier.ts` — zero importers.
- **Problem:** noise; TypeScript still compiles them. Delete.

---

## 3. Dependencies Health

### 3.1 `npm audit` — clean
```
info 0, low 0, moderate 0, high 0, critical 0
```
No action required. (225 total; 176 prod, 34 dev, 43 optional.)

### 3.2 `npm outdated` — minor cleanup

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.109 | 0.2.116 | safe patch bump — adopt. |
| `@hono/node-server` | 1.19.14 | 2.0.0 | major bump. Read changelog before upgrading. |
| `@types/node` | 24.12.2 | 25.6.0 | major — tracks Node 25; keep on 24 since you're on Node 24 runtime. |
| `cron-parser` | 4.9.0 | 5.5.0 | major — v5 replaces `parseExpression` with named `CronExpressionParser`. Breaking for `scheduler.ts:65`. |
| `pino` | 9.14.0 | 10.3.1 | major — pino 10 bumps `pino-pretty` requirement; test first. |
| `typescript` | 5.9.3 | 6.0.3 | major — defer. |
| `uuid` | 11.1.0 | 14.0.0 | major — minor API changes. |

**Action:** bump `@anthropic-ai/claude-agent-sdk` now. Defer the rest; they're not security issues.

### 3.3 Missing direct dep referenced in code
- **`@anthropic-ai/sdk`** — imported by `src/agent.ts:4`, not declared in `package.json`. See §2.4.1.

### 3.4 Installed but never imported
- None found in direct dependencies. All 10 prod deps (`@anthropic-ai/claude-agent-sdk`, `@google/genai`, `@hono/node-server`, `cron-parser`, `grammy`, `hono`, `js-yaml`, `pino`, `pino-pretty`, `uuid`) have active imports.
- Note: `@anthropic-ai/claude-agent-sdk` itself is declared but never imported — only its transitive `@anthropic-ai/sdk` is used. If you truly don't need the agent SDK's tool-use features, you can drop the declared dep and depend directly on `@anthropic-ai/sdk`, saving ~40 MB of optional `sharp` binaries.

---

## 4. Environment & Secrets

### 4.1 Every env var the code reads

| Var | Required? | Read from | Used by |
|-----|-----------|-----------|---------|
| `TELEGRAM_BOT_TOKEN` | **required** | `config.ts:21` | `bot.ts`, `media.ts` (dead) |
| `ALLOWED_CHAT_ID` | required (legacy) | `config.ts:22` | fallback only via `ALLOWED_CHAT_IDS` |
| `ALLOWED_CHAT_IDS` | optional (plural) | `config.ts:80-83` | `bot.ts:31` |
| `MULTIUSER` | optional (bool) | `config.ts:79` | declared, never consumed yet |
| `ANTHROPIC_API_KEY` | **de facto required** | `config.ts:26` | `agent.ts:9` — silent 401 if missing |
| `GOOGLE_API_KEY` | optional | `config.ts:25` | `embeddings.ts`, `gemini.ts`, `memory-ingest.ts`, `memory-consolidate.ts`, `memory.ts` |
| `GROQ_API_KEY` | optional | `config.ts:29` | `voice.ts` |
| `OPENAI_API_KEY` | optional | `config.ts:30` | `voice.ts` (STT fallback) |
| `ELEVENLABS_API_KEY` | optional | `config.ts:33` | `voice.ts` |
| `ELEVENLABS_VOICE_ID` | optional (default) | `config.ts:34` | `voice.ts` |
| `KOKORO_URL` | optional | `config.ts:35` | `voice.ts` |
| `GRADIUM_API_KEY` | optional | `config.ts:36` | `voice.ts` |
| `WARROOM_MODE` | optional | `config.ts:39` | dead (no War Room source) |
| `DEEPGRAM_API_KEY` | optional | `config.ts:40` | dead |
| `CARTESIA_API_KEY` | optional | `config.ts:41` | dead |
| `WARROOM_PORT` | optional | `config.ts:42` | dead |
| `DASHBOARD_PORT` | optional | `config.ts:45` | `dashboard.ts` |
| `DASHBOARD_TOKEN` | **de facto required** | `config.ts:46` | `dashboard.ts` — default is `"changeme"` |
| `PIN_HASH` | optional | `config.ts:49` | `security.ts` |
| `KILL_PHRASE` | optional | `config.ts:50` | `security.ts` |
| `IDLE_LOCK_MINUTES` | optional | `config.ts:51` | `security.ts` |
| `AGENT_MAX_TURNS` | optional | `config.ts:54` | declared, never consumed |
| `AGENT_TIMEOUT_MS` | optional | `config.ts:55` | `agent.ts:29` |
| `DEFAULT_AGENT_MODEL` | optional | `config.ts:56` | `agent.ts`, `agent-create.ts`, `bot.ts`, `index.ts` |
| `MEMORY_MODE` | optional | `config.ts:59` | `memory.ts` |
| `MEMORY_SIMPLE_TURNS` | optional | `config.ts:60` | declared, never consumed |
| `MEMORY_NUDGE_INTERVAL_TURNS` | optional | `config.ts:61` | `memory.ts` |
| `MEMORY_NUDGE_INTERVAL_HOURS` | optional | `config.ts:62` | `memory.ts` |
| `GEMINI_FLASH_MODEL` | optional | `config.ts:63` | `gemini.ts` |
| `GEMINI_EMBEDDING_MODEL` | optional | `config.ts:64` | `embeddings.ts` |
| `SHOW_COST_FOOTER` | optional | `config.ts:67` | `cost-footer.ts` |
| `CLAUDE_INPUT_COST_PER_M` | optional | `config.ts:68` | `cost-footer.ts` |
| `CLAUDE_OUTPUT_COST_PER_M` | optional | `config.ts:69` | `cost-footer.ts` |
| `SCHEDULER_POLL_MS` | optional | `config.ts:72` | `scheduler.ts` |
| `PIKA_API_KEY` | optional | `config.ts:75` | declared, never consumed |
| `RECALL_API_KEY` | optional | `config.ts:76` | declared, never consumed |
| `HIVE_MIND_ENABLED` | optional | `config.ts:86` | declared, never consumed |
| `FEATURE_VOICE` | optional | `config.ts:90` | `index.ts:78` |
| `FEATURE_SCHEDULER` | optional | `config.ts:91` | `index.ts:90` |
| `FEATURE_DASHBOARD` | optional | `config.ts:92` | `index.ts:73` |
| `FEATURE_WAR_ROOM` | optional | `config.ts:93` | declared, never consumed |
| `FEATURE_SECURITY` | optional | `config.ts:94` | declared, never consumed |
| `FEATURE_MULTI_AGENT` | optional | `config.ts:95` | declared, never consumed |
| `FEATURE_MEETING_BOT` | optional | `config.ts:96` | declared, never consumed |
| `CLAUDECLAW_CONFIG` | optional | `config.ts:18` | `agent-config.ts` |
| `ANTHROPIC_BASE_URL` | **missing** | — | should be new, see §2.4.2 |

### 4.2 Vars that appear in `.env.example` but the code does **not** read
- None today — but `.env.example` is missing `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ALLOWED_CHAT_IDS`, `MULTIUSER`, `HIVE_MIND_ENABLED`, `DASHBOARD_PORT`, `CLAUDECLAW_CONFIG`, `GRADIUM_API_KEY`, and all the `*_COST_PER_M` + `SCHEDULER_POLL_MS` + `GEMINI_*_MODEL` tunables.

### 4.3 Hardcoded secrets / values that must be env-driven

| Location | Problem | Fix |
|----------|---------|-----|
| `src/agent.ts:9` | `baseURL: "https://api.minimax.io/anthropic"` | move to `ANTHROPIC_BASE_URL` env with MiniMax as default |
| `src/config.ts:46` | `DASHBOARD_TOKEN` default is the string `"changeme"` — anyone can pass `?token=changeme` and read your memory DB if the env var isn't set | change default to `randomUUID()` at startup and log once, or fail hard if unset |
| `.env` (committed locally, *not* in git) | contains real `TELEGRAM_BOT_TOKEN`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `DASHBOARD_TOKEN=claudebot2026` | `.env` is gitignored — confirmed safe. **Rotate these four secrets** because they were pasted into this audit context; treat them as leaked. |

### 4.4 Complete `.env.example` (proposed)

```dotenv
# ─── Required ─────────────────────────────────────────────────────────────────

# Telegram
TELEGRAM_BOT_TOKEN=
# Primary master-bot chat ID (Ramayne). For dual-user, use ALLOWED_CHAT_IDS below.
ALLOWED_CHAT_ID=
# Optional comma-separated allowlist (replaces ALLOWED_CHAT_ID when set)
# ALLOWED_CHAT_IDS=<ramayne_id>,<cheyenne_id>

# Anthropic-compatible endpoint
ANTHROPIC_API_KEY=
# Default is MiniMax; set to https://api.anthropic.com for real Anthropic
ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic
DEFAULT_AGENT_MODEL=claude-sonnet-4-6

# Dashboard — required for any network-exposed deployment
DASHBOARD_TOKEN=CHANGE_ME_generate_with_openssl_rand_base64_32

# ─── Multi-user (Phase 2) ─────────────────────────────────────────────────────
# MULTIUSER=false
# Per-user bot tokens; each user gets their own master agent bot.
# RAMAYNE_TELEGRAM_BOT_TOKEN=
# RAMAYNE_CHAT_ID=
# CHEYENNE_TELEGRAM_BOT_TOKEN=
# CHEYENNE_CHAT_ID=

# ─── Memory (Gemini) ──────────────────────────────────────────────────────────
GOOGLE_API_KEY=
# MEMORY_MODE=full_v2         # full_v2 | simple | none
# MEMORY_SIMPLE_TURNS=20
# MEMORY_NUDGE_INTERVAL_TURNS=10
# MEMORY_NUDGE_INTERVAL_HOURS=2
# GEMINI_FLASH_MODEL=gemini-2.0-flash
# GEMINI_EMBEDDING_MODEL=text-embedding-004

# ─── Voice STT ────────────────────────────────────────────────────────────────
GROQ_API_KEY=
# OPENAI_API_KEY=

# ─── Voice TTS ────────────────────────────────────────────────────────────────
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
# KOKORO_URL=http://localhost:8880
# GRADIUM_API_KEY=

# ─── Security ─────────────────────────────────────────────────────────────────
# PIN_HASH=salt:hash    # generate via: tsx -e "import{hashPIN}from'./src/security.js';console.log(hashPIN('1234'))"
# KILL_PHRASE=
# IDLE_LOCK_MINUTES=30

# ─── Agent runtime ────────────────────────────────────────────────────────────
# AGENT_MAX_TURNS=30
# AGENT_TIMEOUT_MS=900000

# ─── Scheduler ────────────────────────────────────────────────────────────────
# SCHEDULER_POLL_MS=60000

# ─── Dashboard ────────────────────────────────────────────────────────────────
# DASHBOARD_PORT=3141

# ─── Cost footer ──────────────────────────────────────────────────────────────
# SHOW_COST_FOOTER=compact     # compact | verbose | cost | full | off
# CLAUDE_INPUT_COST_PER_M=3.0
# CLAUDE_OUTPUT_COST_PER_M=15.0

# ─── Config dir ───────────────────────────────────────────────────────────────
# CLAUDECLAW_CONFIG=%USERPROFILE%\.claudeclaw

# ─── Feature flags ────────────────────────────────────────────────────────────
FEATURE_VOICE=true
FEATURE_SCHEDULER=true
FEATURE_DASHBOARD=true
FEATURE_WAR_ROOM=false         # Python War Room not shipped yet
FEATURE_SECURITY=true
FEATURE_MULTI_AGENT=true
FEATURE_MEETING_BOT=false

HIVE_MIND_ENABLED=true
```

---

## 5. Memory Layer

### 5.1 Hive mind — implementation reality

| Question | Answer |
|----------|--------|
| Is it implemented? | Partially. Table + CRUD helpers exist. |
| Where? | `src/db.ts:100-108` (schema), `src/db.ts:355-364` (helpers), surfaced via `src/orchestrator.ts:72-79` and `/hive` command in `bot.ts:137-140`. |
| Storage? | SQLite (`store/claudeclaw.db`) — same DB as everything else. |
| Does it persist across restarts? | Yes (SQLite on disk, WAL mode). |
| Who writes to it? | Only two places: `orchestrator.ts:50` on `@all:` broadcast, `orchestrator.ts:63` on `@agentname:` delegation, and `agent.ts:117` on `runAgentAutonomous` (scheduler task). **No individual agent turn-completion logging.** |
| Who reads it? | `bot.ts:138,240` (injects into every prompt as system context), `dashboard.ts:36` (/api/hive). |

### 5.2 Gap vs. CLAUDE.md
`CLAUDE.md` promises *"When you complete significant tasks, log them to the hive mind so other agents can see"*. There is **no mechanism** for a worker agent to write a hive-mind entry from inside its own execution — no tool exposed, no post-turn hook. The only signals captured are "delegation happened" and "autonomous scheduled task ran", not "comms sent a Slack message" or "content drafted a post".

### 5.3 Per-user vs. shared
- `hive_mind` table has `agent_id` but **no `user_id` or `chat_id`**. Today that's single-user OK.
- `memories` table has `chat_id` but `getMemoriesByAgent` ignores it — any agent's memories are visible to all chats. This becomes a privacy bug the moment Cheyenne joins.

### 5.4 Other memory-layer bugs worth knowing
- **`memory.ts:72`** semantic layer is broken (see §2.5).
- **`memory.ts:143`** `adjustSalience` uses `const current = 1.0` as a placeholder — salience adjustments are never incremental, they always reset to 1 ± delta.
- **`memory-ingest.ts:47-55`** `hasDuplicate` does a full-table linear scan of embeddings on every ingestion. Fine for hundreds, painful at 10k+.

---

## 6. Multi-User Readiness (Ramayne + Cheyenne)

### 6.1 What today's code assumes
- **Single Telegram bot token.** `TELEGRAM_BOT_TOKEN` is a singleton used in `bot.ts:25` and `voice.ts` via `media.ts`.
- **Identity = `chat_id` only.** No concept of "user" separate from "chat".
- **No per-user memory scoping.** `getMemoriesByAgent` returns all memories for an agent regardless of chat.
- **Hive mind is shared** (no user_id column) — which is actually what you want, by luck.
- **Master agent = "main" (hardcoded).** `bot.ts:92-96`, `bot.ts:237,250,253,264,271,274` all pass `'main'` as `agentId`. There's no per-user dispatcher.

### 6.2 Changes needed

#### 6.2.1 User identity model
- Add `users` table: `(user_id TEXT PK, display_name, timezone, telegram_chat_id, telegram_bot_token, master_agent_id, created_at)`.
- Seed: `ramayne` + `cheyenne`.
- Every table currently keyed by `chat_id` — add a `user_id` column (derive from `chat_id → users` mapping at write time).
- **Effort:** ~1 day (schema migration + helper refactor + backfill of existing `main` chat to `ramayne`).

#### 6.2.2 Telegram routing (per-user bot)
- Replace `createBot()` singleton with `createBotsForUsers()` that reads the `users` table and spins up one `grammy.Bot` per user, each long-polling its own token (or better — each wired as a webhook route on the shared Hono server under `/telegram/<user_id>/<secret>`).
- `index.ts:86` changes from `const bot = createBot();` to `const bots = createBotsForUsers();`
- Each bot's allowlist middleware checks **only its own** chat ID — no cross-user leakage.
- Scheduler `sendToChat` callback routes to the correct bot based on task's `user_id`.
- **Effort:** ~1.5 days.

#### 6.2.3 Master agent per user
- New table rows: `agents/ramayne/CLAUDE.md`, `agents/cheyenne/CLAUDE.md` with each user's voice, priorities, product focus (Ramayne → CaseFlo + AI Business OS; Cheyenne → supervision/social-work domain).
- `users.master_agent_id` points at the right row.
- `handleTextMessage` reads `user_id` from the chat context and uses `users[user_id].master_agent_id` instead of the string `'main'`.
- `orchestrator.routeMessage` resolves the system prompt from `agents/<id>/CLAUDE.md` (which also fixes §2.4.3).
- **Effort:** ~0.5 day.

#### 6.2.4 Conversation memory scoping
- `sessions`, `messages`, `memories`, `audit_log`, `token_usage`: add `user_id` column + index.
- `getRecentMessages(user_id, agent_id, limit)` replaces `getRecentMessages(chat_id, …)` (they're equivalent today, but chat_id → user_id separates the two concerns).
- `buildMemoryContext` filters by `user_id` for personal memories.
- **Effort:** ~1 day.

#### 6.2.5 Hive mind — stays shared
- No change to `hive_mind` schema — both users' assistants write to and read from the same pool. This matches the product intent ("Ramayne's ops agent should see what Cheyenne's comms agent did today if they're coordinating on CaseFlo").
- **Optional:** add a `visibility TEXT DEFAULT 'shared'` column with values `shared | <user_id>` so an agent can log something private if needed. Easy to add later; not required now.
- **Effort:** ~0 (no change), ~0.5 day if you want visibility scoping.

#### 6.2.6 Worker agents — shared, identity-aware
- `@comms`, `@content`, `@ops`, `@research` remain single-instance.
- Each call now receives `user_id` as additional context so the worker knows whose task it is ("Ramayne asked you to draft this email" vs. "Cheyenne asked…").
- Pass `user_id` into the system prompt alongside the agent's own CLAUDE.md.
- **Effort:** ~0.25 day.

### 6.3 Effort summary
| Item | Estimate |
|------|----------|
| 6.2.1 User identity model + migration | 1 day |
| 6.2.2 Per-user Telegram routing | 1.5 days |
| 6.2.3 Master agent per user | 0.5 day |
| 6.2.4 Memory scoping | 1 day |
| 6.2.5 Hive-mind (no change) | 0 |
| 6.2.6 Worker identity-awareness | 0.25 day |
| **Total** | **~4.25 engineer-days** |

---

## 7. Reliability Fix Plan (Windows 11 + PM2)

### 7.1 `ecosystem.config.cjs` (new file at repo root)
```js
module.exports = {
  apps: [{
    name: 'claudeclaw-os',
    script: 'dist/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    min_uptime: '30s',
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 2000,
    kill_timeout: 10000,
    wait_ready: true,
    listen_timeout: 15000,
    env: { NODE_ENV: 'production' },
    error_file: 'store/logs/err.log',
    out_file:   'store/logs/out.log',
    merge_logs: true,
    time: true
  }]
};
```
Pair with `process.send?.('ready')` after the bot starts in `index.ts` (so `wait_ready` works).

### 7.2 Windows service registration (survives reboots)
Two options; pick one:
- **Preferred:** `pm2-installer` (<https://github.com/jessety/pm2-installer>) — registers PM2 itself as a Windows service via NSSM and runs `pm2 resurrect` on boot. One-time install.
- **Alternative:** `pm2-windows-service` npm package — older and less maintained.

After install:
```
pm2 start ecosystem.config.cjs
pm2 save
```
`pm2 save` writes the dump file that the service replays on boot.

### 7.3 Health-check endpoint + external monitor
Add to `src/dashboard.ts`:
```ts
app.get('/api/health', c => c.json({
  ok: true,
  uptime: process.uptime(),
  db_ok: safeDbPing(),
  memory_mb: process.memoryUsage().rss / 1024 / 1024
}));
```
Make this route exempt from the token middleware (pure GET, no data leaked beyond uptime). Then either:
- Register a Windows Task Scheduler job that curls `http://localhost:3141/api/health` every 2 min and runs `pm2 restart claudeclaw-os` on 3 consecutive failures, or
- Install `pm2-health` plugin (`pm2 install pm2-health`) pointed at that URL.

### 7.4 Log rotation
Install PM2's rotation module once:
```
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```
No code change needed.

### 7.5 Graceful shutdown (edit `src/index.ts:97-103`)
```ts
const shutdown = async (signal: string) => {
  log.info({ signal }, 'Shutting down gracefully');
  try { await bot.stop(); } catch {}
  try { stopScheduler(); } catch {}
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', e => log.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException',  e => { log.error({ err: e }, 'uncaughtException'); /* do NOT exit — PM2 would restart anyway; let it linger for crash dump */ });
```
Also remove `killExistingInstance()` (§2.2) and replace with fail-fast:
```ts
if (existsSync(PID_FILE)) {
  const pid = parseInt(readFileSync(PID_FILE, 'utf8'));
  try { process.kill(pid, 0); log.error({ pid }, 'Another instance is running'); process.exit(1); } catch {}
}
```

### 7.6 Telegram 409 backoff
In `src/bot.ts` (or a new `bot-runtime.ts`):
```ts
bot.catch(err => {
  log.error({ err }, 'bot error — will be retried by grammy');
});
```
Grammy 1.31 already retries on 409 by default; just make sure the error is logged, not swallowed.

---

## 8. The Change List (prioritised)

Effort column is a rough Opus 4.7 estimate for a focused engineer, not calendar time.

### P0 — make it stop crashing (reliability)

| # | Path | Change | Why | Effort |
|---|------|--------|-----|--------|
| 1 | `package.json` | Add `"@anthropic-ai/sdk": "^0.81.0"` to `dependencies`. | §2.4.1 — prevents sudden ImportError when transitive dep is pruned. | 5 min |
| 2 | `src/agent.ts:9` | Replace hardcoded baseURL with `getEnvOptional('ANTHROPIC_BASE_URL', 'https://api.minimax.io/anthropic')`; throw in `main()` if `ANTHROPIC_API_KEY` is empty. | §2.4.2 — avoids silent 401 and lets you flip to real Anthropic without a rebuild. | 20 min |
| 3 | `src/index.ts` | Remove `killExistingInstance()`; replace with "fail fast if PID is alive" (§7.5). Add `unhandledRejection` / `uncaughtException` handlers (§2.3). Add `await bot.stop()` + `db.close()` in `shutdown`. | §2.2 + §2.3 + §2.10 — removes the main crash-loop triggers. | 45 min |
| 4 | `ecosystem.config.cjs` (new) | Create with autorestart, max_memory_restart, exponential backoff, log paths. | §7.1 — lets PM2 actually manage the process. | 15 min |
| 5 | Windows service | Install `pm2-installer`; `pm2 save`; verify reboot persistence. | §7.2 — survives Windows restarts. | 30 min |
| 6 | `src/dashboard.ts` | Add `/api/health` endpoint (token-exempt). Fix SSE listener leak (remove on stream cancel). | §2.6 + §7.3 — enables external monitoring; plugs memory leak. | 1 h |
| 7 | PM2 modules | `pm2 install pm2-logrotate` + config. | §7.4 — disk doesn't fill. | 15 min |
| 8 | `src/bot.ts:173-193` | Hoist `statusMsg` above the try; guard in catch. Add `bot.catch(…)`. | §2.11 + §7.6 — stop voice-handler crashes and 409 spam. | 30 min |
| 9 | `src/agent.ts` | Pass `{ signal }` into `client.messages.create`. | §2.7 — abort actually works, no runaway streams. | 30 min |
| 10 | `src/scheduler.ts` | Switch `setInterval` to self-rescheduling `setTimeout`. | §2.8 — no overlapping ticks. | 20 min |
| 11 | `.gitignore` + `.playwright-cli/` | Add `.playwright-cli/` to `.gitignore`; `git rm -r --cached .playwright-cli`. | §1.1 — removes 30+ stale committed debug dumps. | 5 min |
| 12 | `package.json` scripts | Remove broken `status` and `mission` script entries (or create stubs). | §2.17 — stop surprising anyone running `npm run status`. | 5 min |
| 13 | `.env.example` | Replace with full version in §4.4. | §4.1 — no more "what env var is that?" moments. | 15 min |
| 14 | Secret rotation | Rotate `TELEGRAM_BOT_TOKEN`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `DASHBOARD_TOKEN`. | §4.3 — those values ended up in this audit context; assume leaked. | 20 min |

**P0 total: ~5.5 hours.**

### P1 — dual-master-agent architecture (Ramayne + Cheyenne)

| # | Path | Change | Why | Effort |
|---|------|--------|-----|--------|
| 15 | `src/db.ts` | Add `users` table; add `user_id` column + index to `sessions`, `messages`, `memories`, `scheduled_tasks`, `audit_log`, `token_usage`. Migration that maps existing `chat_id` → `user_id='ramayne'`. | §6.2.1 | 4 h |
| 16 | `agents/ramayne/CLAUDE.md`, `agents/cheyenne/CLAUDE.md` | New master-agent prompts. Ramayne: CaseFlo + AI Business OS focus. Cheyenne: IFA/supervision domain. | §6.2.3 | 1 h |
| 17 | `agent.yaml` | Add `ramayne` and `cheyenne` agent entries (type: master); retain `comms/content/ops/research` as workers. | §6.2.3 | 15 min |
| 18 | `src/bot.ts` | Convert `createBot()` → `createBotsForUsers()` reading from `users` table. Each user gets own Bot instance with own token and own allowlist. | §6.2.2 | 1.5 days |
| 19 | `src/index.ts` | Boot all bots; pass bot lookup into scheduler callback. | §6.2.2 | 1 h |
| 20 | `src/orchestrator.ts` + `src/agent.ts` | Load `resolveAgentClaudeMd(agentId)` as system prompt; pass `user_id` in context. | §6.2.3 + §2.4.3 | 2 h |
| 21 | `src/memory.ts` + `src/db.ts` | Scope `getMemoriesByAgent`, `searchMemoriesFTS`, etc. by `user_id`. Hive mind unchanged. | §6.2.4 | 3 h |
| 22 | `src/agent.ts` | Replay last N turns from `messages` table into the Anthropic request. | §2.4.4 | 1 h |
| 23 | `src/memory.ts:72` | Replace broken `searchConversationHistory(id, …)` with new `getMemoryById(id)` helper. | §2.5 | 30 min |
| 24 | `src/index.ts` | Consolidation loop iterates all master + worker agents (staggered). | §2.12 | 30 min |
| 25 | `CLAUDE.md` | Rewrite: "Wendy" → Ramayne/Cheyenne, describe dual-master layout, list worker agents as shared. | §1.1 | 30 min |

**P1 total: ~4.25 engineer-days.**

### P2 — cleanups, nice-to-haves

| # | Path | Change | Why | Effort |
|---|------|--------|-----|--------|
| 26 | `src/errors.ts`, `src/media.ts`, `src/message-classifier.ts` | Delete. | §2.18 | 5 min |
| 27 | `warroom/` (empty) | Delete. Set `FEATURE_WAR_ROOM` default to `false` in `config.ts:93`. | §2.15 | 10 min |
| 28 | `src/agent.ts:72` | Remove the `newSessionId = fullText.slice(0, 100)` fabrication; either drop the `sessions` table entirely or use a real UUID per conversation thread. | §2.4.5 | 30 min |
| 29 | `src/memory.ts:143` | Fix `adjustSalience` to read current value, not hardcode `1.0`. | §5.4 | 20 min |
| 30 | `src/memory-ingest.ts:47` | Index embeddings (store norm + cluster) or switch to a vector column (sqlite-vss / libsql). | §5.4 | 4 h |
| 31 | `src/message-queue.ts:35` | `queues.delete(chatId)` when empty. | §2.13 | 5 min |
| 32 | `src/gemini.ts:36` | Truncate error log or switch to `log.debug`. | §2.14 | 5 min |
| 33 | Hive-mind hook for workers | Add a `logHiveMind` call at the tail of `orchestrator.routeMessage` for every non-broadcast delegation that succeeds, so CLAUDE.md's promise is kept. | §5.2 | 30 min |
| 34 | `src/dashboard.ts` | Add per-user filters once §6.2 is in. | §6.2 | 2 h |
| 35 | `@anthropic-ai/claude-agent-sdk` | Either actually use it (tool-use, MCP) or drop in favour of direct `@anthropic-ai/sdk`. | §3.4 | 1–2 days depending on direction |
| 36 | `cron-parser` upgrade to v5 | Breaking change to `parseExpression` → `CronExpressionParser.parse`. | §3.2 | 30 min |
| 37 | Telegram webhook mode | Mount `bot.webhookCallback` on existing Hono server under `/telegram/<user>/<secret>` to replace long-polling. | §2.9 — sturdier under mobile network flaps. | 3 h |
| 38 | `src/security.ts:91-95` | `startIdleLockSweep` is a no-op today — either wire it to iterate all locked chats or delete it. | §1.1 | 15 min |

**P2 total: ~2–3 engineer-days depending on which items you pick up.**

---

## Appendix A — Audit methodology

- Read: `CLAUDE.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `.env`, `agent.yaml`, `start.bat`, `.gitignore`, all 21 `src/*.ts` files, `scripts/setup.ts`, all 6 `agents/*/CLAUDE.md` files, `agents/_template/config.yml`.
- Ran: `npm audit --json`, `npm outdated`, `git log --oneline`, `git status`, `git ls-files`.
- Grepped for: `process.env`, `getEnv`, `setInterval`, `setTimeout`, `uncaughtException`, `unhandledRejection`, `ANTHROPIC_BASE_URL`, `@anthropic-ai/`, `logHiveMind`, `hive_mind`, PM2/ecosystem references.
- Cross-checked imports to find dead modules.
- Did not run the bot or the dashboard.

## Appendix B — One-page TL;DR

The system's architecture is sound — multi-agent router, SQLite memory with FTS + embeddings, cron scheduler, dashboard, security layer. The crashes are not architectural; they're a handful of small errors compounding:

1. **No PM2 ecosystem file** → no restart policy.
2. **`killExistingInstance()` fights PM2** → restart storm.
3. **No `unhandledRejection` handler** → one bad promise kills the process.
4. **Missing direct dep `@anthropic-ai/sdk`** → one `npm ci` away from fatal ImportError.
5. **Hardcoded MiniMax URL + silent 401 on missing `ANTHROPIC_API_KEY`** → no fallback path.
6. **Abort signal not wired into the stream** → user can't cancel runaway requests.
7. **Per-agent CLAUDE.md never passed to the model** → five agents that are actually one.

Fix those seven (≤ 6 hours of work) and the shutdowns stop. Then spend ~4 engineer-days layering in the dual-master-agent model for Ramayne + Cheyenne.
