import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as path from 'path';

// Define debugMode globally using const
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';

// Dedicated debug logging function
export function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error(message, ...optionalParams);
  }
}

export interface CliBinaryStatus {
  configuredCommand: string;
  resolvedPath: string | null;
  available: boolean;
  lookup: 'env' | 'local' | 'path';
  error?: string;
}

function getPathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function getPathExtensions(): string[] {
  if (process.platform !== 'win32') {
    return [''];
  }

  const rawPathext = process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  return ['', ...rawPathext.split(';').filter(Boolean)];
}

function findExecutableOnPath(commandName: string): string | null {
  const rawPath = process.env.PATH || '';
  if (!rawPath) {
    return null;
  }

  const pathEntries = rawPath.split(getPathDelimiter()).filter(Boolean);
  const extensions = getPathExtensions();

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(entry, `${commandName}${extension}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function validateCustomCliName(envVarName: string, customCliName: string): string | null {
  if (path.isAbsolute(customCliName)) {
    return null;
  }

  if (
    customCliName.startsWith('./') ||
    customCliName.startsWith('../') ||
    customCliName.includes('/')
  ) {
    return `Invalid ${envVarName}: Relative paths are not allowed. Use either a simple name (e.g., '${customCliName.split('/').pop() || 'cli'}') or an absolute path (e.g., '/tmp/${customCliName.split('/').pop() || 'cli'}-test')`;
  }

  return null;
}

function inspectCliBinary(options: {
  envVarName: string;
  customCliName: string | undefined;
  defaultCliName: string;
  localInstallPath: string;
}): CliBinaryStatus {
  const configuredCommand = options.customCliName || options.defaultCliName;

  if (options.customCliName) {
    const validationError = validateCustomCliName(options.envVarName, options.customCliName);
    if (validationError) {
      return {
        configuredCommand,
        resolvedPath: null,
        available: false,
        lookup: 'env',
        error: validationError,
      };
    }

    if (path.isAbsolute(options.customCliName)) {
      return {
        configuredCommand,
        resolvedPath: options.customCliName,
        available: isExecutableFile(options.customCliName),
        lookup: 'env',
      };
    }

    const resolvedPath = findExecutableOnPath(configuredCommand);
    return {
      configuredCommand,
      resolvedPath,
      available: resolvedPath !== null,
      lookup: 'env',
    };
  }

  if (isExecutableFile(options.localInstallPath)) {
    return {
      configuredCommand,
      resolvedPath: options.localInstallPath,
      available: true,
      lookup: 'local',
    };
  }

  const resolvedPath = findExecutableOnPath(configuredCommand);
  return {
    configuredCommand,
    resolvedPath,
    available: resolvedPath !== null,
    lookup: 'path',
  };
}

function getCliCommandOrThrow(status: CliBinaryStatus): string {
  if (status.error) {
    throw new Error(status.error);
  }

  if (status.lookup === 'env' && !path.isAbsolute(status.configuredCommand)) {
    return status.configuredCommand;
  }

  return status.resolvedPath || status.configuredCommand;
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

type CliBinaryName = 'claude' | 'codex' | 'gemini';

function getCliBinaryConfig(name: CliBinaryName): {
  envVarName: string;
  customCliName: string | undefined;
  defaultCliName: string;
  localInstallPath: string;
} {
  if (name === 'claude') {
    return {
      envVarName: 'CLAUDE_CLI_NAME',
      customCliName: process.env.CLAUDE_CLI_NAME,
      defaultCliName: 'claude',
      localInstallPath: join(homedir(), '.claude', 'local', 'claude'),
    };
  }

  if (name === 'codex') {
    return {
      envVarName: 'CODEX_CLI_NAME',
      customCliName: process.env.CODEX_CLI_NAME,
      defaultCliName: 'codex',
      localInstallPath: join(homedir(), '.codex', 'local', 'codex'),
    };
  }

  return {
    envVarName: 'GEMINI_CLI_NAME',
    customCliName: process.env.GEMINI_CLI_NAME,
    defaultCliName: 'gemini',
    localInstallPath: join(homedir(), '.gemini', 'local', 'gemini'),
  };
}

function getCliBinaryStatus(name: CliBinaryName): CliBinaryStatus {
  return inspectCliBinary(getCliBinaryConfig(name));
}

export function getCliDoctorStatus(): {
  claude: CliBinaryStatus;
  codex: CliBinaryStatus;
  gemini: CliBinaryStatus;
} {
  return {
    claude: getCliBinaryStatus('claude'),
    codex: getCliBinaryStatus('codex'),
    gemini: getCliBinaryStatus('gemini'),
  };
}

/**
 * Determine the Gemini CLI command/path.
 * Similar to findClaudeCli but for Gemini
 */
export function findGeminiCli(): string {
  debugLog('[Debug] Attempting to find Gemini CLI...');
  const status = getCliBinaryStatus('gemini');
  return getCliCommandOrThrow(status);
}

/**
 * Determine the Codex CLI command/path.
 * Similar to findClaudeCli but for Codex
 */
export function findCodexCli(): string {
  debugLog('[Debug] Attempting to find Codex CLI...');
  const status = getCliBinaryStatus('codex');
  return getCliCommandOrThrow(status);
}

/**
 * Determine the Claude CLI command/path.
 * 1. Checks for CLAUDE_CLI_NAME environment variable:
 *    - If absolute path, uses it directly
 *    - If relative path, throws error
 *    - If simple name, continues with path resolution
 * 2. Checks for Claude CLI at the local user path: ~/.claude/local/claude.
 * 3. If not found, defaults to the CLI name (or 'claude'), relying on the system's PATH for lookup.
 */
export function findClaudeCli(): string {
  debugLog('[Debug] Attempting to find Claude CLI...');
  const status = getCliBinaryStatus('claude');
  return getCliCommandOrThrow(status);
}
