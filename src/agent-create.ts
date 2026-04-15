/**
 * agent-create.ts — agent creation and lifecycle management
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { upsertAgent, setAgentStatus, getAllAgents } from './db.js';
import { AGENTS_DIR, ROOT_DIR, DEFAULT_AGENT_MODEL } from './config.js';
import { invalidateAgentConfigCache } from './agent-config.js';

export interface NewAgentOptions {
  id: string;
  name: string;
  description: string;
  model?: string;
  botToken?: string;
}

const ID_RE = /^[a-z][a-z0-9_-]{0,29}$/;

export function validateAgentId(id: string): string | null {
  if (!ID_RE.test(id)) return `Agent ID must match /^[a-z][a-z0-9_-]{0,29}$/`;
  const existing = getAllAgents();
  if (existing.some(a => a.id === id)) return `Agent with id '${id}' already exists`;
  return null;
}

export function createAgent(opts: NewAgentOptions): void {
  const error = validateAgentId(opts.id);
  if (error) throw new Error(error);

  const agentDir = resolve(AGENTS_DIR, opts.id);
  mkdirSync(agentDir, { recursive: true });

  // Write CLAUDE.md
  const claudeMd = `# ${opts.name} Agent\n\n## Role\n${opts.description}\n\n## Instructions\n- Be concise and actionable\n- UK English spelling\n- Log significant actions to the hive mind\n`;
  writeFileSync(resolve(agentDir, 'CLAUDE.md'), claudeMd, 'utf8');

  // Write config.yml
  const configYml = yaml.dump({
    id: opts.id,
    name: opts.name,
    description: opts.description,
    model: opts.model ?? DEFAULT_AGENT_MODEL,
    mcp_servers: [],
  });
  writeFileSync(resolve(agentDir, 'config.yml'), configYml, 'utf8');

  // Update agent.yaml at root
  updateAgentYaml(opts);

  // Register in DB
  upsertAgent({
    id: opts.id,
    name: opts.name,
    description: opts.description,
    bot_token: opts.botToken,
    model: opts.model ?? DEFAULT_AGENT_MODEL,
    working_dir: agentDir,
    claude_md: resolve(agentDir, 'CLAUDE.md'),
    mcp_servers: [],
    status: 'active',
  });

  invalidateAgentConfigCache();
}

function updateAgentYaml(opts: NewAgentOptions): void {
  const yamlPath = resolve(ROOT_DIR, 'agent.yaml');
  let existing: { agents: any[] } = { agents: [] };

  if (existsSync(yamlPath)) {
    try {
      existing = yaml.load(readFileSync(yamlPath, 'utf8')) as any;
    } catch { /* start fresh */ }
  }

  existing.agents = existing.agents.filter((a: any) => a.id !== opts.id);
  existing.agents.push({
    id: opts.id,
    name: opts.name,
    description: opts.description,
    model: opts.model ?? DEFAULT_AGENT_MODEL,
    ...(opts.botToken ? { bot_token: opts.botToken } : {}),
  });

  writeFileSync(yamlPath, yaml.dump(existing), 'utf8');
}

export function activateAgent(id: string): void {
  setAgentStatus(id, 'active');
  invalidateAgentConfigCache();
}

export function deactivateAgent(id: string): void {
  setAgentStatus(id, 'inactive');
  invalidateAgentConfigCache();
}

export function listAgents(): string {
  const agents = getAllAgents();
  if (agents.length === 0) return 'No agents registered yet.';
  return agents
    .map(a => `• **${a.name}** (@${a.id}) — ${a.status}\n  ${a.description}`)
    .join('\n\n');
}
