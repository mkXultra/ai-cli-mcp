import { describe, expect, it } from 'vitest';
import { parseAntigravityOutput, PeekEventExtractor } from '../parsers.js';

const ts = '2026-09-17T00:00:00Z';
const init = { event: 'init', conversation_id: 'c1' };
const step = (step_index: number, data: Record<string, unknown>) => ({
  event: 'step_update', step_update: { conversation_id: 'c1', step_index, ...data },
});
const ndjson = (...events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const response = (text_delta: string, state = 'ACTIVE') => ({ step_type: 'agent_response', state, text_delta });
const result = (data: Record<string, unknown> = {}) => ({ event: 'result', result: {
  conversation_id: 'c1', status: 'SUCCESS', response: '回答完了\n',
  usage: { total_tokens: 42 }, duration_seconds: 1.5, num_turns: 1, ...data,
} });

describe('Antigravity results', () => {
  it('prefers the canonical result and preserves the conversation, stats and verbose tools', () => {
    const parsed = parseAntigravityOutput(ndjson(init,
      step(0, { step_type: 'user_input', text_delta: 'PRIVATE_USER' }),
      step(1, response('途中')),
      step(2, { step_type: 'tool', state: 'ACTIVE', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'pwd' } } }),
      step(2, { step_type: 'tool', state: 'DONE', tool_info: { output: 'PRIVATE_OUTPUT' } }),
      result(),
    ));
    expect(parsed).toMatchObject({ message: '回答完了\n', session_id: 'c1', status: 'SUCCESS', is_error: false,
      stats: { duration_seconds: 1.5, num_turns: 1, usage: { total_tokens: 42 } },
      tools: [{ tool: 'run_command', input: { CommandLine: 'pwd' }, output: 'PRIVATE_OUTPUT', status: 'success' }],
    });
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE_USER');
  });

  it('joins incremental text by step and retains partial text on failure', () => {
    const stream = ndjson(init, step(1, response('Earlier', 'DONE')),
      step(2, response('Part ')), step(2, response('two')),
      step(3, { step_type: 'thinking', text_delta: 'PRIVATE_THINKING' }));
    expect(parseAntigravityOutput(stream + '{"incomplete"')).toMatchObject({ message: 'Part two', session_id: 'c1' });
    expect(parseAntigravityOutput(stream + ndjson(result({ response: '', status: 'ERROR', error: 'quota' }))))
      .toMatchObject({ message: 'Part two', is_error: true, error: 'quota' });
  });

  it('normalizes result-only JSON, failed startup and tool errors', () => {
    expect(parseAntigravityOutput(JSON.stringify(result().result))).toMatchObject({ message: '回答完了\n', session_id: 'c1' });
    expect(parseAntigravityOutput(ndjson(result({ conversation_id: '', response: '', status: 'ERROR', error: 'bad model' }))))
      .toMatchObject({ session_id: null, is_error: true, error: 'bad model' });
    expect(parseAntigravityOutput(ndjson(step(1, { step_type: 'tool', state: 'DONE', tool_info: { name: 'run_command', error: { type: 'failed', message: 'denied' } } }))).tools[0])
      .toMatchObject({ tool: 'run_command', status: 'failed', error: { message: 'denied' } });
    expect(parseAntigravityOutput('diagnostic only')).toBeNull();
    expect(parseAntigravityOutput('{"type":"message","role":"assistant","content":"legacy"}')).toBeNull();
  });
});

describe('Antigravity peek', () => {
  it('handles fragmented lines, DONE-only text and suppresses duplicate result text', () => {
    const extractor = new PeekEventExtractor('gemini');
    const stream = ndjson(init, step(1, response('開始。', 'DONE')), step(2, response('回答')), step(2, response('完了\n', 'DONE')), result());
    const events = [...stream].flatMap(char => extractor.push(char, ts));
    expect([...events, ...extractor.flush(ts)]).toEqual([
      { kind: 'message', ts, text: '開始。' }, { kind: 'message', ts, text: '回答完了\n' },
    ]);
  });

  it('flushes an in-progress answer at the observation boundary and ignores private content', () => {
    const extractor = new PeekEventExtractor('gemini');
    expect(extractor.push(ndjson(init,
      step(0, { step_type: 'user_input', text_delta: 'PRIVATE_USER' }),
      step(1, { step_type: 'thinking', text_delta: 'PRIVATE_THINKING' }),
      step(2, { step_type: 'tool', state: 'DONE', tool_info: { output: 'PRIVATE_OUTPUT' } }),
      step(3, { ...response('PRIVATE_SUBAGENT'), conversation_id: 'child' }),
      step(4, response('部分')), step(4, response('回答')),
    ), ts)).toEqual([]);
    expect(extractor.flush(ts)).toEqual([{ kind: 'message', ts, text: '部分回答' }]);
    expect(extractor.flush(ts)).toEqual([]);
    const stderr = new PeekEventExtractor('gemini', { source: 'stderr', includeToolCalls: true });
    expect(stderr.push(ndjson(step(1, response('PRIVATE_STDERR', 'DONE'))), ts)).toEqual([]);
  });

  it('emits one tool event per phase, retains a bounded command summary and hides raw output', () => {
    const extractor = new PeekEventExtractor('gemini', { includeToolCalls: true });
    const active = step(2, { step_type: 'tool', state: 'ACTIVE', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'echo ' + 'x'.repeat(250), private: 'PRIVATE_INPUT' } } });
    const done = step(2, { step_type: 'tool', state: 'DONE', duration_seconds: 0.125, tool_info: { output: 'PRIVATE_OUTPUT', error: { message: 'PRIVATE_ERROR' } } });
    const events = extractor.push(ndjson(init, active, active, done, done), ts);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ phase: 'started', tool: 'run_command', summary_truncated: true });
    expect(events[1]).toMatchObject({ phase: 'completed', tool: 'run_command', status: 'failed', duration_ms: 125, summary_truncated: true });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
  });

  it('does not replay final result text outside the observed message stream', () => {
    const extractor = new PeekEventExtractor('gemini');
    expect(extractor.push(ndjson(result()), ts)).toEqual([]);
  });
});
