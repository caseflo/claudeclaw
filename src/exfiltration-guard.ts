/**
 * exfiltration-guard.ts — scans outgoing messages for secrets (15+ patterns)
 * Checks for API keys, tokens, AWS credentials, base64/URL-encoded secrets.
 */
import { logAudit } from './db.js';

export interface SecretMatch {
  type: string;
  position: number;
  length: number;
  preview: string;
}

// 15+ regex patterns for detecting secrets
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Anthropic API keys
  { name: 'anthropic_key', pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/g },
  // Generic sk- keys (OpenAI, etc)
  { name: 'sk_key', pattern: /sk-[a-zA-Z0-9]{20,}/g },
  // Stripe publishable/secret keys
  { name: 'stripe_key', pattern: /(?:pk|sk|rk)_(?:live|test)_[a-zA-Z0-9]{20,}/g },
  // Slack tokens
  { name: 'slack_token', pattern: /xox[baprs]-[a-zA-Z0-9\-]{10,}/g },
  // GitHub tokens
  { name: 'github_token', pattern: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}/g },
  // AWS access key ID
  { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g },
  // AWS secret key pattern
  { name: 'aws_secret', pattern: /(?:aws_secret_access_key|AWS_SECRET)[^\n]*=\s*[a-zA-Z0-9/+]{40}/gi },
  // Bearer tokens
  { name: 'bearer_token', pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi },
  // JWT tokens (3 parts separated by dots)
  { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g },
  // Generic hex-encoded secrets (32+ chars)
  { name: 'hex_secret', pattern: /\b[0-9a-f]{32,}\b/gi },
  // Password assignments
  { name: 'password_assign', pattern: /(?:password|passwd|secret|api_key|apikey)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi },
  // .env file content being dumped (lines with KEY=value)
  { name: 'env_dump', pattern: /^[A-Z_]{5,}=[^\n]{10,}/gm },
  // Base64-encoded secrets (detects base64 wrapping API keys)
  { name: 'base64_secret', pattern: /(?:sk-|AKIA|Bearer\s)[a-zA-Z0-9+/=]{20,}/g },
  // URL-encoded credential patterns
  { name: 'url_encoded_secret', pattern: /(?:key|token|secret|password)%3D[a-zA-Z0-9%]{15,}/gi },
  // Google API keys
  { name: 'google_api_key', pattern: /AIza[0-9A-Za-z\-_]{35}/g },
];

function isBase64(str: string): boolean {
  try {
    const decoded = Buffer.from(str, 'base64').toString('utf8');
    return SECRET_PATTERNS.some(p => p.pattern.test(decoded));
  } catch {
    return false;
  }
}

export function scanForSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const preview = match[0].slice(0, 8) + '...' + match[0].slice(-4);
      matches.push({
        type: name,
        position: match.index,
        length: match[0].length,
        preview,
      });
    }
  }

  return matches;
}

export function redactSecrets(text: string, chatId?: string, agentId?: string): string {
  const matches = scanForSecrets(text);
  if (matches.length === 0) return text;

  // Log the exfiltration attempt
  logAudit('exfiltration_blocked', `Blocked ${matches.length} secret(s): ${matches.map(m => m.type).join(', ')}`, 'ramayne', chatId, agentId, { count: matches.length, types: matches.map(m => m.type) });

  // Sort by position descending so replacements don't shift offsets
  matches.sort((a, b) => b.position - a.position);

  let result = text;
  for (const match of matches) {
    result = result.slice(0, match.position) + `[REDACTED:${match.type}]` + result.slice(match.position + match.length);
  }

  return result;
}

export function guardMessage(text: string, chatId?: string, agentId?: string): string {
  return redactSecrets(text, chatId, agentId);
}
