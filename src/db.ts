/**
 * db.ts — SQLite database layer using Node.js built-in sqlite module
 * WAL mode, all queries synchronous, single connection shared across app.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { DB_PATH } from './config.js';
import { randomUUID } from 'crypto';

// Ensure store directory exists
if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);
db.exec(`PRAGMA synchronous = NORMAL`);

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  chat_id    TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, agent_id)
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT,
  agent_id      TEXT NOT NULL,
  summary       TEXT NOT NULL,
  raw_text      TEXT,
  entities      TEXT DEFAULT '[]',
  topics        TEXT DEFAULT '[]',
  importance    REAL NOT NULL DEFAULT 0.5,
  salience      REAL NOT NULL DEFAULT 1.0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  superseded_by TEXT REFERENCES memories(id),
  consolidated  INTEGER NOT NULL DEFAULT 0,
  embedding     TEXT,
  session_id    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS consolidations (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  insights    TEXT NOT NULL,
  patterns    TEXT DEFAULT '[]',
  contradictions TEXT DEFAULT '[]',
  memory_ids  TEXT DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// FTS5 virtual table for full-text search (restricted to content columns only)
db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  summary,
  raw_text,
  content='memories',
  content_rowid='rowid'
)`);

// FTS5 triggers — restricted to content columns to prevent write amplification during decay sweeps
db.exec(`
CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, summary, raw_text) VALUES (new.rowid, new.summary, new.raw_text);
END`);

db.exec(`
CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text) VALUES ('delete', old.rowid, old.summary, old.raw_text);
END`);

db.exec(`
CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF summary, raw_text ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text) VALUES ('delete', old.rowid, old.summary, old.raw_text);
  INSERT INTO memories_fts(rowid, summary, raw_text) VALUES (new.rowid, new.summary, new.raw_text);
END`);

db.exec(`
CREATE TABLE IF NOT EXISTS hive_mind (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  action_type TEXT NOT NULL,
  summary     TEXT NOT NULL,
  metadata    TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  cron        TEXT NOT NULL,
  agent_id    TEXT NOT NULL DEFAULT 'main',
  chat_id     TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 3,
  status      TEXT NOT NULL DEFAULT 'pending',
  next_run    TEXT,
  last_run    TEXT,
  last_error  TEXT,
  run_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  chat_id    TEXT,
  agent_id   TEXT,
  summary    TEXT NOT NULL,
  metadata   TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  bot_token   TEXT,
  model       TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  working_dir TEXT NOT NULL,
  claude_md   TEXT,
  mcp_servers TEXT DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS token_usage (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  chat_id      TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// ─── Session helpers ──────────────────────────────────────────────────────────

export function getSession(chatId: string, agentId: string): string | null {
  const row = db.prepare('SELECT session_id FROM sessions WHERE chat_id = ? AND agent_id = ?').get(chatId, agentId) as any;
  return row?.session_id ?? null;
}

export function setSession(chatId: string, agentId: string, sessionId: string): void {
  db.prepare(`
    INSERT INTO sessions (chat_id, agent_id, session_id, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id, agent_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
  `).run(chatId, agentId, sessionId);
}

export function clearSession(chatId: string, agentId: string): void {
  db.prepare('DELETE FROM sessions WHERE chat_id = ? AND agent_id = ?').run(chatId, agentId);
}

// ─── Message history helpers ──────────────────────────────────────────────────

export function saveMessage(chatId: string, agentId: string, role: string, content: string): void {
  db.prepare('INSERT INTO messages (id, chat_id, agent_id, role, content) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), chatId, agentId, role, content);
}

export function getRecentMessages(chatId: string, agentId: string, limit = 20): Array<{ role: string; content: string }> {
  return (db.prepare(`
    SELECT role, content FROM messages
    WHERE chat_id = ? AND agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(chatId, agentId, limit) as any[]).reverse();
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  chat_id?: string;
  agent_id: string;
  summary: string;
  raw_text?: string;
  entities: string[];
  topics: string[];
  importance: number;
  salience: number;
  pinned: boolean;
  superseded_by?: string;
  consolidated: boolean;
  embedding?: string;
  session_id?: string;
  created_at: string;
  last_accessed: string;
}

function parseMemory(row: any): Memory {
  return {
    ...row,
    entities: JSON.parse(row.entities || '[]'),
    topics: JSON.parse(row.topics || '[]'),
    pinned: row.pinned === 1,
    consolidated: row.consolidated === 1,
  };
}

export function insertMemory(mem: Omit<Memory, 'id' | 'created_at' | 'last_accessed'>): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO memories (id, chat_id, agent_id, summary, raw_text, entities, topics, importance, salience, pinned, embedding, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    mem.chat_id ?? null,
    mem.agent_id,
    mem.summary,
    mem.raw_text ?? null,
    JSON.stringify(mem.entities),
    JSON.stringify(mem.topics),
    mem.importance,
    mem.salience,
    mem.pinned ? 1 : 0,
    mem.embedding ?? null,
    mem.session_id ?? null,
  );
  return id;
}

export function getMemoriesByAgent(agentId: string, limit = 200): Memory[] {
  return (db.prepare(`
    SELECT * FROM memories WHERE agent_id = ? AND superseded_by IS NULL ORDER BY salience DESC, importance DESC LIMIT ?
  `).all(agentId, limit) as any[]).map(parseMemory);
}

export function getUnconsolidatedMemories(agentId: string, limit = 20): Memory[] {
  return (db.prepare(`
    SELECT * FROM memories WHERE agent_id = ? AND consolidated = 0 ORDER BY created_at ASC LIMIT ?
  `).all(agentId, limit) as any[]).map(parseMemory);
}

export function markMemoriesConsolidated(ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE memories SET consolidated = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function insertConsolidation(result: { agent_id: string; insights: string; patterns: string[]; contradictions: Array<{ old_memory_id: string; new_memory_id: string; resolution: string }>; memory_ids: string[] }): void {
  db.prepare(`
    INSERT INTO consolidations (id, agent_id, insights, patterns, contradictions, memory_ids)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), result.agent_id, result.insights, JSON.stringify(result.patterns), JSON.stringify(result.contradictions), JSON.stringify(result.memory_ids));
}

export function getLatestConsolidations(agentId: string, limit = 3): Array<{ insights: string; patterns: string[]; created_at: string }> {
  return (db.prepare(`
    SELECT insights, patterns, created_at FROM consolidations WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(agentId, limit) as any[]).map(row => ({
    insights: row.insights,
    patterns: JSON.parse(row.patterns || '[]'),
    created_at: row.created_at,
  }));
}

export function searchMemoriesFTS(query: string, limit = 5): Memory[] {
  try {
    return (db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(query, limit) as any[]).map(parseMemory);
  } catch {
    return [];
  }
}

export function getAllEmbeddings(agentId: string): Array<{ id: string; embedding: string }> {
  return (db.prepare(`
    SELECT id, embedding FROM memories WHERE agent_id = ? AND embedding IS NOT NULL AND superseded_by IS NULL
  `).all(agentId) as any[]);
}

export function updateSalience(id: string, newValue: number): void {
  db.prepare('UPDATE memories SET salience = ? WHERE id = ?').run(Math.min(5.0, Math.max(0.05, newValue)), id);
}

export function touchMemory(id: string): void {
  db.prepare("UPDATE memories SET last_accessed = datetime('now') WHERE id = ?").run(id);
}

export function pinMemory(id: string): void {
  db.prepare('UPDATE memories SET pinned = 1 WHERE id = ?').run(id);
}

export function unpinMemory(id: string): void {
  db.prepare('UPDATE memories SET pinned = 0 WHERE id = ?').run(id);
}

export function setSupersededBy(oldId: string, newId: string): void {
  db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(newId, oldId);
}

export function searchConversationHistory(keywords: string, agentId: string, dayWindow = 7, limit = 10): Memory[] {
  const since = new Date(Date.now() - dayWindow * 24 * 60 * 60 * 1000).toISOString();
  return (db.prepare(`
    SELECT * FROM memories
    WHERE agent_id = ? AND created_at >= ? AND (summary LIKE ? OR raw_text LIKE ?)
    ORDER BY created_at DESC LIMIT ?
  `).all(agentId, since, `%${keywords}%`, `%${keywords}%`, limit) as any[]).map(parseMemory);
}

export function getRecentHighImportanceMemories(agentId: string, limit = 5): Memory[] {
  return (db.prepare(`
    SELECT * FROM memories
    WHERE agent_id = ? AND importance >= 0.7 AND superseded_by IS NULL
    ORDER BY created_at DESC LIMIT ?
  `).all(agentId, limit) as any[]).map(parseMemory);
}

export function runSalienceDecay(): void {
  // Pinned memories: no decay
  // importance >= 0.8: salience *= 0.99
  db.exec(`UPDATE memories SET salience = salience * 0.99 WHERE pinned = 0 AND importance >= 0.8 AND salience > 0.05`);
  // importance >= 0.5: salience *= 0.98
  db.exec(`UPDATE memories SET salience = salience * 0.98 WHERE pinned = 0 AND importance >= 0.5 AND importance < 0.8 AND salience > 0.05`);
  // importance < 0.5: salience *= 0.95
  db.exec(`UPDATE memories SET salience = salience * 0.95 WHERE pinned = 0 AND importance < 0.5 AND salience > 0.05`);
  // Hard delete below threshold
  db.exec(`DELETE FROM memories WHERE pinned = 0 AND salience < 0.05`);
}

// ─── Hive mind helpers ────────────────────────────────────────────────────────

export function logHiveMind(agentId: string, actionType: string, summary: string, metadata: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO hive_mind (id, agent_id, action_type, summary, metadata) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), agentId, actionType, summary, JSON.stringify(metadata));
}

export function getHiveMind(limit = 50): Array<{ agent_id: string; action_type: string; summary: string; metadata: Record<string, unknown>; created_at: string }> {
  return (db.prepare('SELECT * FROM hive_mind ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map(row => ({
    ...row,
    metadata: JSON.parse(row.metadata || '{}'),
  }));
}

// ─── Scheduled tasks helpers ──────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  agent_id: string;
  chat_id: string;
  priority: number;
  status: string;
  next_run?: string;
  last_run?: string;
  last_error?: string;
  run_count: number;
  created_at: string;
}

export function createTask(task: Omit<ScheduledTask, 'id' | 'run_count' | 'created_at'>): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO scheduled_tasks (id, name, prompt, cron, agent_id, chat_id, priority, status, next_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, task.name, task.prompt, task.cron, task.agent_id, task.chat_id, task.priority, task.status, task.next_run ?? null);
  return id;
}

export function getDueTasks(): ScheduledTask[] {
  return db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE status = 'pending' AND next_run <= datetime('now')
    ORDER BY priority ASC, next_run ASC
  `).all() as unknown as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db.prepare('SELECT * FROM scheduled_tasks ORDER BY priority ASC, created_at DESC').all() as unknown as ScheduledTask[];
}

export function updateTaskRun(id: string, nextRun: string | null, error?: string): void {
  if (error) {
    db.prepare(`UPDATE scheduled_tasks SET last_run = datetime('now'), last_error = ?, status = 'pending', run_count = run_count + 1, next_run = ? WHERE id = ?`).run(error, nextRun, id);
  } else {
    db.prepare(`UPDATE scheduled_tasks SET last_run = datetime('now'), last_error = NULL, status = 'pending', run_count = run_count + 1, next_run = ? WHERE id = ?`).run(nextRun, id);
  }
}

export function setTaskStatus(id: string, status: string): void {
  db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(status, id);
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

// ─── Audit log helpers ────────────────────────────────────────────────────────

export function logAudit(eventType: string, summary: string, chatId?: string, agentId?: string, metadata: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO audit_log (id, event_type, chat_id, agent_id, summary, metadata) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), eventType, chatId ?? null, agentId ?? null, summary, JSON.stringify(metadata));
}

export function getAuditLog(limit = 100): Array<{ event_type: string; summary: string; created_at: string }> {
  return db.prepare('SELECT event_type, summary, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

// ─── Agent registry helpers ───────────────────────────────────────────────────

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  bot_token?: string;
  model: string;
  working_dir: string;
  claude_md?: string;
  mcp_servers: string[];
  status: string;
  created_at: string;
}

function parseAgent(row: any): AgentRecord {
  return { ...row, mcp_servers: JSON.parse(row.mcp_servers || '[]') };
}

export function upsertAgent(agent: Omit<AgentRecord, 'created_at'>): void {
  db.prepare(`
    INSERT INTO agents (id, name, description, bot_token, model, working_dir, claude_md, mcp_servers, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      bot_token = excluded.bot_token,
      model = excluded.model,
      working_dir = excluded.working_dir,
      claude_md = excluded.claude_md,
      mcp_servers = excluded.mcp_servers,
      status = excluded.status
  `).run(agent.id, agent.name, agent.description, agent.bot_token ?? null, agent.model, agent.working_dir, agent.claude_md ?? null, JSON.stringify(agent.mcp_servers), agent.status);
}

export function getAllAgents(): AgentRecord[] {
  return (db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as any[]).map(parseAgent);
}

export function getAgent(id: string): AgentRecord | null {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
  return row ? parseAgent(row) : null;
}

export function setAgentStatus(id: string, status: string): void {
  db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id);
}

// ─── Token usage helpers ──────────────────────────────────────────────────────

export function logTokenUsage(agentId: string, chatId: string, inputTokens: number, outputTokens: number, model: string): void {
  db.prepare('INSERT INTO token_usage (id, agent_id, chat_id, input_tokens, output_tokens, model) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), agentId, chatId, inputTokens, outputTokens, model);
}

export function getTokenUsage(agentId?: string): Array<{ agent_id: string; input_tokens: number; output_tokens: number; created_at: string }> {
  if (agentId) {
    return db.prepare('SELECT agent_id, input_tokens, output_tokens, created_at FROM token_usage WHERE agent_id = ? ORDER BY created_at DESC LIMIT 500').all(agentId) as any[];
  }
  return db.prepare('SELECT agent_id, input_tokens, output_tokens, created_at FROM token_usage ORDER BY created_at DESC LIMIT 500').all() as any[];
}

export { db };
