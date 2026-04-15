/**
 * agent-config.ts — agent.yaml loader, path resolution for each agent
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { AGENTS_DIR, CLAUDECLAW_CONFIG, ROOT_DIR } from './config.js';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  bot_token?: string;
  mcp_servers?: string[];
  working_dir?: string;
  claude_md?: string;
}

export interface AgentYaml {
  agents: AgentConfig[];
}

let _configCache: AgentYaml | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

export function loadAgentConfig(): AgentYaml {
  const now = Date.now();
  if (_configCache && now - _cacheTime < CACHE_TTL) return _configCache;

  // Look for agent.yaml in CLAUDECLAW_CONFIG first, then project root
  const candidates = [
    resolve(CLAUDECLAW_CONFIG, 'agent.yaml'),
    resolve(ROOT_DIR, 'agent.yaml'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf8');
        _configCache = yaml.load(content) as AgentYaml;
        _cacheTime = now;
        return _configCache;
      } catch (err) {
        console.warn(`[agent-config] Failed to parse ${path}:`, err);
      }
    }
  }

  // Default config — 5 pre-built templates
  _configCache = {
    agents: [
      { id: 'main', name: 'Main', description: 'General-purpose assistant. Handles anything that does not clearly belong to a specialist.', model: 'claude-sonnet-4-6' },
      { id: 'comms', name: 'Comms', description: 'Handles email, Slack, LinkedIn, and all communication channels. Knows your contacts, your tone, your follow-up patterns.', model: 'claude-sonnet-4-6' },
      { id: 'content', name: 'Content', description: 'Writes, edits, and publishes. Blog posts, social media, documentation, video scripts. Understands your voice and brand.', model: 'claude-sonnet-4-6' },
      { id: 'ops', name: 'Ops', description: 'System administration, deployments, infrastructure, file management, backups. Keeps things running.', model: 'claude-sonnet-4-6' },
      { id: 'research', name: 'Research', description: 'Deep dives, competitive analysis, market research, technical investigation. Takes longer but goes deeper.', model: 'claude-sonnet-4-6' },
    ],
  };
  _cacheTime = now;
  return _configCache;
}

export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return loadAgentConfig().agents.find(a => a.id === agentId);
}

export function resolveAgentDir(agentId: string): string {
  const config = getAgentConfig(agentId);
  if (config?.working_dir) return resolve(CLAUDECLAW_CONFIG, config.working_dir);
  return resolve(AGENTS_DIR, agentId);
}

export function resolveAgentClaudeMd(agentId: string): string | undefined {
  const config = getAgentConfig(agentId);

  // 1. Explicit claude_md in config
  if (config?.claude_md) return resolve(CLAUDECLAW_CONFIG, config.claude_md);

  // 2. CLAUDE.md inside agent's working dir
  const agentDir = resolveAgentDir(agentId);
  const localMd = resolve(agentDir, 'CLAUDE.md');
  if (existsSync(localMd)) return localMd;

  // 3. Shared CLAUDE.md in project root
  const rootMd = resolve(ROOT_DIR, 'CLAUDE.md');
  if (existsSync(rootMd)) return rootMd;

  return undefined;
}

export function invalidateAgentConfigCache(): void {
  _configCache = null;
  _cacheTime = 0;
}
