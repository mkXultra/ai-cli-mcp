import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve, isAbsolute } from 'node:path';
import { MODEL_ALIASES } from './model-catalog.js';

export const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const CLAUDE_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

function getAgentForModel(model: string): 'codex' | 'claude' | 'gemini' {
  if (model.startsWith('gpt-')) {
    return 'codex';
  }
  if (model.startsWith('gemini')) {
    return 'gemini';
  }
  return 'claude';
}

/**
 * Resolves model aliases to their full model names
 * @param model - The model name or alias to resolve
 * @returns The full model name, or the original value if no alias exists
 */
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] || model;
}

/**
 * Validates and normalizes reasoning effort parameter.
 * @returns normalized reasoning effort string, or '' if not applicable
 * @throws Error for invalid values (plain Error, not MCP-specific)
 */
export function getReasoningEffort(model: string, rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    return '';
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.toLowerCase();
  if (!ALLOWED_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      `Invalid reasoning_effort: ${rawValue}. Allowed values: low, medium, high, xhigh.`
    );
  }
  const agent = getAgentForModel(model);
  if (agent === 'gemini') {
    throw new Error(
      'reasoning_effort is only supported for Claude and Codex models.'
    );
  }
  if (agent === 'claude' && !CLAUDE_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      'Claude reasoning_effort supports only low, medium, high.'
    );
  }
  return normalized;
}

export interface CliCommand {
  cliPath: string;
  args: string[];
  cwd: string;
  agent: 'claude' | 'codex' | 'gemini';
  prompt: string;
  resolvedModel: string;
}

export interface BuildCliCommandOptions {
  prompt?: string;
  prompt_file?: string;
  workFolder: string;
  model?: string;
  session_id?: string;
  reasoning_effort?: string;
  cliPaths: { claude: string; codex: string; gemini: string };
}

/**
 * Build a CLI command from the given options.
 * This is a pure function (aside from filesystem reads for prompt_file / workFolder validation).
 * @throws Error on validation failures
 */
export function buildCliCommand(options: BuildCliCommandOptions): CliCommand {
  // Validate workFolder
  if (!options.workFolder || typeof options.workFolder !== 'string') {
    throw new Error('Missing or invalid required parameter: workFolder');
  }

  // Validate prompt / prompt_file
  const hasPrompt = !!options.prompt && typeof options.prompt === 'string' && options.prompt.trim() !== '';
  const hasPromptFile = !!options.prompt_file && typeof options.prompt_file === 'string' && options.prompt_file.trim() !== '';

  if (!hasPrompt && !hasPromptFile) {
    throw new Error('Either prompt or prompt_file must be provided');
  }

  if (hasPrompt && hasPromptFile) {
    throw new Error('Cannot specify both prompt and prompt_file. Please use only one.');
  }

  // Determine prompt
  let prompt: string;
  if (hasPrompt) {
    prompt = options.prompt!;
  } else {
    const promptFilePath = isAbsolute(options.prompt_file!)
      ? options.prompt_file!
      : pathResolve(options.workFolder, options.prompt_file!);

    if (!existsSync(promptFilePath)) {
      throw new Error(`Prompt file does not exist: ${promptFilePath}`);
    }

    try {
      prompt = readFileSync(promptFilePath, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to read prompt file: ${error.message}`);
    }
  }

  // Resolve workFolder
  const cwd = pathResolve(options.workFolder);
  if (!existsSync(cwd)) {
    throw new Error(`Working folder does not exist: ${options.workFolder}`);
  }

  // Resolve model
  const rawModel = options.model || '';
  const resolvedModel = resolveModelAlias(rawModel);
  const agent = getAgentForModel(resolvedModel);

  // Special handling for ultra aliases: default to higher reasoning if not specified
  let reasoningEffortArg: string | undefined = options.reasoning_effort;
  if (!reasoningEffortArg) {
    if (rawModel === 'codex-ultra') {
      reasoningEffortArg = 'xhigh';
    } else if (rawModel === 'claude-ultra') {
      reasoningEffortArg = 'high';
    }
  }

  const reasoningEffort = getReasoningEffort(resolvedModel, reasoningEffortArg);

  // Build CLI path and args
  let cliPath: string;
  let args: string[];

  if (agent === 'codex') {
    cliPath = options.cliPaths.codex;

    if (options.session_id && typeof options.session_id === 'string') {
      args = ['exec', 'resume', options.session_id];
    } else {
      args = ['exec'];
    }

    if (reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
    }
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    args.push('--skip-git-repo-check', '--full-auto', '--json', prompt);

  } else if (agent === 'gemini') {
    cliPath = options.cliPaths.gemini;
    args = ['-y', '--output-format', 'json'];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('-r', options.session_id);
    }

    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    args.push(prompt);

  } else {
    cliPath = options.cliPaths.claude;
    args = ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('-r', options.session_id, '--fork-session');
    }

    if (reasoningEffort) {
      args.push('--effort', reasoningEffort);
    }

    args.push('-p', prompt);
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }
  }

  return { cliPath, args, cwd, agent, prompt, resolvedModel };
}
