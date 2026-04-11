import { describe, it, expect } from 'vitest';
import { parseCodexOutput, parseClaudeOutput, parseForgeOutput, parseGeminiOutput, parseOpenCodeOutput, PeekMessageExtractor } from '../parsers.js';

describe('parseCodexOutput', () => {
  it('should parse basic Codex output with message and session_id', () => {
    const output = `
{"type":"thread.started","thread_id":"test-session-id"}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"Hello world"}}
{"type":"turn.completed"}
`;
    const result = parseCodexOutput(output);
    expect(result).toEqual({
      message: "Hello world",
      session_id: "test-session-id",
      token_count: null,
      tools: undefined
    });
  });

  it('should extract MCP tool calls', () => {
    const output = `
{"type":"thread.started","thread_id":"tool-test-id"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"acm","tool":"run","arguments":{"model":"gemini-2.5-flash","prompt":"hi"},"result":{"content":[{"text":"started","type":"text"}]},"status":"completed"}}
{"type":"item.completed","item":{"type":"agent_message","text":"Tool executed"}}
{"type":"turn.completed"}
`;
    const result = parseCodexOutput(output);
    
    expect(result.message).toBe("Tool executed");
    expect(result.session_id).toBe("tool-test-id");
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toEqual({
      tool: "run",
      server: "acm",
      input: { model: "gemini-2.5-flash", prompt: "hi" },
      output: { content: [{ text: "started", type: "text" }] }
    });
  });

  it('should handle multiple tool calls', () => {
    const output = `
{"type":"item.completed","item":{"type":"mcp_tool_call","tool":"tool1","arguments":{"arg":1},"result":"res1"}}
{"type":"item.completed","item":{"type":"mcp_tool_call","tool":"tool2","arguments":{"arg":2},"result":"res2"}}
`;
    const result = parseCodexOutput(output);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].tool).toBe("tool1");
    expect(result.tools[1].tool).toBe("tool2");
  });

  it('should return null for empty input', () => {
    expect(parseCodexOutput("")).toBeNull();
  });

  it('should handle invalid JSON gracefully', () => {
    const output = `
{"type":"valid"}
INVALID_JSON
{"type":"item.completed","item":{"type":"agent_message","text":"Still parses valid lines"}}
`;
    const result = parseCodexOutput(output);
    expect(result.message).toBe("Still parses valid lines");
  });
});

describe('PeekMessageExtractor', () => {
  const ts = '2026-04-11T12:34:56.789Z';

  it('extracts only Codex agent_message text', () => {
    const extractor = new PeekMessageExtractor('codex');
    const output = [
      '{"type":"item.completed","item":{"type":"reasoning","text":"hidden"}}',
      '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"secret command output"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Visible Codex message"}}',
      '{"msg":{"type":"token_count","total":123}}',
      '{"msg":{"type":"agent_message","message":"Visible legacy Codex message"}}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([
      { ts, text: 'Visible Codex message' },
      { ts, text: 'Visible legacy Codex message' },
    ]);
  });

  it('extracts only Claude assistant text content', () => {
    const extractor = new PeekMessageExtractor('claude');
    const output = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Visible Claude text"},{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/tmp/a"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"secret"}]}}',
      '{"type":"result","result":"Final result is not peek assistant text"}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([
      { ts, text: 'Visible Claude text' },
    ]);
  });

  it('extracts only Gemini assistant message content', () => {
    const extractor = new PeekMessageExtractor('gemini');
    const output = [
      '{"type":"message","timestamp":"2026-04-11T14:44:42.294Z","role":"user","content":"hidden user text"}',
      '{"type":"message","timestamp":"2026-04-11T14:44:53.820Z","role":"assistant","content":"Visible Gemini text","delta":true}',
      '{"type":"tool_use","timestamp":"2026-04-11T14:44:53.821Z","tool_name":"run_shell_command","parameters":{"command":"echo secret"}}',
      '{"type":"tool_result","timestamp":"2026-04-11T14:45:03.011Z","status":"success","output":"secret command output"}',
      '{"type":"result","timestamp":"2026-04-11T14:45:10.380Z","status":"success","response":"Final result is not peek assistant text"}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([
      { ts, text: 'Visible Gemini text' },
    ]);
  });

  it('joins split Gemini assistant chunks into one peek message on flush', () => {
    const extractor = new PeekMessageExtractor('gemini');
    const output = [
      '{"type":"message","timestamp":"2026-04-11T14:44:53.820Z","role":"assistant","content":"Step 2 done. Starting step ","delta":true}',
      '{"type":"message","timestamp":"2026-04-11T14:44:53.821Z","role":"assistant","content":"3.","delta":true}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([]);
    expect(extractor.flush('2026-04-11T12:34:59.000Z')).toEqual([
      { ts: '2026-04-11T12:34:59.000Z', text: 'Step 2 done. Starting step 3.' },
    ]);
  });

  it('emits separate Gemini peek messages when a boundary separates logical messages', () => {
    const extractor = new PeekMessageExtractor('gemini');
    const output = [
      '{"type":"message","timestamp":"2026-04-11T14:44:53.820Z","role":"assistant","content":"Starting step ","delta":true}',
      '{"type":"message","timestamp":"2026-04-11T14:44:53.821Z","role":"assistant","content":"1.","delta":true}',
      '{"type":"tool_use","timestamp":"2026-04-11T14:44:53.822Z","tool_name":"run_shell_command","parameters":{"command":"echo secret"}}',
      '{"type":"tool_result","timestamp":"2026-04-11T14:45:03.011Z","status":"success","output":"secret command output"}',
      '{"type":"message","timestamp":"2026-04-11T14:45:10.315Z","role":"assistant","content":"Final ","delta":true}',
      '{"type":"message","timestamp":"2026-04-11T14:45:10.316Z","role":"assistant","content":"answer.","delta":true}',
      '{"type":"result","timestamp":"2026-04-11T14:45:10.380Z","status":"success","response":"Final result response is not peek text","stats":{"total_tokens":21999}}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([
      { ts, text: 'Starting step 1.' },
      { ts, text: 'Final answer.' },
    ]);
    expect(extractor.flush(ts)).toEqual([]);
  });

  it('does not emit Gemini user, tool, tool result, stats, or result response text', () => {
    const extractor = new PeekMessageExtractor('gemini');
    const output = [
      '{"type":"message","timestamp":"2026-04-11T14:44:42.294Z","role":"user","content":"hidden user text"}',
      '{"type":"tool_use","timestamp":"2026-04-11T14:44:53.821Z","tool_name":"run_shell_command","parameters":{"command":"echo secret"}}',
      '{"type":"tool_result","timestamp":"2026-04-11T14:45:03.011Z","status":"success","output":"secret command output"}',
      '{"type":"result","timestamp":"2026-04-11T14:45:10.380Z","status":"success","response":"Final result response is not peek text","stats":{"total_tokens":21999}}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([]);
    expect(extractor.flush(ts)).toEqual([]);
  });

  it('denies unsupported agents and invalid shapes by default', () => {
    const extractor = new PeekMessageExtractor('forge');
    const output = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"not supported here"}]}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"not supported here"}}',
      '{"type":"text","part":{"type":"text","text":"not supported here"}}',
      '{"type":"message","role":"assistant","content":"not supported here"}',
      'plain stdout',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([]);
  });

  it('extracts only OpenCode natural-language text events', () => {
    const extractor = new PeekMessageExtractor('opencode');
    const output = [
      '{"type":"text","timestamp":1775918783605,"sessionID":"ses-1","part":{"type":"text","text":"OpenCode visible text"}}',
      '{"type":"tool_use","timestamp":1775918783606,"sessionID":"ses-1","part":{"type":"tool","state":{"output":"secret command output"},"metadata":{"output":"secret metadata output"}}}',
      '{"type":"text","timestamp":1775918783607,"sessionID":"ses-1","part":{"type":"tool","text":"wrong part type"}}',
    ].join('\n') + '\n';

    expect(extractor.push(output, ts)).toEqual([
      { ts, text: 'OpenCode visible text' },
    ]);
  });

  it('can flush a complete JSON event without a trailing newline', () => {
    const extractor = new PeekMessageExtractor('codex');
    expect(extractor.push('{"type":"item.completed","item":{"type":"agent_message","text":"pending"}}', ts)).toEqual([]);
    expect(extractor.flush(ts)).toEqual([{ ts, text: 'pending' }]);
  });
});

describe('parseGeminiOutput', () => {
  it('should parse legacy final JSON output', () => {
    const output = JSON.stringify({
      session_id: 'gemini-session-json',
      response: 'Legacy Gemini final response',
      stats: {
        total_tokens: 123,
      },
    });

    expect(parseGeminiOutput(output)).toEqual({
      session_id: 'gemini-session-json',
      response: 'Legacy Gemini final response',
      stats: {
        total_tokens: 123,
      },
    });
  });

  it('should normalize a single-line Gemini assistant stream event', () => {
    const output = '{"type":"message","timestamp":"2026-04-11T14:44:53.820Z","role":"assistant","content":"Only answer","delta":true}';

    const result = parseGeminiOutput(output);

    expect(result).toMatchObject({
      message: 'Only answer',
      session_id: null,
    });
    expect(result).not.toHaveProperty('type');
    expect(result).not.toHaveProperty('content');
  });

  it('should parse Gemini stream-json NDJSON output', () => {
    const output = [
      '{"type":"init","timestamp":"2026-04-11T14:44:42.293Z","session_id":"gemini-session-stream","model":"gemini-3.1-pro-preview"}',
      '{"type":"message","timestamp":"2026-04-11T14:44:42.294Z","role":"user","content":"hidden user text"}',
      '{"type":"message","timestamp":"2026-04-11T14:44:53.820Z","role":"assistant","content":"First logical assistant response.","delta":true}',
      '{"type":"tool_use","timestamp":"2026-04-11T14:44:53.821Z","tool_name":"run_shell_command","tool_id":"tool-1","parameters":{"command":"echo hidden"}}',
      '{"type":"tool_result","timestamp":"2026-04-11T14:45:03.011Z","tool_id":"tool-1","status":"success","output":"hidden command output"}',
      '{"type":"message","timestamp":"2026-04-11T14:45:10.315Z","role":"assistant","content":"Final assistant ","delta":true}',
      '{"type":"message","timestamp":"2026-04-11T14:45:10.316Z","role":"assistant","content":"response.","delta":true}',
      '{"type":"result","timestamp":"2026-04-11T14:45:10.380Z","status":"success","response":"Result response is not the parsed message","stats":{"total_tokens":21999}}',
    ].join('\n') + '\n';

    expect(parseGeminiOutput(output)).toEqual({
      message: 'Final assistant response.',
      session_id: 'gemini-session-stream',
      stats: {
        total_tokens: 21999,
      },
      tools: [
        {
          tool: 'run_shell_command',
          input: { command: 'echo hidden' },
          output: 'hidden command output',
          status: 'success',
        },
      ],
    });
  });
});

describe('parseClaudeOutput', () => {
  it('should parse legacy JSON output', () => {
    const output = JSON.stringify({
      content: [{ type: 'text', text: 'Hello' }]
    });
    const result = parseClaudeOutput(output);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Hello' }]
    });
  });

  it('should parse stream-json (NDJSON) output', () => {
    const output = `
{"type":"system","session_id":"test-claude-session"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Thinking..."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"mcp__acm__run","input":{"prompt":"hi"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_1","content":"done"}]}}
{"type":"result","result":"Final Answer","is_error":false}
`;
    const result = parseClaudeOutput(output);
    
    expect(result.message).toBe("Final Answer");
    expect(result.session_id).toBe("test-claude-session");
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toEqual({
      tool: "mcp__acm__run",
      input: { prompt: "hi" },
      output: "done"
    });
  });

  it('should handle invalid NDJSON lines gracefully', () => {
    const output = `
{"type":"system"}
INVALID_LINE
{"type":"result","result":"Success"}
`;
    const result = parseClaudeOutput(output);
    expect(result.message).toBe("Success");
  });
});

describe('parseForgeOutput', () => {
  it('should parse initialized forge output with a conversation id', () => {
    const output = `● [21:09:01] Initialize 123e4567-e89b-12d3-a456-426614174000
Hello from Forge
● [21:09:08] Finished 123e4567-e89b-12d3-a456-426614174000
`;

    expect(parseForgeOutput(output)).toEqual({
      message: 'Hello from Forge',
      session_id: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('should parse resumed forge output with multiline assistant content', () => {
    const output = `● [21:09:33] Continue conv-123
Line one

Line three
● [21:09:37] Finished conv-123
`;

    expect(parseForgeOutput(output)).toEqual({
      message: 'Line one\n\nLine three',
      session_id: 'conv-123',
    });
  });

  it('should return the current message while forge output is still in progress', () => {
    const output = `● [21:09:33] Continue conv-456
Partial answer
still streaming`;

    expect(parseForgeOutput(output)).toEqual({
      message: 'Partial answer\nstill streaming',
      session_id: 'conv-456',
    });
  });

  it('should return null for unrelated forge output', () => {
    expect(parseForgeOutput('plain text')).toBeNull();
  });
});

describe('parseOpenCodeOutput', () => {
  it('parses a single completed OpenCode step', () => {
    const output = `{"type":"step_start","sessionID":"ses_1"}
{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Hello"}}
{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","tokens":{"total":11833},"cost":0}}`;

    expect(parseOpenCodeOutput(output)).toEqual({
      message: 'Hello',
      session_id: 'ses_1',
      tokens: { total: 11833 },
      cost: 0,
    });
  });

  it('returns the last completed step for multi-step output', () => {
    const output = `{"type":"step_start","sessionID":"ses_2"}
{"type":"text","sessionID":"ses_2","part":{"type":"text","text":"First"}}
{"type":"step_finish","sessionID":"ses_2","part":{"type":"step-finish","tokens":{"total":10},"cost":0}}
{"type":"step_start","sessionID":"ses_2"}
{"type":"text","sessionID":"ses_2","part":{"type":"text","text":"Second"}}
{"type":"step_finish","sessionID":"ses_2","part":{"type":"step-finish","tokens":{"total":20},"cost":1}}`;

    expect(parseOpenCodeOutput(output)).toEqual({
      message: 'Second',
      session_id: 'ses_2',
      tokens: { total: 20 },
      cost: 1,
    });
  });

  it('resets the current-step buffer on each step_start', () => {
    const output = `{"type":"step_start","sessionID":"ses_3"}
{"type":"text","sessionID":"ses_3","part":{"type":"text","text":"Discard me"}}
{"type":"step_start","sessionID":"ses_3"}
{"type":"text","sessionID":"ses_3","part":{"type":"text","text":"Keep me"}}
{"type":"step_finish","sessionID":"ses_3","part":{"type":"step-finish","tokens":{"total":5},"cost":0}}`;

    expect(parseOpenCodeOutput(output)).toEqual({
      message: 'Keep me',
      session_id: 'ses_3',
      tokens: { total: 5 },
      cost: 0,
    });
  });

  it('returns partial output when text exists without step_finish', () => {
    const output = `{"type":"step_start","sessionID":"ses_4"}
{"type":"text","sessionID":"ses_4","part":{"type":"text","text":"Partial"}}`;

    expect(parseOpenCodeOutput(output)).toEqual({
      message: 'Partial',
      session_id: 'ses_4',
    });
  });

  it('ignores malformed lines and unknown event types', () => {
    const output = `not-json
{"type":"unknown","sessionID":"ses_5"}
{"type":"text","sessionID":"ses_5","part":{"type":"text","text":"Hello"}}`;

    expect(parseOpenCodeOutput(output)).toEqual({
      message: 'Hello',
      session_id: 'ses_5',
    });
  });

  it('returns null when no useful OpenCode events exist', () => {
    expect(parseOpenCodeOutput('{"type":"unknown"}')).toBeNull();
    expect(parseOpenCodeOutput('')).toBeNull();
  });
});
