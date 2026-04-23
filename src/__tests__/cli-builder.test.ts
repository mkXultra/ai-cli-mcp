import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// Mock dependencies
vi.mock('node:fs');
vi.mock('node:path', () => ({
  resolve: vi.fn((...args: string[]) => args[args.length - 1]),
  isAbsolute: vi.fn((p: string) => p.startsWith('/')),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

// Import after mocks
import {
  buildCliCommand,
  resolveModelAlias,
  getReasoningEffort,
} from '../cli-builder.js';

const DEFAULT_CLI_PATHS = {
  claude: '/usr/bin/claude',
  codex: '/usr/bin/codex',
  gemini: '/usr/bin/gemini',
  forge: '/usr/bin/forge',
  opencode: '/usr/bin/opencode',
};

describe('cli-builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, workFolder exists
    mockExistsSync.mockReturnValue(true);
  });

  describe('resolveModelAlias', () => {
    it('should resolve claude-ultra to opus', () => {
      expect(resolveModelAlias('claude-ultra')).toBe('opus');
    });

    it('should resolve codex-ultra to gpt-5.5', () => {
      expect(resolveModelAlias('codex-ultra')).toBe('gpt-5.5');
    });

    it('should resolve gemini-ultra to gemini-3.1-pro-preview', () => {
      expect(resolveModelAlias('gemini-ultra')).toBe('gemini-3.1-pro-preview');
    });

    it('should pass through non-alias model names', () => {
      expect(resolveModelAlias('sonnet')).toBe('sonnet');
      expect(resolveModelAlias('gpt-5.3-codex')).toBe('gpt-5.3-codex');
    });

    it('should pass through empty string', () => {
      expect(resolveModelAlias('')).toBe('');
    });
  });

  describe('getReasoningEffort', () => {
    it('should return empty string for non-string input', () => {
      expect(getReasoningEffort('gpt-5.2', undefined)).toBe('');
      expect(getReasoningEffort('gpt-5.2', null)).toBe('');
      expect(getReasoningEffort('gpt-5.2', 123)).toBe('');
    });

    it('should return empty string for empty/whitespace input', () => {
      expect(getReasoningEffort('gpt-5.2', '')).toBe('');
      expect(getReasoningEffort('gpt-5.2', '  ')).toBe('');
    });

    it('should normalize to lowercase', () => {
      expect(getReasoningEffort('gpt-5.2', 'HIGH')).toBe('high');
      expect(getReasoningEffort('gpt-5.2', 'Low')).toBe('low');
    });

    it('should accept valid values', () => {
      expect(getReasoningEffort('gpt-5.2', 'low')).toBe('low');
      expect(getReasoningEffort('gpt-5.2', 'medium')).toBe('medium');
      expect(getReasoningEffort('gpt-5.2', 'high')).toBe('high');
      expect(getReasoningEffort('gpt-5.2', 'xhigh')).toBe('xhigh');
      expect(getReasoningEffort('sonnet', 'xhigh')).toBe('xhigh');
      expect(getReasoningEffort('sonnet', 'max')).toBe('max');
      expect(getReasoningEffort('sonnet', 'high')).toBe('high');
      expect(getReasoningEffort('', 'low')).toBe('low');
    });

    it('should throw for invalid reasoning effort value', () => {
      expect(() => getReasoningEffort('gpt-5.2', 'ultra')).toThrow(
        'Invalid reasoning_effort: ultra. Allowed values: low, medium, high, xhigh, max.'
      );
    });

    it('should reject max for codex models', () => {
      expect(() => getReasoningEffort('gpt-5.2', 'max')).toThrow(
        'Codex reasoning_effort supports only low, medium, high, xhigh.'
      );
    });

    it('should throw for unsupported model families', () => {
      expect(() => getReasoningEffort('gemini-2.5-pro', 'high')).toThrow(
        'reasoning_effort is only supported for Claude and Codex models.'
      );
    });

    it('should reject reasoning_effort for forge explicitly', () => {
      expect(() => getReasoningEffort('forge', 'high')).toThrow(
        'reasoning_effort is not supported for forge.'
      );
    });

    it('should reject reasoning_effort for opencode explicitly', () => {
      expect(() => getReasoningEffort('opencode', 'high')).toThrow(
        'reasoning_effort is not supported for opencode.'
      );
      expect(() => getReasoningEffort('oc-openai/gpt-5.4', 'high')).toThrow(
        'reasoning_effort is not supported for opencode.'
      );
    });
  });

  describe('buildCliCommand', () => {
    describe('validation', () => {
      it('should throw when workFolder is missing', () => {
        expect(() =>
          buildCliCommand({
            prompt: 'hello',
            workFolder: '',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Missing or invalid required parameter: workFolder');
      });

      it('should throw when neither prompt nor prompt_file is provided', () => {
        expect(() =>
          buildCliCommand({
            workFolder: '/tmp',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Either prompt or prompt_file must be provided');
      });

      it('should throw when both prompt and prompt_file are provided', () => {
        expect(() =>
          buildCliCommand({
            prompt: 'hello',
            prompt_file: '/tmp/prompt.txt',
            workFolder: '/tmp',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Cannot specify both prompt and prompt_file');
      });

      it('should throw when prompt_file does not exist', () => {
        mockExistsSync.mockImplementation((p) => {
          if (p === '/tmp/nonexistent.txt') return false;
          return true; // workFolder exists
        });

        expect(() =>
          buildCliCommand({
            prompt_file: '/tmp/nonexistent.txt',
            workFolder: '/tmp',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Prompt file does not exist');
      });

      it('should throw when workFolder does not exist', () => {
        mockExistsSync.mockReturnValue(false);

        expect(() =>
          buildCliCommand({
            prompt: 'hello',
            workFolder: '/nonexistent',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Working folder does not exist');
      });

      it('should read prompt from file', () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('prompt from file');

        const cmd = buildCliCommand({
          prompt_file: '/tmp/prompt.txt',
          workFolder: '/tmp',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.prompt).toBe('prompt from file');
      });
    });

    describe('claude agent', () => {
      it('should build claude command with default model', () => {
        const cmd = buildCliCommand({
          prompt: 'hello world',
          workFolder: '/tmp',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('claude');
        expect(cmd.cliPath).toBe('/usr/bin/claude');
        expect(cmd.args).toEqual([
          '--dangerously-skip-permissions',
          '--output-format',
          'stream-json',
          '--verbose',
          '-p',
          'hello world',
        ]);
        expect(cmd.resolvedModel).toBe('');
      });

      it('should build claude command with model', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'sonnet',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('claude');
        expect(cmd.args).toContain('--model');
        expect(cmd.args).toContain('sonnet');
        expect(cmd.resolvedModel).toBe('sonnet');
      });

      it('should build claude command with session_id', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          session_id: 'ses-123',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('-r');
        expect(cmd.args).toContain('ses-123');
        expect(cmd.args).toContain('--fork-session');
      });

      it('should resolve claude-ultra alias to opus', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'claude-ultra',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('claude');
        expect(cmd.resolvedModel).toBe('opus');
        expect(cmd.args).toContain('opus');
      });

      it('should resolve claude-ultra and default to max effort', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'claude-ultra',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('--effort');
        expect(cmd.args).toContain('max');
      });

      it('should build claude command with reasoning_effort using --effort', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'sonnet',
          reasoning_effort: 'medium',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('--effort');
        expect(cmd.args).toContain('medium');
      });

      it('should build claude command with xhigh reasoning_effort', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'sonnet',
          reasoning_effort: 'xhigh',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('--effort');
        expect(cmd.args).toContain('xhigh');
      });

      it('should build claude command with max reasoning_effort', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'opus',
          reasoning_effort: 'max',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('--effort');
        expect(cmd.args).toContain('max');
      });

      it('should allow overriding reasoning_effort for claude-ultra', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'claude-ultra',
          reasoning_effort: 'low',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('--effort');
        expect(cmd.args).toContain('low');
        expect(cmd.args).not.toContain('max');
      });
    });

    describe('codex agent', () => {
      it('should build codex command using the CLI default model', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'codex',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('codex');
        expect(cmd.resolvedModel).toBe('codex');
        expect(cmd.cliPath).toBe('/usr/bin/codex');
        expect(cmd.args).toContain('exec');
        expect(cmd.args).toContain('--dangerously-bypass-approvals-and-sandbox');
        expect(cmd.args).toContain('--json');
        expect(cmd.args).not.toContain('--model');
      });

      it('should build codex default model command with reasoning_effort', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'codex',
          reasoning_effort: 'high',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('-c');
        expect(cmd.args).toContain('model_reasoning_effort=high');
        expect(cmd.args).not.toContain('--model');
      });

      it('should build codex default model command with session_id using exec resume', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'codex',
          session_id: 'codex-default-ses-456',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args[0]).toBe('exec');
        expect(cmd.args[1]).toBe('resume');
        expect(cmd.args[2]).toBe('codex-default-ses-456');
        expect(cmd.args).not.toContain('--model');
      });

      it('should build codex command', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'gpt-5.3-codex',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('codex');
        expect(cmd.cliPath).toBe('/usr/bin/codex');
        expect(cmd.args).toContain('exec');
        expect(cmd.args).toContain('--dangerously-bypass-approvals-and-sandbox');
        expect(cmd.args).not.toContain('--full-auto');
        expect(cmd.args).toContain('--json');
        expect(cmd.args).toContain('--model');
        expect(cmd.args).toContain('gpt-5.3-codex');
      });

      it('should build codex command with session_id using exec resume', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'gpt-5.2',
          session_id: 'codex-ses-456',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args[0]).toBe('exec');
        expect(cmd.args[1]).toBe('resume');
        expect(cmd.args[2]).toBe('codex-ses-456');
      });

      it('should build codex command with reasoning_effort', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'gpt-5.3-codex',
          reasoning_effort: 'high',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('-c');
        expect(cmd.args).toContain('model_reasoning_effort=high');
      });

      it('should resolve codex-ultra and default to xhigh reasoning', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'codex-ultra',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('codex');
        expect(cmd.resolvedModel).toBe('gpt-5.5');
        expect(cmd.args).toContain('-c');
        expect(cmd.args).toContain('model_reasoning_effort=xhigh');
      });

      it('should allow overriding reasoning_effort for codex-ultra', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'codex-ultra',
          reasoning_effort: 'low',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('model_reasoning_effort=low');
        expect(cmd.args).not.toContain('model_reasoning_effort=xhigh');
      });

      it('should reject max reasoning_effort for codex', () => {
        expect(() =>
          buildCliCommand({
            prompt: 'test',
            workFolder: '/tmp',
            model: 'gpt-5.4',
            reasoning_effort: 'max',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Codex reasoning_effort supports only low, medium, high, xhigh.');
      });
    });

    describe('gemini agent', () => {
      it('should build gemini command', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'gemini-2.5-pro',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('gemini');
        expect(cmd.cliPath).toBe('/usr/bin/gemini');
        expect(cmd.args).toContain('-y');
        expect(cmd.args).toContain('--output-format');
        expect(cmd.args).toContain('stream-json');
        expect(cmd.args).toContain('--model');
        expect(cmd.args).toContain('gemini-2.5-pro');
      });

      it('should build gemini command with session_id', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'gemini-2.5-pro',
          session_id: 'gem-789',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toContain('-r');
        expect(cmd.args).toContain('gem-789');
      });

      it('should resolve gemini-ultra alias', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'gemini-ultra',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('gemini');
        expect(cmd.resolvedModel).toBe('gemini-3.1-pro-preview');
      });
    });

    describe('opencode agent', () => {
      it('should build default opencode command without --model', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'opencode',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('opencode');
        expect(cmd.cliPath).toBe('/usr/bin/opencode');
        expect(cmd.cwd).toBe('/tmp');
        expect(cmd.args).toEqual(['run', '--format', 'json', '--dir', '/tmp', 'test']);
        expect(cmd.args).not.toContain('--model');
      });

      it('should route valid explicit OpenCode model syntax', () => {
        const cmd = buildCliCommand({
          prompt: 'test',
          workFolder: '/tmp',
          model: 'oc-openai/gpt-5.4',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.agent).toBe('opencode');
        expect(cmd.resolvedModel).toBe('oc-openai/gpt-5.4');
        expect(cmd.args).toEqual([
          'run',
          '--format',
          'json',
          '--dir',
          '/tmp',
          '--model',
          'openai/gpt-5.4',
          'test',
        ]);
      });

      it.each([
        'oc-',
        'oc-openai',
        'oc-/gpt-5.4',
        'oc-openai/',
      ])('should reject invalid explicit OpenCode syntax: %s', (model) => {
        expect(() =>
          buildCliCommand({
            prompt: 'test',
            workFolder: '/tmp',
            model,
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('Invalid OpenCode model. Expected exact syntax oc-<provider/model>.');
      });

      it.each([' oc-openai/gpt-5.4', 'oc-openai/gpt-5.4 '])(
        'should reject explicit OpenCode models with surrounding whitespace: %s',
        (model) => {
          expect(() =>
            buildCliCommand({
              prompt: 'test',
              workFolder: '/tmp',
              model,
              cliPaths: DEFAULT_CLI_PATHS,
            })
          ).toThrow('Invalid OpenCode model. Expected exact syntax oc-<provider/model>.');
        }
      );

      it('should reject reasoning_effort for OpenCode in command building', () => {
        expect(() =>
          buildCliCommand({
            prompt: 'test',
            workFolder: '/tmp',
            model: 'opencode',
            reasoning_effort: 'high',
            cliPaths: DEFAULT_CLI_PATHS,
          })
        ).toThrow('reasoning_effort is not supported for opencode.');
      });

      it('should build resumed default OpenCode command', () => {
        const cmd = buildCliCommand({
          prompt: 'resume prompt',
          workFolder: '/tmp',
          model: 'opencode',
          session_id: 'ses-123',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toEqual([
          'run',
          '--format',
          'json',
          '--dir',
          '/tmp',
          '--session',
          'ses-123',
          'resume prompt',
        ]);
        expect(cmd.args).not.toContain('--model');
      });

      it('should build resumed explicit OpenCode command', () => {
        const cmd = buildCliCommand({
          prompt: 'resume prompt',
          workFolder: '/tmp',
          model: 'oc-openai/gpt-5.4',
          session_id: 'ses-456',
          cliPaths: DEFAULT_CLI_PATHS,
        });

        expect(cmd.args).toEqual([
          'run',
          '--format',
          'json',
          '--dir',
          '/tmp',
          '--session',
          'ses-456',
          '--model',
          'openai/gpt-5.4',
          'resume prompt',
        ]);
      });
    });
  });
});
