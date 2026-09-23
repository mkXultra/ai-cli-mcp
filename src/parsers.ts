import { debugLog } from './cli-utils.js';

export interface PeekMessage {
  ts: string;
  text: string;
}

export type PeekToolCallStatus = 'success' | 'failed' | 'cancelled' | 'unknown';

export type PeekEvent =
  | { kind: 'message'; ts: string; text: string }
  | {
      kind: 'tool_call';
      ts: string;
      phase: 'started' | 'completed';
      tool: string;
      summary: string;
      id?: string;
      status?: PeekToolCallStatus;
      server?: string;
      exit_code?: number;
      duration_ms?: number;
      summary_truncated?: boolean;
    };

type PeekToolCallEvent = Extract<PeekEvent, { kind: 'tool_call' }>;

type PeekAgent = 'claude' | 'codex' | string | null;

interface PeekEventExtractorOptions {
  includeToolCalls?: boolean;
  source?: 'stdout' | 'stderr';
}

interface PeekFlushOptions {
  terminal?: boolean;
}

interface ToolSummary {
  summary: string;
  server?: string;
  summary_truncated?: boolean;
}

interface ToolCallMemory {
  tool: string;
  server?: string;
  summary: string;
  summary_truncated?: boolean;
}

const PEEK_TOOL_SUMMARY_MAX_LENGTH = 200;

function isAntigravityEvent(parsed: any): boolean {
  return parsed && typeof parsed === 'object' && (
    (parsed.event === 'init' && typeof parsed.conversation_id === 'string') ||
    (parsed.event === 'step_update' && parsed.step_update) ||
    (parsed.event === 'result' && parsed.result)
  );
}

function antigravityStepId(step: any): string {
  return `${step.conversation_id ?? ''}:${step.step_index}`;
}

function oneLine(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function boundedSummary(value: string): { summary: string; summary_truncated?: boolean } {
  const summary = oneLine(value);
  if (summary.length <= PEEK_TOOL_SUMMARY_MAX_LENGTH) {
    return { summary };
  }

  return {
    summary: `${summary.slice(0, PEEK_TOOL_SUMMARY_MAX_LENGTH - 3)}...`,
    summary_truncated: true,
  };
}

function normalizeMcpToolName(tool: string, explicitServer?: string): ToolSummary | null {
  if (explicitServer) {
    return {
      server: explicitServer,
      ...boundedSummary(`${explicitServer}.${tool}`),
    };
  }

  const mcpDouble = tool.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpDouble) {
    return {
      server: mcpDouble[1],
      ...boundedSummary(`${mcpDouble[1]}.${mcpDouble[2]}`),
    };
  }

  const mcpSingle = tool.match(/^mcp_([^_]+)_(.+)$/);
  if (mcpSingle) {
    return {
      server: mcpSingle[1],
      ...boundedSummary(`${mcpSingle[1]}.${mcpSingle[2]}`),
    };
  }

  const acmShort = tool.match(/^acm_(.+)$/);
  if (acmShort) {
    return {
      server: 'acm',
      ...boundedSummary(`acm.${acmShort[1]}`),
    };
  }

  return null;
}

function buildToolSummary(tool: string, options: { server?: string; command?: unknown } = {}): ToolSummary {
  if (typeof options.command === 'string' && options.command.trim()) {
    return boundedSummary(options.command);
  }

  const mcpSummary = normalizeMcpToolName(tool, options.server);
  if (mcpSummary) {
    return mcpSummary;
  }

  return boundedSummary(tool || 'tool_call');
}

function normalizeToolStatus(rawStatus: unknown, exitCode?: number, defaultStatus: PeekToolCallStatus = 'unknown'): PeekToolCallStatus {
  if (typeof exitCode === 'number') {
    return exitCode === 0 ? 'success' : 'failed';
  }

  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (['success', 'succeeded', 'ok', 'completed'].includes(status)) {
    return 'success';
  }
  if (['failed', 'failure', 'error', 'errored'].includes(status)) {
    return 'failed';
  }
  if (['cancelled', 'canceled'].includes(status)) {
    return 'cancelled';
  }
  return defaultStatus;
}

function createToolCallEvent(params: {
  ts: string;
  phase: 'started' | 'completed';
  tool: string;
  id?: string;
  server?: string;
  command?: unknown;
  status?: unknown;
  defaultStatus?: PeekToolCallStatus;
  exit_code?: number;
  duration_ms?: number;
}): PeekToolCallEvent {
  const tool = params.tool || 'tool_call';
  const summary = buildToolSummary(tool, { server: params.server, command: params.command });
  const event: PeekToolCallEvent = {
    kind: 'tool_call',
    ts: params.ts,
    phase: params.phase,
    tool,
    summary: summary.summary,
  };

  if (params.id) {
    event.id = params.id;
  }
  if (summary.server) {
    event.server = summary.server;
  } else if (params.server) {
    event.server = params.server;
  }
  if (summary.summary_truncated) {
    event.summary_truncated = true;
  }
  if (params.phase === 'completed') {
    event.status = normalizeToolStatus(params.status, params.exit_code, params.defaultStatus);
    if (typeof params.exit_code === 'number') {
      event.exit_code = params.exit_code;
    }
    if (typeof params.duration_ms === 'number' && Number.isFinite(params.duration_ms)) {
      event.duration_ms = params.duration_ms;
    }
  }

  return event;
}

function rememberToolCall(event: PeekEvent, memory: Map<string, ToolCallMemory>): void {
  if (event.kind !== 'tool_call' || !event.id) {
    return;
  }

  memory.set(event.id, {
    tool: event.tool,
    server: event.server,
    summary: event.summary,
    summary_truncated: event.summary_truncated,
  });
}

function createRememberedCompletion(params: {
  ts: string;
  id?: string;
  memory: Map<string, ToolCallMemory>;
  fallbackTool: string;
  status?: unknown;
  defaultStatus?: PeekToolCallStatus;
}): PeekEvent {
  const remembered = params.id ? params.memory.get(params.id) : undefined;
  const event = createToolCallEvent({
    ts: params.ts,
    phase: 'completed',
    id: params.id,
    tool: remembered?.tool || params.fallbackTool,
    server: remembered?.server,
    status: params.status,
    defaultStatus: params.defaultStatus,
  });

  if (remembered) {
    event.summary = remembered.summary;
    if (remembered.summary_truncated) {
      event.summary_truncated = true;
    }
  }

  return event;
}

function extractPeekEventsFromParsedEvent(agent: PeekAgent, parsed: any, observedAt: string, includeToolCalls: boolean, memory: Map<string, ToolCallMemory>): PeekEvent[] {
  if (agent === 'codex') {
    if (parsed.item?.type === 'agent_message' && typeof parsed.item.text === 'string' && parsed.item.text.trim()) {
      return [{ kind: 'message', ts: observedAt, text: parsed.item.text }];
    }
    if (parsed.msg?.type === 'agent_message' && typeof parsed.msg.message === 'string' && parsed.msg.message.trim()) {
      return [{ kind: 'message', ts: observedAt, text: parsed.msg.message }];
    }
    if (includeToolCalls && (parsed.type === 'item.started' || parsed.type === 'item.completed')) {
      const item = parsed.item;
      if (item?.type === 'command_execution') {
        const event = createToolCallEvent({
          ts: observedAt,
          phase: parsed.type === 'item.started' ? 'started' : 'completed',
          id: item.id,
          tool: 'command_execution',
          command: item.command,
          status: item.status || item.error,
          exit_code: typeof item.exit_code === 'number' ? item.exit_code : undefined,
          defaultStatus: parsed.type === 'item.completed' ? 'success' : 'unknown',
        });
        rememberToolCall(event, memory);
        return [event];
      }
      if (item?.type === 'mcp_tool_call') {
        const event = createToolCallEvent({
          ts: observedAt,
          phase: parsed.type === 'item.started' ? 'started' : 'completed',
          id: item.id,
          tool: item.tool || 'mcp_tool_call',
          server: item.server,
          status: item.status || item.error,
          defaultStatus: parsed.type === 'item.completed' ? 'success' : 'unknown',
        });
        rememberToolCall(event, memory);
        return [event];
      }
    }
    return [];
  }

  // Grok streaming-messages-json uses the same whole Messages events.
  if (agent === 'claude' || agent === 'grok') {
    if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
      const events: PeekEvent[] = [];
      for (const content of parsed.message.content) {
        if (content?.type === 'text' && typeof content.text === 'string' && content.text.trim()) {
          events.push({ kind: 'message', ts: observedAt, text: content.text });
        } else if (includeToolCalls && content?.type === 'tool_use') {
          const event = createToolCallEvent({
            ts: observedAt,
            phase: 'started',
            id: content.id,
            tool: content.name || 'tool_use',
            command: content.input?.command,
          });
          rememberToolCall(event, memory);
          events.push(event);
        }
      }
      return events;
    }
    if (includeToolCalls && parsed.type === 'user' && Array.isArray(parsed.message?.content)) {
      const events: PeekEvent[] = [];
      for (const content of parsed.message.content) {
        if (content?.type === 'tool_result') {
          events.push(createRememberedCompletion({
            ts: observedAt,
            id: content.tool_use_id,
            memory,
            fallbackTool: 'tool_result',
            status: content.is_error === true ? 'failed' : undefined,
            defaultStatus: content.is_error === true ? 'failed' : 'success',
          }));
        }
      }
      return events;
    }
    return [];
  }

  if (agent === 'opencode' && parsed.type === 'text' && parsed.part?.type === 'text' && typeof parsed.part.text === 'string' && parsed.part.text.trim()) {
    return [{ kind: 'message', ts: observedAt, text: parsed.part.text }];
  }

  if (agent === 'opencode' && includeToolCalls && parsed.type === 'tool_use' && parsed.part?.type === 'tool') {
    const state = parsed.part.state || {};
    const start = state.time?.start;
    const end = state.time?.end;
    const event = createToolCallEvent({
      ts: observedAt,
      phase: state.status === 'running' || state.status === 'pending' ? 'started' : 'completed',
      id: parsed.part.callID,
      tool: parsed.part.tool || 'tool_use',
      command: state.input?.command,
      status: state.status,
      defaultStatus: state.status === 'completed' ? 'success' : 'unknown',
      duration_ms: typeof start === 'number' && typeof end === 'number' ? end - start : undefined,
    });
    rememberToolCall(event, memory);
    return [event];
  }

  return [];
}

export class PeekEventExtractor {
  private pending = '';
  private piAssistantBuffer = '';
  private antigravityAssistantBuffer = '';
  private antigravityConversationId: string | null = null;
  private antigravityMessageStep: string | null = null;
  private readonly antigravityToolPhases = new Set<string>();
  private readonly includeToolCalls: boolean;
  private readonly source: 'stdout' | 'stderr';
  private readonly toolMemory = new Map<string, ToolCallMemory>();

  constructor(private readonly agent: PeekAgent, options: PeekEventExtractorOptions = {}) {
    this.includeToolCalls = options.includeToolCalls === true;
    this.source = options.source || 'stdout';
  }

  push(chunk: string, observedAt = new Date().toISOString()): PeekEvent[] {
    if ((this.agent === 'grok' || this.agent === 'gemini' || this.agent === 'pi') && this.source === 'stderr') {
      return [];
    }

    if (!chunk) {
      return [];
    }

    const lines = `${this.pending}${chunk}`.split(/\r?\n/);
    this.pending = lines.pop() || '';
    return this.extractLines(lines, observedAt);
  }

  flush(observedAt = new Date().toISOString(), options: PeekFlushOptions = {}): PeekEvent[] {
    if ((this.agent === 'grok' || this.agent === 'gemini' || this.agent === 'pi') && this.source === 'stderr') {
      this.pending = '';
      return [];
    }

    const events: PeekEvent[] = [];

    if (this.pending) {
      const line = this.pending;
      this.pending = '';
      events.push(...this.extractLines([line], observedAt));
    }

    events.push(...this.flushAntigravityAssistantBuffer(observedAt));
    events.push(...this.flushPiAssistantBuffer(observedAt));
    return events;
  }

  private extractLines(lines: string[], observedAt: string): PeekEvent[] {
    const events: PeekEvent[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        events.push(...this.extractParsedEvent(JSON.parse(line), observedAt));
      } catch {
        debugLog(`[Debug] Skipping invalid peek JSON line: ${line}`);
        events.push(...this.flushAntigravityAssistantBuffer(observedAt));
      }
    }

    return events;
  }

  private extractParsedEvent(parsed: any, observedAt: string): PeekEvent[] {
    if (this.agent === 'gemini') {
      return isAntigravityEvent(parsed) ? this.extractAntigravityParsedEvent(parsed, observedAt) : [];
    }

    if (this.agent === 'pi') {
      return this.extractPiParsedEvent(parsed, observedAt);
    }

    return extractPeekEventsFromParsedEvent(this.agent, parsed, observedAt, this.includeToolCalls, this.toolMemory);
  }

  private extractPiParsedEvent(parsed: any, observedAt: string): PeekEvent[] {
    const events: PeekEvent[] = [];
    if (parsed?.type === 'message_update') {
      const update = parsed.assistantMessageEvent;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        this.piAssistantBuffer += update.delta;
      } else if (update?.type === 'text_end') {
        events.push(...this.flushPiAssistantBuffer(observedAt));
      }
      return events;
    }

    if (parsed?.type === 'message_end' || parsed?.type === 'turn_end' || parsed?.type === 'agent_end') {
      return this.flushPiAssistantBuffer(observedAt);
    }

    if (parsed?.type === 'tool_execution_start') {
      events.push(...this.flushPiAssistantBuffer(observedAt));
      if (!this.includeToolCalls) return events;
      const event = createToolCallEvent({
        ts: observedAt,
        phase: 'started',
        id: parsed.toolCallId,
        tool: parsed.toolName || 'tool_execution',
        command: parsed.args?.command,
      });
      rememberToolCall(event, this.toolMemory);
      events.push(event);
      return events;
    }

    if (parsed?.type === 'tool_execution_end') {
      events.push(...this.flushPiAssistantBuffer(observedAt));
      if (!this.includeToolCalls) return events;
      events.push(createRememberedCompletion({
        ts: observedAt,
        id: parsed.toolCallId,
        memory: this.toolMemory,
        fallbackTool: parsed.toolName || 'tool_execution',
        status: parsed.isError === true ? 'failed' : undefined,
        defaultStatus: parsed.isError === true ? 'failed' : 'success',
      }));
      return events;
    }

    return events;
  }

  private flushPiAssistantBuffer(observedAt: string): PeekEvent[] {
    if (this.agent !== 'pi' || !this.piAssistantBuffer) return [];
    const text = this.piAssistantBuffer;
    this.piAssistantBuffer = '';
    return text.trim() ? [{ kind: 'message', ts: observedAt, text }] : [];
  }

  private extractAntigravityParsedEvent(parsed: any, observedAt: string): PeekEvent[] {
    if (parsed.event === 'init') {
      this.antigravityConversationId = parsed.conversation_id;
      return [];
    }
    if (parsed.event === 'result') {
      return this.flushAntigravityAssistantBuffer(observedAt);
    }
    const step = parsed.step_update;
    if (this.antigravityConversationId && step.conversation_id !== this.antigravityConversationId) {
      return [];
    }
    this.antigravityConversationId ||= step.conversation_id;
    const id = antigravityStepId(step);
    const events: PeekEvent[] = [];
    if (step.step_type === 'agent_response') {
      if (this.antigravityMessageStep !== id) {
        events.push(...this.flushAntigravityAssistantBuffer(observedAt));
        this.antigravityMessageStep = id;
      }
      if (typeof step.text_delta === 'string') {
        this.antigravityAssistantBuffer += step.text_delta;
      }
      if (step.state === 'DONE') events.push(...this.flushAntigravityAssistantBuffer(observedAt));
      return events;
    }
    events.push(...this.flushAntigravityAssistantBuffer(observedAt));
    if (!this.includeToolCalls || step.step_type !== 'tool' || !['ACTIVE', 'DONE'].includes(step.state)) {
      return events;
    }
    const phase = step.state === 'DONE' ? 'completed' : 'started';
    const phaseKey = `${id}:${phase}`;
    if (this.antigravityToolPhases.has(phaseKey)) return events;
    this.antigravityToolPhases.add(phaseKey);
    const info = step.tool_info;
    const event = createToolCallEvent({
      ts: observedAt,
      phase,
      id,
      tool: step.tool_name || info?.name || this.toolMemory.get(id)?.tool || 'tool',
      command: info?.parameters?.CommandLine,
      status: info?.error ? 'failed' : undefined,
      defaultStatus: 'success',
      duration_ms: typeof step.duration_seconds === 'number' ? step.duration_seconds * 1000 : undefined,
    });
    const remembered = this.toolMemory.get(id);
    if (remembered && !info?.parameters?.CommandLine) {
      event.summary = remembered.summary;
      if (remembered.summary_truncated) event.summary_truncated = true;
    }
    rememberToolCall(event, this.toolMemory);
    events.push(event);
    return events;
  }

  private flushAntigravityAssistantBuffer(observedAt: string): PeekEvent[] {
    if (this.agent !== 'gemini' || !this.antigravityAssistantBuffer) {
      return [];
    }

    const text = this.antigravityAssistantBuffer;
    this.antigravityAssistantBuffer = '';

    if (!text.trim()) {
      return [];
    }

    return [{ kind: 'message', ts: observedAt, text }];
  }
}

export class PeekMessageExtractor {
  private readonly extractor: PeekEventExtractor;

  constructor(agent: PeekAgent) {
    this.extractor = new PeekEventExtractor(agent, { includeToolCalls: false });
  }

  push(chunk: string, observedAt = new Date().toISOString()): PeekMessage[] {
    return this.toMessages(this.extractor.push(chunk, observedAt));
  }

  flush(observedAt = new Date().toISOString(), options: PeekFlushOptions = {}): PeekMessage[] {
    return this.toMessages(this.extractor.flush(observedAt, options));
  }

  private toMessages(events: PeekEvent[]): PeekMessage[] {
    return events
      .filter((event): event is Extract<PeekEvent, { kind: 'message' }> => event.kind === 'message')
      .map((event) => ({ ts: event.ts, text: event.text }));
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

// Parse whole Messages events without the single-JSON passthrough used by Claude.
// Even one init/assistant/result line is a stream event, not an already shaped result.
export function parseGrokOutput(stdout: string): any {
  let sessionId: string | undefined;
  let model: string | undefined;
  let terminal: any;
  const messages: string[] = [];
  const tools = new Map<string, any>();
  for (const line of stdout.split(/\r?\n/)) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // Diagnostics, malformed lines and incomplete writes are expected.
    }
    if (!event || typeof event !== 'object') continue;
    if (typeof event.session_id === 'string') sessionId = event.session_id;
    if (typeof event.model === 'string') model = event.model;
    if (event.type === 'result') terminal = event;
    if (event.type === 'assistant') {
      if (typeof event.message?.model === 'string') model = event.message.model;
      if (!Array.isArray(event.message?.content)) continue;
      const text: string[] = [];
      for (const block of event.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') text.push(block.text);
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          tools.set(block.id, { tool: block.name, input: block.input, output: null });
        }
      }
      if (text.length) messages.push(text.join(''));
    }
    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type !== 'tool_result') continue;
        const tool = tools.get(block.tool_use_id);
        if (tool) {
          tool.output = block.content;
          if (typeof block.is_error === 'boolean') tool.is_error = block.is_error;
        }
      }
    }
  }
  const result: any = {};
  const message = typeof terminal?.result === 'string' && terminal.result.trim()
    ? terminal.result : messages.join('\n\n');
  if (message) result.message = message;
  if (sessionId) result.session_id = sessionId;
  if (model) result.model = model;
  if (tools.size) result.tools = [...tools.values()];
  // Keep failure details even when a final result has no text after partial output.
  for (const key of ['is_error', 'subtype', 'errors', 'stop_reason', 'usage', 'modelUsage', 'total_cost_usd', 'num_turns', 'duration_ms', 'duration_api_ms']) {
    if (terminal?.[key] !== undefined) result[key] = terminal[key];
  }
  return Object.keys(result).length ? result : null;
}

function piMessageText(message: any): string | null {
  if (!Array.isArray(message?.content)) return null;
  const text = message.content
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('');
  return text.trim() ? text : null;
}

export function parsePiOutput(stdout: string): any {
  if (!stdout) return null;

  let recognized = false;
  let sessionId: string | undefined;
  let finalMessage: any;
  const tools = new Map<string, any>();

  for (const line of stdout.split(/\r?\n/)) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') continue;

    if (event.type === 'session') {
      recognized = true;
      if (typeof event.id === 'string') sessionId = event.id;
      continue;
    }

    if (['agent_start', 'agent_end', 'turn_start', 'turn_end', 'message_start', 'message_update', 'message_end', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end'].includes(event.type)) {
      recognized = true;
    }

    if ((event.type === 'message_end' || event.type === 'turn_end') && event.message?.role === 'assistant') {
      finalMessage = event.message;
    }

    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      for (const message of event.messages) {
        if (message?.role === 'assistant') finalMessage = message;
      }
    }

    if (event.type === 'tool_execution_start' && typeof event.toolCallId === 'string') {
      tools.set(event.toolCallId, {
        tool: event.toolName || 'tool_execution',
        input: event.args ?? null,
        output: null,
      });
    }

    if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string') {
      const previous = tools.get(event.toolCallId) || {
        tool: event.toolName || 'tool_execution',
        input: null,
        output: null,
      };
      previous.output = event.result ?? null;
      previous.is_error = event.isError === true;
      tools.set(event.toolCallId, previous);
    }
  }

  if (!recognized) return null;

  const result: any = {};
  const message = piMessageText(finalMessage);
  if (message) result.message = message;
  if (sessionId) result.session_id = sessionId;
  if (typeof finalMessage?.provider === 'string') result.provider = finalMessage.provider;
  if (typeof finalMessage?.model === 'string') result.model = finalMessage.model;
  if (finalMessage?.usage && typeof finalMessage.usage === 'object') result.usage = finalMessage.usage;
  if (typeof finalMessage?.stopReason === 'string') {
    result.stop_reason = finalMessage.stopReason;
    if (finalMessage.stopReason === 'error') result.is_error = true;
  }
  if (typeof finalMessage?.errorMessage === 'string' && finalMessage.errorMessage) {
    result.error = finalMessage.errorMessage;
    result.is_error = true;
  }
  if (tools.size) result.tools = [...tools.values()];
  return result;
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
    let assistantTextBuffer = '';
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
            if (content.type === 'text' && typeof content.text === 'string') {
              assistantTextBuffer += content.text;
            }
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
    const fallbackMessage = assistantTextBuffer.trim() ? assistantTextBuffer : null;
    const message = lastMessage || fallbackMessage;

    if (message || sessionId || tools.length > 0) {
      return {
        message,
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

export function parseAntigravityOutput(stdout: string): any {
  const records: any[] = [];
  try {
    records.push(JSON.parse(stdout.trim()));
  } catch {
    for (const line of stdout.split('\n')) {
      try { records.push(JSON.parse(line)); } catch { /* incomplete lines and diagnostics */ }
    }
  }
  let recognized = false;
  let sessionId: string | null = null;
  let result: any = null;
  let lastMessage: string | null = null;
  const messages = new Map<string, string>();
  const tools = new Map<string, any>();
  for (const record of records) {
    const envelope = record && typeof record.conversation_id === 'string' && typeof record.status === 'string';
    if (!isAntigravityEvent(record) && !envelope) continue;
    recognized = true;
    if (record.event === 'init') {
      sessionId = record.conversation_id || sessionId;
    } else if (record.event === 'result' || envelope) {
      result = envelope ? record : record.result;
      sessionId = result.conversation_id || sessionId;
    } else if (record.event === 'step_update') {
      const step = record.step_update;
      if (sessionId && step.conversation_id !== sessionId) continue;
      sessionId ||= step.conversation_id || null;
      const id = antigravityStepId(step);
      if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
        const message = (messages.get(id) || '') + step.text_delta;
        messages.set(id, message);
        if (message.trim()) lastMessage = message;
      } else if (step.step_type === 'tool') {
        const info = step.tool_info;
        const previous = tools.get(id);
        tools.set(id, {
          tool: step.tool_name || info?.name || previous?.tool || 'tool',
          input: info?.parameters ?? previous?.input ?? null,
          output: info?.output ?? previous?.output ?? null,
          status: info?.error ? 'failed' : step.state === 'DONE' ? 'success' : null,
          ...(info?.error ? { error: info.error } : {}),
        });
      }
    }
  }
  if (!recognized) return null;
  return {
    message: typeof result?.response === 'string' && result.response.trim() ? result.response : lastMessage,
    session_id: sessionId,
    status: result?.status,
    is_error: result ? result.status !== 'SUCCESS' : undefined,
    error: result?.error,
    stats: result ? { duration_seconds: result.duration_seconds, num_turns: result.num_turns, usage: result.usage } : undefined,
    tools: tools.size ? [...tools.values()] : undefined,
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
