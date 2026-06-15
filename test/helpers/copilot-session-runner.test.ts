import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkCopilotPrerequisites,
  hasInstalledCopilotPlugin,
  isCopilotAuthOrAvailabilityFailure,
  parseCopilotJSONL,
} from './copilot-session-runner';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const MISSING_PLUGIN_DIR = 'test/fixtures/does-not-exist-copilot-plugin';

describe('copilot-session-runner parser', () => {
  test('parses crafted JSONL without live Copilot auth', () => {
    const parsed = parseCopilotJSONL([
      JSON.stringify({ type: 'session', id: 's-123' }),
      JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello ' }),
      JSON.stringify({ type: 'tool_call', tool: { name: 'Read' }, usage: { input_tokens: 10, output_tokens: 5 } }),
      JSON.stringify({ item: { type: 'agent_message', text: 'world' }, usage: { total_tokens: 7 } }),
      'not json',
    ]);

    expect(parsed.sessionId).toBe('s-123');
    expect(parsed.output).toBe('Hello world');
    expect(parsed.toolCalls).toEqual(['Read']);
    expect(parsed.tokens).toBe(22);
    expect(parsed.events).toHaveLength(4);
  });

  test('parses OpenAI-style deltas defensively', () => {
    const parsed = parseCopilotJSONL([
      JSON.stringify({ session_id: 'abc' }),
      JSON.stringify({ choices: [{ delta: { content: 'streamed' } }] }),
      JSON.stringify({ tool_name: 'Bash' }),
      JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    ]);

    expect(parsed.sessionId).toBe('abc');
    expect(parsed.output).toBe('streamed');
    expect(parsed.toolCalls).toEqual(['Bash']);
    expect(parsed.tokens).toBe(7);
  });
});

describe('copilot-session-runner prerequisites', () => {
  test('recognizes common auth and availability failures', () => {
    expect(isCopilotAuthOrAvailabilityFailure('please sign in to GitHub')).toBe(true);
    expect(isCopilotAuthOrAvailabilityFailure('network unavailable')).toBe(true);
    expect(isCopilotAuthOrAvailabilityFailure('syntax error')).toBe(false);
  });

  test('recognizes Copilot plugin list name and name@source entries', () => {
    expect(hasInstalledCopilotPlugin('• superpowers@superpowers-marketplace (v5.1.0)\n• gstack@local (v1.56.0.0)', 'gstack')).toBe(true);
    expect(hasInstalledCopilotPlugin('gstack', 'gstack')).toBe(true);
    expect(hasInstalledCopilotPlugin('• gstack-extra@local (v1.0.0)', 'gstack')).toBe(false);
  });

  test('missing plugin artifacts skip before live Copilot commands', () => {
    const result = checkCopilotPrerequisites({ pluginDir: MISSING_PLUGIN_DIR });

    if (Bun.which('copilot')) {
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Copilot plugin artifacts missing');
    } else {
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('copilot binary not found');
    }
  });

  test('Copilot E2E tier filtering happens before live prerequisite checks', () => {
    const source = fs.readFileSync(path.join(ROOT, 'test', 'copilot-e2e.test.ts'), 'utf-8');
    const prereqIndex = source.indexOf('const prereq = hasSelectedTests');

    expect(prereqIndex).toBeGreaterThan(0);
    expect(source.indexOf('const hasSelectedTests')).toBeLessThan(prereqIndex);
    expect(source.slice(0, prereqIndex)).not.toContain('checkCopilotPrerequisites({');
  });
});
