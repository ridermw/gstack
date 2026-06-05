import type { TemplateContext } from '../types';

export function generateCompletenessSection(ctx?: TemplateContext): string {
  if (ctx?.explainLevel === 'terse') return '';
  return `## Completeness Principle

AI makes completeness cheap. Recommend complete solutions with tests, edge cases, and error paths; flag work that is too broad to finish safely in one pass.

When options differ in coverage, include \`Completeness: X/10\` (10 = all edge cases, 7 = happy path, 3 = shortcut). When options differ in kind, write: \`Note: options differ in kind, not coverage — no completeness score.\` Do not fabricate scores.`;
}
