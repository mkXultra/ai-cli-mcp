import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve, isAbsolute } from 'node:path';
import type { CliPaths } from './cli-utils.js';
import { getModelAliases } from './model-catalog.js';
import { getReasoningEffort, resolveModelSelection, type Agent } from './model-selection.js';

export { ALLOWED_REASONING_EFFORTS, getReasoningEffort } from './model-selection.js';

export function resolveModelAlias(model: string): string {
  return getModelAliases().find((alias) => alias.name === model)?.resolvesTo ?? model;
}

export interface CliCommand {
  cliPath: string;
  args: string[];
  cwd: string;
  agent: Agent;
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
  cliPaths: CliPaths;
}

export function buildCliCommand(options: BuildCliCommandOptions): CliCommand {
  if (!options.workFolder || typeof options.workFolder !== 'string') {
    throw new Error('Missing or invalid required parameter: workFolder');
  }

  const hasPrompt = !!options.prompt && typeof options.prompt === 'string' && options.prompt.trim() !== '';
  const hasPromptFile = !!options.prompt_file && typeof options.prompt_file === 'string' && options.prompt_file.trim() !== '';

  if (!hasPrompt && !hasPromptFile) {
    throw new Error('Either prompt or prompt_file must be provided');
  }

  if (hasPrompt && hasPromptFile) {
    throw new Error('Cannot specify both prompt and prompt_file. Please use only one.');
  }

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

  const cwd = pathResolve(options.workFolder);
  if (!existsSync(cwd)) {
    throw new Error(`Working folder does not exist: ${options.workFolder}`);
  }

  const rawModel = options.model || '';
  const alias = getModelAliases().find((entry) => entry.name === rawModel);
  const { agent, resolvedModel, openCodeModel } = resolveModelSelection(alias?.resolvesTo ?? rawModel);
  const reasoningEffort = getReasoningEffort(
    resolvedModel,
    options.reasoning_effort || alias?.defaultReasoningEffort,
  );

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
    if (resolvedModel && resolvedModel !== 'codex') {
      args.push('--model', resolvedModel);
    }

    args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', prompt);
  } else if (agent === 'gemini') {
    cliPath = options.cliPaths.gemini;
    args = ['-y', '--output-format', 'stream-json'];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('-r', options.session_id);
    }

    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    args.push(prompt);
  } else if (agent === 'forge') {
    cliPath = options.cliPaths.forge;
    args = ['-C', cwd];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('--conversation-id', options.session_id);
    }

    args.push('-p', prompt);
  } else if (agent === 'opencode') {
    cliPath = options.cliPaths.opencode;
    args = ['run', '--format', 'json', '--dir', cwd];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('--session', options.session_id);
    }

    if (openCodeModel) {
      args.push('--model', openCodeModel);
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
