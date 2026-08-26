declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process';

  function crossSpawn(command: string, args: string[], options: SpawnOptions): ChildProcess;

  export default crossSpawn;
}
