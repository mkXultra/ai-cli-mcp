import type { AgentType, ProcessStatus } from './process-service.js';

interface ProcessResultContext {
  pid: number;
  agent: AgentType;
  status: ProcessStatus;
  exitCode?: number;
  startTime: string;
  workFolder: string;
  prompt: string;
  model?: string;
  stdout: string;
  stderr: string;
}

function compactAgentOutput(agentOutput: any): any | null {
  if (!agentOutput || typeof agentOutput !== 'object') {
    return null;
  }

  const { tools: _tools, ...rest } = agentOutput;
  const compact = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== null));
  return Object.keys(compact).length > 0 ? compact : null;
}

function hasMeaningfulParsedOutput(agentOutput: any): boolean {
  if (!agentOutput || typeof agentOutput !== 'object') {
    return false;
  }

  return Object.entries(agentOutput).some(([key, value]) => {
    if (value === undefined || value === null) {
      return false;
    }

    if (key === 'session_id') {
      return false;
    }

    if (key === 'tools') {
      return Array.isArray(value) ? value.length > 0 : true;
    }

    return true;
  });
}

function shouldPreserveRawFailureOutput(context: ProcessResultContext): boolean {
  return context.agent === 'opencode' && context.status === 'failed';
}

export function buildProcessResult(context: ProcessResultContext, agentOutput: any, verbose = false): any {
  const response: any = {
    pid: context.pid,
    agent: context.agent,
    status: context.status,
    exitCode: context.exitCode ?? null,
    model: context.model ?? null,
  };

  if (verbose) {
    response.startTime = context.startTime;
    response.workFolder = context.workFolder;
    response.prompt = context.prompt;
  }

  if (agentOutput?.session_id) {
    response.session_id = agentOutput.session_id;
  }

  const shapedAgentOutput = verbose ? agentOutput : compactAgentOutput(agentOutput);
  const preserveRawFailureOutput = shouldPreserveRawFailureOutput(context);

  if (hasMeaningfulParsedOutput(shapedAgentOutput) && (verbose || !preserveRawFailureOutput)) {
    response.agentOutput = shapedAgentOutput;
  }

  if (!response.agentOutput || preserveRawFailureOutput) {
    response.stdout = context.stdout;
    response.stderr = context.stderr;
  }

  if (verbose && preserveRawFailureOutput && hasMeaningfulParsedOutput(shapedAgentOutput)) {
    response.agentOutput = shapedAgentOutput;
  }

  return response;
}
