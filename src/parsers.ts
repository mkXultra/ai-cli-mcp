import { debugLog } from './cli-utils.js';

export interface PeekMessage {
  ts: string;
  text: string;
}

type PeekAgent = 'claude' | 'codex' | string | null;

function isGeminiAssistantMessageEvent(parsed: any): boolean {
  return parsed.type === 'message' && parsed.role === 'assistant' && typeof parsed.content === 'string';
}

const GEMINI_STREAM_EVENT_TYPES = new Set([
  'init',
  'message',
  'tool_use',
  'tool_result',
  'result',
  'error',
  'stats',
]);

function isGeminiStreamJsonEvent(parsed: any): boolean {
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && GEMINI_STREAM_EVENT_TYPES.has(parsed.type);
}

function extractPeekMessagesFromParsedEvent(agent: PeekAgent, parsed: any, observedAt: string): PeekMessage[] {
  if (agent === 'codex') {
    if (parsed.item?.type === 'agent_message' && typeof parsed.item.text === 'string' && parsed.item.text.trim()) {
      return [{ ts: observedAt, text: parsed.item.text }];
    }
    if (parsed.msg?.type === 'agent_message' && typeof parsed.msg.message === 'string' && parsed.msg.message.trim()) {
      return [{ ts: observedAt, text: parsed.msg.message }];
    }
    return [];
  }

  if (agent === 'claude' && parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
    return parsed.message.content
      .filter((content: any) => content?.type === 'text' && typeof content.text === 'string' && content.text.trim())
      .map((content: any) => ({ ts: observedAt, text: content.text }));
  }

  if (agent === 'opencode' && parsed.type === 'text' && parsed.part?.type === 'text' && typeof parsed.part.text === 'string' && parsed.part.text.trim()) {
    return [{ ts: observedAt, text: parsed.part.text }];
  }

  return [];
}

export class PeekMessageExtractor {
  private pending = '';
  private geminiAssistantBuffer = '';

  constructor(private readonly agent: PeekAgent) {}

  push(chunk: string, observedAt = new Date().toISOString()): PeekMessage[] {
    if (!chunk) {
      return [];
    }

    const lines = `${this.pending}${chunk}`.split(/\r?\n/);
    this.pending = lines.pop() || '';
    return this.extractLines(lines, observedAt);
  }

  flush(observedAt = new Date().toISOString()): PeekMessage[] {
    const messages: PeekMessage[] = [];

    if (this.pending) {
      const line = this.pending;
      this.pending = '';
      messages.push(...this.extractLines([line], observedAt));
    }

    messages.push(...this.flushGeminiAssistantBuffer(observedAt));
    return messages;
  }

  private extractLines(lines: string[], observedAt: string): PeekMessage[] {
    const messages: PeekMessage[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        messages.push(...this.extractParsedEvent(JSON.parse(line), observedAt));
      } catch {
        debugLog(`[Debug] Skipping invalid peek JSON line: ${line}`);
        messages.push(...this.flushGeminiAssistantBuffer(observedAt));
      }
    }

    return messages;
  }

  private extractParsedEvent(parsed: any, observedAt: string): PeekMessage[] {
    if (this.agent !== 'gemini') {
      return extractPeekMessagesFromParsedEvent(this.agent, parsed, observedAt);
    }

    if (isGeminiAssistantMessageEvent(parsed)) {
      this.geminiAssistantBuffer += parsed.content;
      return [];
    }

    return this.flushGeminiAssistantBuffer(observedAt);
  }

  private flushGeminiAssistantBuffer(observedAt: string): PeekMessage[] {
    if (this.agent !== 'gemini' || !this.geminiAssistantBuffer) {
      return [];
    }

    const text = this.geminiAssistantBuffer;
    this.geminiAssistantBuffer = '';

    if (!text.trim()) {
      return [];
    }

    return [{ ts: observedAt, text }];
  }
}

export function parseCodexOutput(stdout: string): any {
  if (!stdout) return null;

  try {
    const lines = stdout.trim().split('\n');
    let lastMessage = null;
    let tokenCount = null;
    let threadId = null;
    const tools: any[] = [];

    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'thread.started' && parsed.thread_id) {
            threadId = parsed.thread_id;
          } else if (parsed.item?.type === 'agent_message') {
            lastMessage = parsed.item.text;
          } else if (parsed.msg?.type === 'agent_message') {
            lastMessage = parsed.msg.message;
          } else if (parsed.item?.type === 'reasoning') {
          } else if (parsed.msg?.type === 'token_count') {
            tokenCount = parsed.msg;
          } else if (parsed.type === 'item.completed' && parsed.item?.type === 'mcp_tool_call') {
            tools.push({
              server: parsed.item.server,
              tool: parsed.item.tool,
              input: parsed.item.arguments,
              output: parsed.item.result
            });
          } else if (parsed.type === 'item.completed' && parsed.item?.type === 'command_execution') {
            tools.push({
              tool: 'command_execution',
              input: { command: parsed.item.command },
              output: parsed.item.aggregated_output,
              exit_code: parsed.item.exit_code
            });
          }
        } catch (e) {
          debugLog(`[Debug] Skipping invalid JSON line: ${line}`);
        }
      }
    }

    if (lastMessage || tokenCount || threadId || tools.length > 0) {
      return {
        message: lastMessage,
        token_count: tokenCount,
        session_id: threadId,
        tools: tools.length > 0 ? tools : undefined
      };
    }
  } catch (e) {
    debugLog(`[Debug] Failed to parse Codex NDJSON output: ${e}`);
  }

  return null;
}

export function parseClaudeOutput(stdout: string): any {
  if (!stdout) return null;

  try {
    return JSON.parse(stdout);
  } catch (e) {
  }

  try {
    const lines = stdout.trim().split('\n');
    let lastMessage = null;
    let sessionId = null;
    const toolsMap = new Map<string, any>();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        if (parsed.session_id) {
          sessionId = parsed.session_id;
        }

        if (parsed.type === 'result' && parsed.result) {
          lastMessage = parsed.result;
        }

        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === 'tool_use') {
              toolsMap.set(content.id, {
                tool: content.name,
                input: content.input,
                output: null
              });
            }
          }
        }

        if (parsed.type === 'user' && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === 'tool_result' && content.tool_use_id) {
              const tool = toolsMap.get(content.tool_use_id);
              if (tool) {
                if (Array.isArray(content.content)) {
                  const textContent = content.content.find((c: any) => c.type === 'text');
                  tool.output = textContent?.text || null;
                } else {
                  tool.output = content.content;
                }
              }
            }
          }
        }

      } catch (e) {
        debugLog(`[Debug] Skipping invalid JSON line in Claude output: ${line}`);
      }
    }

    const tools = Array.from(toolsMap.values());

    if (lastMessage || sessionId || tools.length > 0) {
      return {
        message: lastMessage,
        session_id: sessionId,
        tools: tools.length > 0 ? tools : undefined
      };
    }

  } catch (e) {
    debugLog(`[Debug] Failed to parse Claude NDJSON output: ${e}`);
    return null;
  }

  return null;
}

export function parseGeminiOutput(stdout: string): any {
  if (!stdout) return null;

  try {
    const parsed = JSON.parse(stdout.trim());
    if (!isGeminiStreamJsonEvent(parsed)) {
      return parsed;
    }
  } catch (e) {
    debugLog(`[Debug] Failed to parse Gemini JSON output: ${e}`);
  }

  let sessionId: string | null = null;
  let assistantBuffer = '';
  let lastMessage: string | null = null;
  let stats: any = null;
  const toolsById = new Map<string, any>();
  const toolsWithoutId: any[] = [];
  const flushAssistantMessage = () => {
    if (assistantBuffer.trim()) {
      lastMessage = assistantBuffer;
    }
    assistantBuffer = '';
  };

  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      debugLog(`[Debug] Skipping invalid Gemini stream-json line: ${line}`);
      flushAssistantMessage();
      continue;
    }

    if (parsed.type === 'init' && typeof parsed.session_id === 'string' && parsed.session_id) {
      sessionId = parsed.session_id;
      continue;
    }

    if (isGeminiAssistantMessageEvent(parsed)) {
      assistantBuffer += parsed.content;
      continue;
    }

    flushAssistantMessage();

    if (parsed.type === 'result') {
      if (parsed.stats) {
        stats = parsed.stats;
      }
      continue;
    }

    if (parsed.type === 'tool_use') {
      const tool = {
        tool: parsed.tool_name || parsed.name || 'tool_use',
        input: parsed.parameters ?? parsed.input ?? null,
        output: null,
        status: null,
      };
      if (typeof parsed.tool_id === 'string' && parsed.tool_id) {
        toolsById.set(parsed.tool_id, tool);
      } else {
        toolsWithoutId.push(tool);
      }
      continue;
    }

    if (parsed.type === 'tool_result') {
      const toolId = typeof parsed.tool_id === 'string' ? parsed.tool_id : '';
      const tool = toolId ? toolsById.get(toolId) : null;
      if (tool) {
        tool.output = parsed.output ?? parsed.result ?? null;
        tool.status = parsed.status ?? null;
      } else {
        toolsWithoutId.push({
          tool: 'tool_result',
          input: null,
          output: parsed.output ?? parsed.result ?? null,
          status: parsed.status ?? null,
        });
      }
    }
  }

  flushAssistantMessage();
  const tools = [...toolsById.values(), ...toolsWithoutId];

  if (lastMessage || sessionId || stats || tools.length > 0) {
    return {
      message: lastMessage,
      session_id: sessionId,
      stats: stats || undefined,
      tools: tools.length > 0 ? tools : undefined,
    };
  }

  return null;
}

export function parseForgeOutput(stdout: string): any {
  if (!stdout) return null;

  const lines = stdout.split('\n');
  const markerPattern = /^● \[[^\]]+\] (Initialize|Continue|Finished) (\S+)\s*$/;
  let collecting = false;
  let currentConversationId: string | null = null;
  let currentBody: string[] = [];
  let lastConversationId: string | null = null;
  let lastMessage: string | null = null;

  for (const line of lines) {
    const match = line.match(markerPattern);
    if (match) {
      const [, action, conversationId] = match;
      lastConversationId = conversationId;

      if (action === 'Initialize' || action === 'Continue') {
        collecting = true;
        currentConversationId = conversationId;
        currentBody = [];
      } else if (collecting && currentConversationId === conversationId) {
        const message = currentBody.join('\n').trim();
        if (message) {
          lastMessage = message;
        }
        collecting = false;
        currentConversationId = null;
        currentBody = [];
      }
      continue;
    }

    if (collecting) {
      currentBody.push(line);
    }
  }

  if (collecting) {
    const message = currentBody.join('\n').trim();
    if (message) {
      lastMessage = message;
    }
    if (currentConversationId) {
      lastConversationId = currentConversationId;
    }
  }

  if (!lastMessage && !lastConversationId) {
    return null;
  }

  return {
    message: lastMessage,
    session_id: lastConversationId,
  };
}

export function parseOpenCodeOutput(stdout: string): any {
  if (!stdout) {
    return null;
  }

  let sessionId: string | null = null;
  let currentStepBuffer = '';
  let latestCompletedStep: {
    message: string;
    session_id?: string;
    tokens?: any;
    cost?: number;
  } | null = null;
  let hasStepFinish = false;
  let hasParseableAssistantText = false;

  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof parsed.sessionID === 'string' && parsed.sessionID) {
      sessionId = parsed.sessionID;
    }

    if (parsed.type === 'step_start') {
      currentStepBuffer = '';
      continue;
    }

    if (parsed.type === 'text' && parsed.part?.type === 'text' && typeof parsed.part.text === 'string') {
      currentStepBuffer += parsed.part.text;
      hasParseableAssistantText = true;
      continue;
    }

    if (parsed.type === 'step_finish') {
      hasStepFinish = true;
      latestCompletedStep = {
        message: currentStepBuffer,
        session_id: sessionId || undefined,
        tokens: parsed.part?.tokens,
        cost: parsed.part?.cost,
      };
    }
  }

  if (hasStepFinish && latestCompletedStep) {
    return latestCompletedStep;
  }

  if (hasParseableAssistantText) {
    return {
      message: currentStepBuffer,
      session_id: sessionId || undefined,
    };
  }

  return null;
}
