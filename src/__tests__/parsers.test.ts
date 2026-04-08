import { describe, it, expect } from 'vitest';
import { parseCodexOutput, parseClaudeOutput, parseForgeOutput, parseOpenCodeOutput } from '../parsers.js';

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
