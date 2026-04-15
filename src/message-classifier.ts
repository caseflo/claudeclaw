/**
 * message-classifier.ts — classifies messages as simple (ack) or complex
 * Simple messages can route to faster/cheaper handling. Not enabled by default.
 */

const SIMPLE_PATTERNS = [
  /^(ok|okay|k|got it|thanks|thank you|thx|ty|sure|yep|yup|yes|no|nope|cool|great|perfect|done|nice)[\s!.]*$/i,
  /^(understood|noted|acknowledged|roger|copy that|👍|✅|🙏)$/i,
];

export type MessageClass = 'simple' | 'complex';

export function classifyMessage(text: string): MessageClass {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'simple';
  if (trimmed.startsWith('/')) return 'complex'; // commands always complex
  if (SIMPLE_PATTERNS.some(p => p.test(trimmed))) return 'simple';
  return 'complex';
}
