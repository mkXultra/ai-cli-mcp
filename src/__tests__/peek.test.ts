import { describe, expect, it } from 'vitest';
import { appendPeekEvents, validatePeekPids, validatePeekTimeSec, type PeekProcessResult } from '../peek.js';

describe('peek helpers', () => {
  it('dedupes pids while preserving first occurrence order', () => {
    expect(validatePeekPids([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
  });

  it('validates pid and time limits', () => {
    expect(() => validatePeekPids([])).toThrow(/1..32/);
    expect(() => validatePeekPids([1.5])).toThrow(/positive safe integers/);
    expect(() => validatePeekPids([Number.MAX_SAFE_INTEGER + 1])).toThrow(/positive safe integers/);
    expect(validatePeekTimeSec(undefined)).toBe(10);
    expect(validatePeekTimeSec(60)).toBe(60);
    expect(() => validatePeekTimeSec(0)).toThrow(/positive integer/);
    expect(() => validatePeekTimeSec(1.5)).toThrow(/positive integer/);
    expect(() => validatePeekTimeSec(61)).toThrow(/positive integer/);
  });

  it('keeps the first 50 events and marks truncation when later events are dropped', () => {
    const process: PeekProcessResult = {
      pid: 123,
      agent: 'codex',
      status: 'running',
      events: [],
      truncated: false,
      error: null,
    };

    appendPeekEvents(
      process,
      Array.from({ length: 55 }, (_, index) => ({
        kind: 'message' as const,
        ts: '2026-04-11T12:34:56.789Z',
        text: `message ${index}`,
      })),
    );

    expect(process.events).toHaveLength(50);
    expect(process.events[0]).toMatchObject({ kind: 'message', text: 'message 0' });
    expect(process.events[49]).toMatchObject({ kind: 'message', text: 'message 49' });
    expect(process.truncated).toBe(true);
  });
});
