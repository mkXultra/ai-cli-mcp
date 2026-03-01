import { existsSync } from 'node:fs';
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

/**
 * Determine the Gemini CLI command/path.
 * Similar to findClaudeCli but for Gemini
 */
export function findGeminiCli(): string {
  debugLog('[Debug] Attempting to find Gemini CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.GEMINI_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Gemini CLI name from GEMINI_CLI_NAME: ${customCliName}`);

    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] GEMINI_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }

    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid GEMINI_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'gemini') or an absolute path (e.g., '/tmp/gemini-test')`);
    }
  }

  const cliName = customCliName || 'gemini';

  // Try local install path: ~/.gemini/local/gemini
  const userPath = join(homedir(), '.gemini', 'local', 'gemini');
  debugLog(`[Debug] Checking for Gemini CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Gemini CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Gemini CLI not found at local user path: ${userPath}.`);
  }

  // Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Gemini CLI not found at ~/.gemini/local/gemini. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}

/**
 * Determine the Codex CLI command/path.
 * Similar to findClaudeCli but for Codex
 */
export function findCodexCli(): string {
  debugLog('[Debug] Attempting to find Codex CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.CODEX_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Codex CLI name from CODEX_CLI_NAME: ${customCliName}`);

    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] CODEX_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }

    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid CODEX_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'codex') or an absolute path (e.g., '/tmp/codex-test')`);
    }
  }

  const cliName = customCliName || 'codex';

  // Try local install path: ~/.codex/local/codex
  const userPath = join(homedir(), '.codex', 'local', 'codex');
  debugLog(`[Debug] Checking for Codex CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Codex CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Codex CLI not found at local user path: ${userPath}.`);
  }

  // Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Codex CLI not found at ~/.codex/local/codex. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
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

  // Check for custom CLI name from environment variable
  const customCliName = process.env.CLAUDE_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Claude CLI name from CLAUDE_CLI_NAME: ${customCliName}`);

    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] CLAUDE_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }

    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid CLAUDE_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'claude') or an absolute path (e.g., '/tmp/claude-test')`);
    }
  }

  const cliName = customCliName || 'claude';

  // Try local install path: ~/.claude/local/claude (using the original name for local installs)
  const userPath = join(homedir(), '.claude', 'local', 'claude');
  debugLog(`[Debug] Checking for Claude CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Claude CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Claude CLI not found at local user path: ${userPath}.`);
  }

  // 3. Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Claude CLI not found at ~/.claude/local/claude. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}
