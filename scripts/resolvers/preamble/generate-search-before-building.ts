import type { TemplateContext } from '../types';

export function generateSearchBeforeBuildingSection(ctx: TemplateContext): string {
  return `## Search Before Building

Before building anything unfamiliar, **search first** and inspect the existing project.
- **Layer 1** (tried and true) — don't reinvent. **Layer 2** (new and popular) — scrutinize. **Layer 3** (first principles) — prize above all.

When first-principles reasoning contradicts conventional wisdom, name the insight and keep a local diagnostic note:
\`\`\`bash
jq -n --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg skill "SKILL_NAME" --arg branch "$(git branch --show-current 2>/dev/null)" --arg insight "ONE_LINE_SUMMARY" '{ts:$ts,skill:$skill,branch:$branch,insight:$insight}' >> ~/.gstack/analytics/eureka.jsonl 2>/dev/null || true
\`\`\``;
}
