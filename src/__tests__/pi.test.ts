import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCliCommand } from '../cli-builder.js';
import { getModelsPayload } from '../model-catalog.js';
import { getReasoningEffort, resolveModelSelection } from '../model-selection.js';
import { parsePiOutput, PeekEventExtractor } from '../parsers.js';
import { buildProcessResult } from '../process-result.js';

const stream = readFileSync(new URL('./fixtures/pi.ndjson', import.meta.url), 'utf8');
const cliPaths = { claude: 'claude', codex: 'codex', gemini: 'agy', opencode: 'opencode', grok: 'grok', pi: 'pi-custom' };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-unit-'));
  writeFileSync(join(root, 'config.json'), '{}');
  vi.stubEnv('AI_CLI_CONFIG_PATH', join(root, 'config.json'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('Pi routing and command construction', () => {
  it('uses the Pi configured default without passing a model', () => {
    const command = buildCliCommand({ cliPaths, workFolder: root, model: 'pi', prompt: '--literal prompt' });
    expect(command).toMatchObject({ agent: 'pi', cliPath: 'pi-custom', resolvedModel: 'pi' });
    expect(command.args).toEqual(['--mode', 'json', '--approve', '-p', '--', '--literal prompt']);
  });

  it('passes an explicit provider/model, session and thinking level', () => {
    const command = buildCliCommand({
      cliPaths,
      workFolder: root,
      model: 'pi-openai-codex/gpt-6-astra',
      prompt: 'hello',
      session_id: '--session-value',
      reasoning_effort: 'XHIGH',
    });
    expect(resolveModelSelection('pi-openai-codex/gpt-6-astra')).toMatchObject({
      agent: 'pi',
      piModel: 'openai-codex/gpt-6-astra',
    });
    expect(command.args).toEqual([
      '--mode', 'json', '--approve', '--session', '--session-value',
      '--model', 'openai-codex/gpt-6-astra', '--thinking', 'xhigh', '-p', '--', 'hello',
    ]);
  });

  it.each(['pi-provider', 'pi-/model', 'pi-provider/', ' pi-provider/model'])('rejects malformed explicit model %s', (model) => {
    expect(() => resolveModelSelection(model)).toThrow('Invalid Pi model. Expected exact syntax pi-<provider/model>.');
  });

  it('accepts Pi thinking levels and publishes dynamic discovery metadata', () => {
    for (const effort of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(getReasoningEffort('pi-openai-codex/gpt-6-astra', effort.toUpperCase())).toBe(effort);
    }
    expect(() => getReasoningEffort('pi', 'ultra')).toThrow('Pi reasoning_effort');
    expect(getModelsPayload()).toMatchObject({
      pi: ['pi'],
      reasoningEfforts: { pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
      dynamicModelBackends: {
        pi: {
          explicitPrefix: 'pi-',
          explicitPattern: 'pi-<provider/model>',
          discoveryCommand: 'pi --list-models',
          modelsAreDynamic: true,
        },
      },
    });
  });
});

describe('Pi JSON results and peek', () => {
  it('extracts final text, session, model, usage and verbose tool history', () => {
    expect(parsePiOutput(stream)).toMatchObject({
      message: 'Pi done.',
      session_id: 'pi-session-test',
      provider: 'openai-codex',
      model: 'gpt-6-astra',
      stop_reason: 'stop',
      usage: { input: 12, output: 5, totalTokens: 19 },
      tools: [{ tool: 'bash', input: { command: 'printf PI_TOOL_OK' }, is_error: false }],
    });
    expect(parsePiOutput('diagnostic\n{"type":')).toBeNull();
  });

  it('omits tool details in compact results and retains stderr on failure', () => {
    const context = { pid: 123, agent: 'pi' as const, status: 'failed' as const, exitCode: 1, startTime: '', workFolder: root, prompt: '', model: 'pi', stdout: stream, stderr: 'Pi failed' };
    expect(buildProcessResult(context, parsePiOutput(stream))).toMatchObject({
      status: 'failed',
      stderr: 'Pi failed',
      agentOutput: { message: 'Pi done.' },
    });
    expect(buildProcessResult(context, parsePiOutput(stream)).agentOutput.tools).toBeUndefined();
    expect(buildProcessResult(context, parsePiOutput(stream), true).agentOutput.tools).toHaveLength(1);
  });

  it.each([false, true])('streams only text deltas and normalized tool phases (tools=%s)', (includeToolCalls) => {
    const extractor = new PeekEventExtractor('pi', { includeToolCalls });
    const events = [];
    for (let index = 0; index < stream.length; index += 11) {
      events.push(...extractor.push(stream.slice(index, index + 11), 'test-time'));
    }
    events.push(...extractor.flush('test-time', { terminal: true }));
    expect(events.filter((event) => event.kind === 'message').map((event) => event.text)).toEqual(['Pi done.']);
    expect(events.filter((event) => event.kind === 'tool_call').map((event) => event.phase)).toEqual(includeToolCalls ? ['started', 'completed'] : []);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
    if (includeToolCalls) {
      expect(events[1]).toMatchObject({ kind: 'tool_call', phase: 'completed', tool: 'bash', summary: 'printf PI_TOOL_OK', status: 'success' });
    }
    expect(new PeekEventExtractor('pi', { source: 'stderr' }).push(stream)).toEqual([]);
  });
});
