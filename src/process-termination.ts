import { spawnSync } from 'node:child_process';

export interface TerminationResult {
  terminated: boolean;
  warning?: string;
}

function processTable(): Array<{ pid: number; ppid: number; state: string }> {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Cannot inspect process tree for cancellation');
  return result.stdout.trim().split('\n').map((line) => {
    const [pid, ppid, state] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), state };
  });
}

// Only callers that created a dedicated process group may enable group signals.
// Grok terminal tools can create other groups; snapshot those descendants while
// their parent relationships are still available, before stopping the CLI.
export async function terminateProcessTree(pid: number, options: {
  ownedProcessGroup?: boolean;
  hasExited?: () => boolean;
  // Called synchronously after the first successful signal, before awaiting exit.
  onSignalSent?: () => void;
} = {}): Promise<TerminationResult> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) {
    throw new Error('Refusing to terminate an invalid or host PID');
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore', windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error(`Failed to terminate process tree ${pid}`);
    options.onSignalSent?.();
    return { terminated: true };
  }

  let warning: string | undefined;
  const inspect = () => {
    if (warning) return undefined;
    try {
      return processTable();
    } catch {
      warning = 'Process table unavailable; cancellation is limited to known PIDs and the owned process group. Descendants in other process groups may survive.';
      return undefined;
    }
  };
  const table = inspect() || [];
  const targets = new Set([pid]);
  let previousSize = 0;
  while (previousSize !== targets.size) {
    previousSize = targets.size;
    for (const entry of table) {
      if (targets.has(entry.ppid)) targets.add(entry.pid);
    }
  }
  let signalSent = false;
  const signal = (target: number, value: NodeJS.Signals | 0): boolean => {
    try {
      process.kill(target, value);
    } catch (error: any) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
    if (value !== 0 && !signalSent) {
      signalSent = true;
      options.onSignalSent?.();
    }
    return true;
  };
  if (options.ownedProcessGroup) signal(-pid, 'SIGTERM');
  for (const target of [...targets].reverse()) signal(target, 'SIGTERM');
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = inspect();
    const alive = current
      ? current.filter((entry) => targets.has(entry.pid) && !entry.state.startsWith('Z')).map((entry) => entry.pid)
      : [...targets].filter((target) => !(target === pid && options.hasExited?.()) && signal(target, 0));
    // Without ps, also check the owned group so a TERM-resistant child still
    // receives escalation after its parent exits. Never signal the host's group.
    const groupAlive = !current && options.ownedProcessGroup && signal(-pid, 0);
    if (alive.length === 0 && !groupAlive) return { terminated: true, ...(warning ? { warning } : {}) };
    if (attempt === 20) {
      if (groupAlive) signal(-pid, 'SIGKILL');
      for (const target of alive) signal(target, 'SIGKILL');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { terminated: false, ...(warning ? { warning } : {}) };
}
