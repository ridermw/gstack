import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const SETUP = fs.readFileSync(path.join(ROOT, 'setup'), 'utf-8');
const SETUP_CODE = SETUP
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');

function stripShellComments(src: string): string {
  return src
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n');
}

function executableLines(src: string): string[] {
  return stripShellComments(src)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !/^(?:echo|log|printf)\b/.test(line))
    .filter(line => !/\b(?:Usage|usage|help|expected|Unknown --host|Error:)\b/.test(line));
}

function shellFunctionBody(src: string, name: string): string {
  const start = src.indexOf(`${name}() {`);
  if (start === -1) return '';
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end === -1 ? undefined : end + 2);
}

function expectOrdered(haystack: string, needles: string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1);
    expect(next, `expected "${needle}" after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function invocationIndexAfter(src: string, name: string, offset: number): number {
  const lines = src.slice(offset).split('\n');
  let cursor = offset;
  for (const line of lines) {
    const trimmed = line.trim();
    const isDeclaration = new RegExp(`^[A-Za-z0-9_]*${name}[A-Za-z0-9_]*\\s*\\(\\)\\s*\\{?`).test(trimmed);
    const isExecutable = executableLines(line).length > 0;
    if (line.includes(name) && !isDeclaration && isExecutable) return cursor + line.indexOf(name);
    cursor += line.length + 1;
  }
  return -1;
}

function executableLineIndexAfter(src: string, offset: number, predicate: (line: string) => boolean): number {
  const lines = src.slice(offset).split('\n');
  let cursor = offset;
  for (const line of lines) {
    const executable = executableLines(line);
    if (executable.some(predicate)) return cursor;
    cursor += line.length + 1;
  }
  return -1;
}

function isNonzeroFailureLine(line: string): boolean {
  return /^(?:exit|return)\s+(?!0\b)\d+\b/.test(line) ||
    /^false$/.test(line) ||
    /(?:;\s*false|&&\s*false|\|\|\s*false)\s*$/.test(line);
}

describe('setup: Copilot local plugin contract', () => {
  test('setup accepts/documents GitHub Copilot CLI as a host option', () => {
    const copilotBlocks: string[] = [];
    for (const match of SETUP_CODE.matchAll(/(?:if|elif)\s+\[\s*"\$HOST"\s*=\s*"copilot"\s*\][\s\S]*?(?=\nelif\s+\[\s*"\$HOST"|\nelse\b|\nfi\b)/g)) {
      copilotBlocks.push(match[0]);
    }
    for (const match of SETUP_CODE.matchAll(/^\s*copilot\)[\s\S]*?(?=\n\s*[a-z0-9_|*-]+\)|\n\s*;;|\n\s*esac\b)/gm)) {
      copilotBlocks.push(match[0]);
    }

    expect(copilotBlocks.length).toBeGreaterThan(0);
    expect(copilotBlocks.some(block => executableLines(block).some(line =>
      /(?:gen:skill-docs|gen-skill-docs)[^\n]*--host[ =]copilot/.test(line) ||
      /install_[a-z_]*copilot/i.test(line) ||
      /copilot plugin install/.test(line) ||
      /INSTALL_[A-Z_]*COPILOT[A-Z_]*=1/.test(line)
    ))).toBe(true);
  });

  test('setup auto-detect prefers Copilot CLI as the first-choice host', () => {
    const autoStart = SETUP_CODE.indexOf('if [ "$HOST" = "auto" ]');
    expect(autoStart).toBeGreaterThanOrEqual(0);
    const autoEnd = SETUP_CODE.indexOf('elif [ "$HOST"', autoStart);
    const autoBlock = SETUP_CODE.slice(autoStart, autoEnd > autoStart ? autoEnd : undefined);
    const autoExecutableLines = executableLines(autoBlock);

    // Auto mode must detect the Copilot CLI...
    expect(autoExecutableLines.some(line => /command -v copilot/.test(line))).toBe(true);
    // ...and, when present, select it (first choice over claude/codex/etc.).
    expect(autoExecutableLines.some(line => /INSTALL_[A-Z_]*COPILOT[A-Z_]*=1/.test(line))).toBe(true);
    // The copilot detection must gate the claude/codex fallback so they don't
    // also install when Copilot wins.
    const copilotDetectIdx = autoBlock.indexOf('command -v copilot');
    const claudeDetectIdx = autoBlock.indexOf('command -v claude');
    expect(copilotDetectIdx).toBeGreaterThanOrEqual(0);
    expect(claudeDetectIdx).toBeGreaterThan(copilotDetectIdx);
  });

  test('setup generates .copilot-plugin before installing from the absolute plugin path', () => {
    const executableSetupLines = executableLines(SETUP);
    const generationLine = executableSetupLines.find(line =>
      /(?:gen:skill-docs|gen-skill-docs)/.test(line) && /--host[ =]copilot/.test(line)
    );
    expect(generationLine).toBeDefined();
    expect(SETUP_CODE).toContain('COPILOT_PLUGIN_DIR="$SOURCE_GSTACK_DIR/.copilot-plugin"');
    const generationIndex = SETUP_CODE.indexOf(generationLine!);
    const pluginDirIndex = executableLineIndexAfter(
      SETUP_CODE,
      0,
      line => line.includes('COPILOT_PLUGIN_DIR="$SOURCE_GSTACK_DIR/.copilot-plugin"')
    );
    const installCallCandidates = [
      invocationIndexAfter(SETUP_CODE, 'install_copilot', pluginDirIndex),
      invocationIndexAfter(SETUP_CODE, 'copilot plugin install', pluginDirIndex),
    ].filter(index => index >= 0);
    expect(installCallCandidates.length).toBeGreaterThan(0);
    const installCallIndex = Math.min(...installCallCandidates);
    expect(generationIndex).toBeGreaterThanOrEqual(0);
    expect(pluginDirIndex).toBeGreaterThanOrEqual(0);
    expect(installCallIndex).toBeGreaterThan(pluginDirIndex);
    expect(installCallIndex).toBeGreaterThan(generationIndex);

    expect(executableSetupLines.some(line => line.includes('copilot plugin install "$COPILOT_PLUGIN_DIR"'))).toBe(true);
  });

  test('setup creates the Copilot runtime root before persistent install', () => {
    const runtimeVarIndex = SETUP_CODE.indexOf('COPILOT_RUNTIME_ROOT="$HOME/.copilot/plugins/gstack"');
    const runtimeCreateIndex = executableLineIndexAfter(
      SETUP_CODE,
      runtimeVarIndex,
      line => line.includes('create_copilot_runtime_root "$SOURCE_GSTACK_DIR" "$COPILOT_RUNTIME_ROOT"')
    );
    const installCallIndex = invocationIndexAfter(SETUP_CODE, 'install_copilot_plugin', runtimeCreateIndex);
    const runtimeHelperBody = stripShellComments(shellFunctionBody(SETUP, 'create_copilot_runtime_root'));

    expect(runtimeVarIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeCreateIndex).toBeGreaterThan(runtimeVarIndex);
    expect(installCallIndex).toBeGreaterThan(runtimeCreateIndex);
    expect(runtimeHelperBody).toContain('.copilot-plugin/skills');
    expect(runtimeHelperBody).toContain('bin browse design design-html gstack-upgrade ios-qa lib office-hours plan-ceo-review plan-design-review plan-devex-review plan-eng-review review scripts');
    expect(runtimeHelperBody).toContain('ETHOS.md VERSION');
  });

  test('setup reinstalls through supported Copilot plugin commands without duplicate state', () => {
    const installerBody = stripShellComments(shellFunctionBody(SETUP, 'install_copilot_plugin'));
    const installerLines = executableLines(installerBody);
    const installLineIndex = installerLines.findIndex(line => line.includes('copilot plugin install "$COPILOT_PLUGIN_DIR"'));
    const listIndex = installerLines.findIndex(line => /copilot plugin list\b/.test(line));
    const uninstallBeforeInstall = installerLines.some((line, index) =>
      /copilot plugin uninstall gstack/.test(line) && (installLineIndex === -1 || index < installLineIndex)
    );
    const updateOrReinstallStrategy = installerLines.some(line =>
      /copilot plugin (?:update|upgrade|reinstall) (?:gstack|"\$COPILOT_PLUGIN_DIR")/.test(line)
    );
    const listThenHandling = listIndex >= 0 && installerLines.some((line, index) =>
      index > listIndex &&
      (installLineIndex === -1 || index < installLineIndex) &&
      /copilot plugin (?:uninstall|update|upgrade|reinstall) (?:gstack|"\$COPILOT_PLUGIN_DIR")/.test(line)
    );

    expect(uninstallBeforeInstall || updateOrReinstallStrategy || listThenHandling).toBe(true);
    expect(installerBody).toContain("grep -E '(^|[[:space:]•])gstack(@|[[:space:]]|$)'");
    const destructiveCopilotStateLines = executableLines(SETUP).filter(line => {
      if (!/(?:^|\s)(?:rm|unlink)\b|\bfind\b[^\n]*\b-delete\b|>\s*["']?[^"'\n\s]*\.copilot\b/.test(line)) return false;
      return /\.copilot(?:["'\/\s]|$)/.test(line) && !/\.copilot-plugin(?:["'\/\s]|$)/.test(line);
    });
    expect(destructiveCopilotStateLines).toEqual([]);
  });

  test('setup prints uninstall and local-failure fallback instructions', () => {
    const body = stripShellComments(shellFunctionBody(SETUP, 'install_copilot_plugin'));

    expect(SETUP_CODE).toContain('copilot plugin uninstall gstack');
    expect(SETUP_CODE).toMatch(/(?:log|echo|printf)[^\n]*copilot plugin uninstall gstack/);
    expect(SETUP_CODE).toContain('gstack setup failed: Copilot plugin install failed');
    expect(SETUP_CODE).toMatch(/copilot[^\n]*--plugin-dir "\$COPILOT_PLUGIN_DIR"/);
    expect(body).toMatch(/(?:dev|debug)(?:elopment)?[- ]?(?:only|fallback)|(?:fallback|debug)[^\n]*(?:dev|debug|only)/i);
    expectOrdered(body, [
      'copilot plugin install "$COPILOT_PLUGIN_DIR"',
      'gstack setup failed: Copilot plugin install failed',
      '--plugin-dir "$COPILOT_PLUGIN_DIR"',
    ]);
  });

  test('setup treats --plugin-dir fallback as install failure, not success', () => {
    const body = stripShellComments(shellFunctionBody(SETUP, 'install_copilot_plugin'));
    const failureStart = body.indexOf('gstack setup failed: Copilot plugin install failed');

    expectOrdered(body, [
      'copilot plugin install "$COPILOT_PLUGIN_DIR"',
      'gstack setup failed: Copilot plugin install failed',
      '--plugin-dir "$COPILOT_PLUGIN_DIR"',
    ]);
    const fallbackIndex = body.indexOf('--plugin-dir "$COPILOT_PLUGIN_DIR"', failureStart);
    expect(fallbackIndex).toBeGreaterThan(failureStart);
    const failureBranchLines = stripShellComments(body.slice(failureStart))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    const fallbackLineIndex = failureBranchLines.findIndex(line => line.includes('--plugin-dir "$COPILOT_PLUGIN_DIR"'));
    const failureLineIndex = failureBranchLines.findIndex((line, index) =>
      index > fallbackLineIndex &&
      executableLines(line).some(executableLine => isNonzeroFailureLine(executableLine))
    );
    expect(fallbackLineIndex).toBeGreaterThanOrEqual(0);
    expect(failureLineIndex).toBeGreaterThan(fallbackLineIndex);
    const failureBlock = failureBranchLines.slice(0, failureLineIndex + 1).join('\n');
    expect(failureBlock).toMatch(/(?:dev|debug)(?:elopment)?[- ]?(?:only|fallback)|(?:fallback|debug)[^\n]*(?:dev|debug|only)/i);
    expect(failureBlock).not.toMatch(/\b(success|ready|complete)\b|installed successfully|installation complete/i);
  });
});

describe('setup: default host preference', () => {
  test('an explicit --host choice is persisted as default_host', () => {
    expect(SETUP_CODE).toMatch(/HOST_EXPLICIT=1/);
    // Persist only when the host was explicitly requested.
    const persistIdx = SETUP_CODE.indexOf('set default_host "$HOST"');
    expect(persistIdx).toBeGreaterThanOrEqual(0);
    const guardIdx = SETUP_CODE.lastIndexOf('HOST_EXPLICIT', persistIdx);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(persistIdx - guardIdx).toBeLessThan(200);
  });

  test('a bare run resolves the saved default_host before host validation', () => {
    const resolveIdx = SETUP_CODE.indexOf('get default_host');
    const validationIdx = SETUP_CODE.indexOf('claude|codex|kiro|factory|opencode|copilot|auto)');
    expect(resolveIdx).toBeGreaterThanOrEqual(0);
    expect(validationIdx).toBeGreaterThan(resolveIdx);
  });

  test('installing Copilot makes it the sticky default host', () => {
    const installIdx = SETUP_CODE.indexOf('install_copilot_plugin');
    const stickyIdx = SETUP_CODE.indexOf('set default_host copilot');
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(stickyIdx).toBeGreaterThan(installIdx);
  });
});
