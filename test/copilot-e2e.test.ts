/**
 * Optional GitHub Copilot CLI E2E smoke.
 *
 * This intentionally avoids a speculative agent prompt protocol. It validates
 * the local .copilot-plugin artifacts and, when EVALS=1 plus live prerequisites
 * are present, verifies Copilot can see the persistent gstack plugin install.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import * as path from 'path';
import { EvalCollector } from './helpers/eval-store';
import { runCopilotSmoke, checkCopilotPrerequisites } from './helpers/copilot-session-runner';
import { detectBaseBranch, E2E_TIERS, getChangedFiles, GLOBAL_TOUCHFILES, selectTests } from './helpers/touchfiles';

const ROOT = path.resolve(import.meta.dir, '..');
const PLUGIN_DIR = path.join(ROOT, '.copilot-plugin');
const COPILOT_E2E_TOUCHFILES: Record<string, string[]> = {
  'copilot-smoke': ['.copilot-plugin/**', 'hosts/copilot.ts', 'setup', 'test/helpers/copilot-session-runner.ts'],
};

const evalsEnabled = !!process.env.EVALS;

let selectedTests: string[] | null = null;
if (evalsEnabled && !process.env.EVALS_ALL) {
  const baseBranch = process.env.EVALS_BASE || detectBaseBranch(ROOT) || 'main';
  const changedFiles = getChangedFiles(baseBranch, ROOT);
  if (changedFiles.length > 0) {
    const selection = selectTests(changedFiles, COPILOT_E2E_TOUCHFILES, GLOBAL_TOUCHFILES);
    selectedTests = selection.selected;
    process.stderr.write(`\nCopilot E2E selection (${selection.reason}): ${selection.selected.length}/${Object.keys(COPILOT_E2E_TOUCHFILES).length} tests\n`);
    if (selection.skipped.length > 0) process.stderr.write(`  Skipped: ${selection.skipped.join(', ')}\n`);
    process.stderr.write('\n');
  }
}

if (evalsEnabled && process.env.EVALS_TIER) {
  const tier = process.env.EVALS_TIER as 'gate' | 'periodic';
  const tierTests = Object.entries(E2E_TIERS)
    .filter(([, testTier]) => testTier === tier)
    .map(([name]) => name);
  selectedTests = selectedTests === null
    ? Object.keys(COPILOT_E2E_TOUCHFILES).filter(name => tierTests.includes(name))
    : selectedTests.filter(name => tierTests.includes(name));
  process.stderr.write(`Copilot EVALS_TIER=${tier}: ${selectedTests.length} tests\n\n`);
}

const hasSelectedTests = evalsEnabled && (selectedTests === null || selectedTests.length > 0);
const prereq = hasSelectedTests
  ? checkCopilotPrerequisites({ pluginDir: PLUGIN_DIR, cwd: ROOT, requireInstalledPlugin: true })
  : { ok: false, reason: evalsEnabled ? 'no Copilot E2E tests selected' : 'EVALS not set' };
const SKIP = !hasSelectedTests || !prereq.ok;

if (evalsEnabled && SKIP) {
  process.stderr.write(`\nCopilot E2E: SKIPPED — ${prereq.reason}\n`);
}

function testIfSelected(testName: string, fn: () => Promise<void>, timeout: number) {
  const shouldRun = selectedTests === null || selectedTests.includes(testName);
  (shouldRun ? test : test.skip)(testName, fn, timeout);
}

const evalCollector = evalsEnabled && !SKIP ? new EvalCollector('e2e-copilot') : null;

afterAll(async () => {
  await evalCollector?.finalize();
});

(SKIP ? describe.skip : describe)('Copilot E2E', () => {
  testIfSelected('copilot-smoke', async () => {
    const result = await runCopilotSmoke({
      pluginDir: PLUGIN_DIR,
      cwd: ROOT,
      requireInstalledPlugin: true,
      timeoutMs: 15_000,
    });

    evalCollector?.addTest({
      name: 'copilot-smoke',
      suite: 'copilot-e2e',
      tier: 'e2e',
      passed: !result.skipped && result.exitCode === 0,
      duration_ms: result.durationMs,
      cost_usd: 0,
      output: result.output.slice(0, 2000),
      turns_used: 0,
      exit_reason: result.skipped ? `skip: ${result.reason}` : `exit_code_${result.exitCode}`,
    });

    expect(result.skipped, result.reason).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('gstack');
  }, 30_000);
});
