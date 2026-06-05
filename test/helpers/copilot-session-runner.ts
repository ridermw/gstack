/**
 * GitHub Copilot CLI smoke helpers for optional E2E coverage.
 *
 * Copilot CLI's stable plugin commands are enough for Gate 6: verify the local
 * plugin artifacts are present and that an authenticated Copilot CLI can list a
 * persistent gstack plugin install. Agent transcript output is intentionally
 * parser-only until Copilot exposes/settles a documented non-interactive format.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ParsedCopilotJSONL {
  output: string;
  toolCalls: string[];
  tokens: number;
  sessionId: string | null;
  events: unknown[];
}

export interface CopilotPrerequisiteResult {
  ok: boolean;
  reason: string;
  binaryPath: string | null;
  pluginDir: string;
  pluginInstalled: boolean;
  stderr: string;
}

export interface CopilotSmokeResult extends CopilotPrerequisiteResult {
  skipped: boolean;
  exitCode: number;
  durationMs: number;
  output: string;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function collectText(obj: any, out: string[]): void {
  const direct = stringValue(obj.message)
    ?? stringValue(obj.text)
    ?? stringValue(obj.content)
    ?? stringValue(obj.delta)
    ?? stringValue(obj.response);
  if (direct) out.push(direct);

  const item = obj.item;
  if (item && typeof item === 'object') {
    const itemText = stringValue(item.text) ?? stringValue(item.content);
    if (itemText) out.push(itemText);
  }

  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  for (const choice of choices) {
    const choiceText = stringValue(choice?.delta?.content) ?? stringValue(choice?.message?.content);
    if (choiceText) out.push(choiceText);
  }
}

function collectToolCall(obj: any, out: string[]): void {
  const name = stringValue(obj.tool?.name)
    ?? stringValue(obj.tool_call?.name)
    ?? stringValue(obj.toolName)
    ?? stringValue(obj.tool_name)
    ?? stringValue(obj.item?.tool_name)
    ?? stringValue(obj.item?.name);
  if (name) out.push(name);

  const command = stringValue(obj.command) ?? stringValue(obj.item?.command);
  if (command) out.push(command);
}

function collectTokens(obj: any): number {
  const usage = obj.usage ?? obj.stats ?? {};
  const total = usage.total_tokens ?? usage.totalTokens;
  if (typeof total === 'number') return total;

  const input = usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0;
  return (typeof input === 'number' ? input : 0) + (typeof output === 'number' ? output : 0);
}

/** Parse crafted/captured JSONL-like Copilot output without requiring live auth. */
export function parseCopilotJSONL(lines: string[]): ParsedCopilotJSONL {
  const outputParts: string[] = [];
  const toolCalls: string[] = [];
  const events: unknown[] = [];
  let tokens = 0;
  let sessionId: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      events.push(obj);
      collectText(obj, outputParts);
      collectToolCall(obj, toolCalls);
      tokens += collectTokens(obj);

      const sid = stringValue(obj.session_id)
        ?? stringValue(obj.sessionId)
        ?? stringValue(obj.thread_id)
        ?? (obj.type === 'session' ? stringValue(obj.id) : null);
      if (sid) sessionId = sid;
    } catch {
      // Ignore non-JSON lines. Real CLIs often mix human-readable warnings in.
    }
  }

  return {
    output: outputParts.join(''),
    toolCalls,
    tokens,
    sessionId,
    events,
  };
}

export function isCopilotAuthOrAvailabilityFailure(stderr: string): boolean {
  return /auth|sign\s*in|login|not logged in|unauthori[sz]ed|forbidden|unavailable|network|offline/i.test(stderr);
}

export function hasInstalledCopilotPlugin(listOutput: string, pluginName: string): boolean {
  const escapedName = pluginName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pluginEntry = new RegExp(`(?:^|[\\s•])${escapedName}(?:@|\\s|$)`);
  return listOutput.split(/\r?\n/).some(line => pluginEntry.test(line.trim()));
}

function spawnText(args: string[], cwd: string, timeoutMs: number): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export function checkCopilotPrerequisites(opts: {
  pluginDir: string;
  cwd?: string;
  timeoutMs?: number;
  requireInstalledPlugin?: boolean;
}): CopilotPrerequisiteResult {
  const pluginDir = path.resolve(opts.pluginDir);
  const cwd = opts.cwd ?? path.dirname(pluginDir);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const requireInstalledPlugin = opts.requireInstalledPlugin ?? false;
  const binaryPath = Bun.which('copilot');

  if (!binaryPath) {
    return { ok: false, reason: 'copilot binary not found', binaryPath: null, pluginDir, pluginInstalled: false, stderr: '' };
  }

  if (!fs.existsSync(path.join(pluginDir, 'plugin.json')) || !fs.existsSync(path.join(pluginDir, 'skills'))) {
    return { ok: false, reason: `Copilot plugin artifacts missing at ${pluginDir}`, binaryPath, pluginDir, pluginInstalled: false, stderr: '' };
  }

  const version = spawnText([binaryPath, '--version'], cwd, timeoutMs);
  if (version.exitCode !== 0) {
    const stderr = version.stderr || version.stdout;
    return { ok: false, reason: isCopilotAuthOrAvailabilityFailure(stderr) ? 'copilot unavailable or unauthenticated' : 'copilot --version failed', binaryPath, pluginDir, pluginInstalled: false, stderr };
  }

  const list = spawnText([binaryPath, 'plugin', 'list'], cwd, timeoutMs);
  if (list.exitCode !== 0) {
    const stderr = list.stderr || list.stdout;
    return { ok: false, reason: isCopilotAuthOrAvailabilityFailure(stderr) ? 'copilot unavailable or unauthenticated' : 'copilot plugin list failed', binaryPath, pluginDir, pluginInstalled: false, stderr };
  }

  const pluginInstalled = hasInstalledCopilotPlugin(list.stdout, 'gstack');
  if (requireInstalledPlugin && !pluginInstalled) {
    return { ok: false, reason: 'gstack Copilot plugin is not persistently installed', binaryPath, pluginDir, pluginInstalled, stderr: list.stderr };
  }

  return { ok: true, reason: 'ok', binaryPath, pluginDir, pluginInstalled, stderr: list.stderr };
}

/**
 * Stable live smoke. Does not invent a prompt/output protocol; it only checks
 * documented/local plugin state and skips cleanly when prerequisites are absent.
 */
export async function runCopilotSmoke(opts: {
  pluginDir: string;
  cwd?: string;
  timeoutMs?: number;
  requireInstalledPlugin?: boolean;
}): Promise<CopilotSmokeResult> {
  const start = Date.now();
  const prereq = checkCopilotPrerequisites(opts);
  if (!prereq.ok || !prereq.binaryPath) {
    return { ...prereq, skipped: true, exitCode: -1, durationMs: Date.now() - start, output: '' };
  }

  const cwd = opts.cwd ?? path.dirname(path.resolve(opts.pluginDir));
  const result = spawnText([prereq.binaryPath, 'plugin', 'list'], cwd, opts.timeoutMs ?? 15_000);
  return {
    ...prereq,
    skipped: false,
    exitCode: result.exitCode,
    durationMs: Date.now() - start,
    output: result.stdout,
    stderr: result.stderr,
  };
}
