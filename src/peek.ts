import type { PeekEvent, PeekMessage } from './parsers.js';
import type { AgentType, ProcessStatus } from './process-service.js';

export const DEFAULT_PEEK_TIME_SEC = 10;
export const MAX_PEEK_TIME_SEC = 60;
export const MAX_PEEK_PIDS = 32;
export const PEEK_MESSAGE_CAP = 50;

export type PeekStatus = ProcessStatus | 'not_found';
export type PeekAgent = AgentType | string | null;

export interface PeekProcessResult {
  pid: number;
  agent: PeekAgent;
  status: PeekStatus;
  events: PeekEvent[];
  truncated: boolean;
  error: string | null;
}

export interface PeekResponse {
  peek_started_at: string;
  observed_duration_sec: number;
  processes: PeekProcessResult[];
}

export function validatePeekPids(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Missing or invalid required parameter: pids (must be an array of positive safe integers)');
  }

  const deduped: number[] = [];
  const seen = new Set<number>();

  for (const pid of value) {
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error('All pids must be positive safe integers');
    }

    if (!seen.has(pid)) {
      seen.add(pid);
      deduped.push(pid);
    }
  }

  if (deduped.length === 0 || deduped.length > MAX_PEEK_PIDS) {
    throw new Error(`pids must contain 1..${MAX_PEEK_PIDS} entries after dedupe`);
  }

  return deduped;
}

export function validatePeekTimeSec(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_PEEK_TIME_SEC;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_PEEK_TIME_SEC) {
    throw new Error(`peek_time_sec must be a positive integer no greater than ${MAX_PEEK_TIME_SEC}`);
  }

  return value;
}

export function buildNotFoundPeekProcess(pid: number): PeekProcessResult {
  return {
    pid,
    agent: null,
    status: 'not_found',
    events: [],
    truncated: false,
    error: 'process not found',
  };
}

export function appendPeekEvents(target: PeekProcessResult, events: PeekEvent[]): void {
  for (const event of events) {
    if (target.events.length < PEEK_MESSAGE_CAP) {
      target.events.push(event);
    } else {
      target.truncated = true;
    }
  }
}

export function appendPeekMessages(target: PeekProcessResult, messages: PeekMessage[]): void {
  appendPeekEvents(
    target,
    messages.map((message) => ({ kind: 'message' as const, ...message })),
  );
}

export function observedDurationSec(startedAtMs: number, endedAtMs = Date.now()): number {
  return Number(((endedAtMs - startedAtMs) / 1000).toFixed(2));
}
