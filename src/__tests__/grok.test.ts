import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCliCommand } from '../cli-builder.js';
import { getReasoningEffort, resolveModelSelection } from '../model-selection.js';
import { getModelsPayload } from '../model-catalog.js';
import { parseGrokOutput, PeekEventExtractor } from '../parsers.js';
import { buildProcessResult } from '../process-result.js';

const success = readFileSync(new URL('./fixtures/grok-messages.ndjson', import.meta.url), 'utf8');
const failure = readFileSync(new URL('./fixtures/grok-error.ndjson', import.meta.url), 'utf8');
const cliPaths = { claude: 'claude', codex: 'codex', gemini: 'gemini', forge: 'forge', opencode: 'opencode', grok: 'grok-custom' };
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'grok-unit-'));
  writeFileSync(join(root, 'config.json'), '{}');
  vi.stubEnv('AI_CLI_CONFIG_PATH', join(root, 'config.json'));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe('Grok routing and effort', () => {
  it.each(['grok', 'grok-4.6', 'grok-4.5', 'grok-future'])('routes %s independently', (model) => {
    expect(resolveModelSelection(model).agent).toBe('grok');
    const command = buildCliCommand({ cliPaths, workFolder: root, model, prompt: 'hello', session_id: 'previous', reasoning_effort: 'LOW' });
    expect(command).toMatchObject({ agent: 'grok', cliPath: 'grok-custom', cwd: root });
    expect(command.args).toEqual(['--single=hello', '--cwd', root, '--output-format', 'streaming-messages-json', '--always-approve', '--no-auto-update', ...(model === 'grok' ? [] : ['--model', model]), '--reasoning-effort', 'low', '--resume=previous']);
  });
  it('delegates default model/effort to Grok and reads prompt files', () => {
    writeFileSync(join(root, 'prompt.txt'), 'file prompt');
    const command = buildCliCommand({ cliPaths, workFolder: root, model: 'grok', prompt_file: 'prompt.txt' });
    expect(command.args).toEqual(['--single=file prompt', '--cwd', root, '--output-format', 'streaming-messages-json', '--always-approve', '--no-auto-update']);
  });
  it.each(['grok', 'grok-4.5', 'grok-future'])('rejects unsupported effort for %s', (model) => {
    for (const effort of ['xhigh', 'max', 'ultra', 'invalid']) expect(() => getReasoningEffort(model, effort)).toThrow(/Grok reasoning_effort/);
    for (const effort of ['low', 'medium', 'high']) expect(getReasoningEffort(model, effort)).toBe(effort);
  });
  it('accepts xhigh only for 4.6, without advertising max/ultra', () => {
    expect(getReasoningEffort('grok-4.6', 'xhigh')).toBe('xhigh');
    for (const effort of ['max', 'ultra']) expect(() => getReasoningEffort('grok-4.6', effort)).toThrow();
    expect(getModelsPayload().grok).toEqual(['grok', 'grok-4.6', 'grok-4.5']);
    expect(getModelsPayload().reasoningEfforts.grok).toEqual({ grok: ['low', 'medium', 'high'], 'grok-4.6': ['low', 'medium', 'high', 'xhigh'], 'grok-4.5': ['low', 'medium', 'high'] });
  });
  it('uses existing aliases, permits explicit effort overrides and protects native names', () => {
    const config = join(root, 'config.json');
    writeFileSync(config, JSON.stringify({ model_aliases: { 'coding-test': { model: 'grok-4.6', reasoning_effort: 'xhigh' } } }));
    const run = (reasoning_effort?: string) => buildCliCommand({ cliPaths, workFolder: root, model: 'coding-test', prompt: 'hello', reasoning_effort });
    expect(run().args).toContain('xhigh');
    expect(run('low').args).toContain('low');
    expect(getModelsPayload().aliases).toContainEqual({ name: 'coding-test', resolvesTo: 'grok-4.6', agent: 'grok', defaultReasoningEffort: 'xhigh' });
    writeFileSync(config, JSON.stringify({ model_aliases: { sonnet: { model: 'opus' } } }));
    expect(() => run()).toThrow(/cannot replace native/);
  });
});

describe('Grok Messages results and peek', () => {
  it('extracts final answer, session, tools and usage/model metadata', () => {
    expect(parseGrokOutput(success)).toMatchObject({ message: 'Check complete.', session_id: 'grok-session-test', model: 'grok-4.6', subtype: 'success', is_error: false, usage: { input_tokens: 20 }, total_cost_usd: 0.001, tools: [{ tool: 'run_terminal_command', input: { command: 'sleep 1' }, output: 'PRIVATE_TOOL_OUTPUT' }] });
  });
  it('handles single events, incomplete writes, malformed JSON and multiple assistant messages', () => {
    expect(parseGrokOutput('bad\nnull\n{"type":')).toBeNull();
    const lines = success.trim().split('\n');
    expect(parseGrokOutput(lines[0])).toEqual({ session_id: 'grok-session-test', model: 'grok-4.6' });
    expect(parseGrokOutput(lines[1]).message).toBe('Starting bounded check.');
    expect(parseGrokOutput(lines.slice(0, 4).join('\n') + '\n{"type":').message).toBe('Starting bounded check.\n\nCheck complete.');
    expect(parseGrokOutput(lines[4]).message).toBe('Check complete.');
  });
  it.each([false, true])('retains terminal errors and stderr after partial output (verbose=%s)', (verbose) => {
    const output = parseGrokOutput(failure);
    const result = buildProcessResult({ pid: 123, agent: 'grok', status: 'failed', exitCode: 1, startTime: '', workFolder: root, prompt: '', model: 'grok-4.6', stdout: failure, stderr: 'Turn limit reached' }, output, verbose);
    expect(result).toMatchObject({ status: 'failed', exitCode: 1, stderr: 'Turn limit reached', session_id: 'grok-failure-test', agentOutput: { message: 'Starting bounded check.', is_error: true, subtype: 'error_max_turns', errors: ['Reached the maximum number of turns'], stop_reason: 'max_turns' } });
  });
  it('keeps startup diagnostics and excludes detailed tools in compact results', () => {
    const context = { pid: 123, agent: 'grok' as const, status: 'failed' as const, startTime: '', workFolder: root, prompt: '', stdout: '', stderr: 'Session not found', exitCode: 1 };
    expect(buildProcessResult(context, null)).toMatchObject({ stdout: '', stderr: 'Session not found' });
    expect(buildProcessResult(context, parseGrokOutput(success)).agentOutput.tools).toBeUndefined();
    expect(buildProcessResult(context, parseGrokOutput(success), true).agentOutput.tools).toHaveLength(1);
  });
  it.each([false, true])('handles split NDJSON and filters private content (tools=%s)', (includeToolCalls) => {
    const extractor = new PeekEventExtractor('grok', { includeToolCalls });
    const stream = 'malformed\nnull\n' + success;
    const events = [];
    for (let i = 0; i < stream.length; i += 7) events.push(...extractor.push(stream.slice(i, i + 7), 'test-time'));
    events.push(...extractor.flush('test-time', { terminal: true }));
    expect(events.filter((e) => e.kind === 'message').map((e) => e.text)).toEqual(['Starting bounded check.', 'Check complete.']);
    expect(events.filter((e) => e.kind === 'tool_call').map((e) => e.phase)).toEqual(includeToolCalls ? ['started', 'completed'] : []);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
    if (includeToolCalls) expect(events[2]).toMatchObject({ phase: 'completed', status: 'success', tool: 'run_terminal_command', summary: 'sleep 1' });
    expect(new PeekEventExtractor('grok', { source: 'stderr' }).push(success)).toEqual([]);
  });
});

it.each(['- item one', '-- separator', '---\ntitle: task\n---', '-v', '--x=y'])('attaches hyphen-leading prompt and resume values: %s', (prompt) => {
  writeFileSync(join(root, 'hyphens.txt'), prompt);
  for (const input of [{ prompt }, { prompt_file: 'hyphens.txt' }]) {
    const command = buildCliCommand({ cliPaths, workFolder: root, model: 'grok', ...input, session_id: '--unexpected' });
    expect(command.args[0]).toBe(`--single=${prompt}`);
    expect(command.args).toContain('--resume=--unexpected');
    expect(command.args).not.toContain(prompt);
  }
});

it('preserves a legacy grok alias without affecting unrelated models or native Grok names', () => {
  writeFileSync(join(root, 'config.json'), JSON.stringify({ model_aliases: { grok: { model: 'oc-xai/grok-4' } } }));
  const run = (model: string) => buildCliCommand({ cliPaths, workFolder: root, model, prompt: 'hello' });
  expect(run('grok')).toMatchObject({ agent: 'opencode', resolvedModel: 'oc-xai/grok-4' });
  expect(run('sonnet').agent).toBe('claude');
  expect(run('grok-4.6').agent).toBe('grok');
  expect(getModelsPayload().aliases).toContainEqual({ name: 'grok', resolvesTo: 'oc-xai/grok-4', agent: 'opencode' });
});

it('only suggests selecting grok-4.6 when rejecting xhigh on another Grok model', () => {
  for (const effort of ['max', 'ultra', 'minimal']) {
    expect(() => getReasoningEffort('grok-4.6', effort)).toThrow('Grok reasoning_effort for grok-4.6 supports only low, medium, high, xhigh.');
    try { getReasoningEffort('grok-4.6', effort); } catch (error: any) { expect(error.message).not.toContain('Select grok-4.6'); }
  }
  expect(() => getReasoningEffort('grok', 'xhigh')).toThrow('Select grok-4.6 explicitly');
});
