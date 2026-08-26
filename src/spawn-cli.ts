import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crossSpawn from 'cross-spawn';
import { resolveCliCommandOnPath } from './cli-utils.js';

function getEnvironmentPath(env: NodeJS.ProcessEnv | undefined): string | undefined {
  const source = env || process.env;
  const pathKey = Object.keys(source).reverse().find((key) => key.toUpperCase() === 'PATH');
  return pathKey ? source[pathKey] : process.env.PATH;
}

function getSpawnCwd(options: SpawnOptions): string {
  if (!options.cwd) {
    return process.cwd();
  }
  const cwd = typeof options.cwd === 'string' ? options.cwd : fileURLToPath(options.cwd);
  return isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
}

function resolveWindowsCommand(command: string, options: SpawnOptions): string {
  const isBareCommand = !/[\\/]/.test(command);
  if (isBareCommand) {
    const resolvedPath = resolveCliCommandOnPath(command, {
      path: getEnvironmentPath(options.env),
      pathBaseDirectory: getSpawnCwd(options),
      searchDirectories: [getSpawnCwd(options)],
    });
    if (resolvedPath) {
      return resolvedPath;
    }
  } else {
    const resolvedCommand = isAbsolute(command) ? command : resolve(getSpawnCwd(options), command);
    try {
      accessSync(resolvedCommand, constants.X_OK);
      return resolvedCommand;
    } catch {
    }
  }

  throw Object.assign(new Error(`spawn ${command} ENOENT`), {
    code: 'ENOENT',
    errno: 'ENOENT',
    syscall: `spawn ${command}`,
    path: command,
  });
}

export function spawnCli(command: string, args: string[], options: SpawnOptions): ChildProcess {
  if (process.platform === 'win32') {
    return crossSpawn(resolveWindowsCommand(command, options), args, options);
  }
  return spawn(command, args, options);
}
