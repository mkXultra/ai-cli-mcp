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

interface PendingForgeTool {
  id: string;
  tool: string;
  summary: string;
  summary_truncated?: boolean;
}

const PEEK_TOOL_SUMMARY_MAX_LENGTH = 200;
const FORGE_EXECUTE_PATTERN = /^● \[[^\]]+\] Execute \[([^\]]*)\]\s+(.+)$/;
const FORGE_FINISHED_PATTERN = /^● \[[^\]]+\] Finished(?:\s+\S+)?\s*$/;

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

  if (agent === 'claude') {
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
  private geminiAssistantBuffer = '';
  private readonly includeToolCalls: boolean;
  private readonly source: 'stdout' | 'stderr';
  private readonly toolMemory = new Map<string, ToolCallMemory>();
  private forgePendingTool: PendingForgeTool | null = null;
  private forgeToolSequence = 0;

  constructor(private readonly agent: PeekAgent, options: PeekEventExtractorOptions = {}) {
    this.includeToolCalls = options.includeToolCalls === true;
    this.source = options.source || 'stdout';
  }

  push(chunk: string, observedAt = new Date().toISOString()): PeekEvent[] {
    if (this.agent === 'forge' && this.source === 'stderr') {
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
    if (this.agent === 'forge' && this.source === 'stderr') {
      this.pending = '';
      return [];
    }

    const events: PeekEvent[] = [];

    if (this.pending) {
      if (this.agent !== 'forge' || options.terminal === true) {
        const line = this.pending;
        this.pending = '';
        events.push(...this.extractLines([line], observedAt));
      }
    }

    events.push(...this.flushGeminiAssistantBuffer(observedAt));
    events.push(...this.flushForgePendingTool(observedAt, options.terminal === true));
    return events;
  }

  private extractLines(lines: string[], observedAt: string): PeekEvent[] {
    if (this.agent === 'forge') {
      return this.extractForgeLines(lines, observedAt);
    }

    const events: PeekEvent[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        events.push(...this.extractParsedEvent(JSON.parse(line), observedAt));
      } catch {
        debugLog(`[Debug] Skipping invalid peek JSON line: ${line}`);
        events.push(...this.flushGeminiAssistantBuffer(observedAt));
      }
    }

    return events;
  }

  private extractForgeLines(lines: string[], observedAt: string): PeekEvent[] {
    const events: PeekEvent[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const summary = this.extractForgeMessage(line, 'Summary:');
      if (summary !== null) {
        events.push({ kind: 'message', ts: observedAt, text: summary });
        continue;
      }

      const completed = this.extractForgeMessage(line, 'Completed successfully:');
      if (completed !== null) {
        events.push({ kind: 'message', ts: observedAt, text: completed });
        continue;
      }

      if (this.includeToolCalls) {
        const executeMatch = line.match(FORGE_EXECUTE_PATTERN);
        if (executeMatch) {
          events.push(...this.completeForgePendingTool(observedAt));
          const [, rawTool, rawSummary] = executeMatch;
          const tool = rawTool.trim() && !/\s/.test(rawTool.trim()) ? rawTool.trim() : 'shell';
          const event = createToolCallEvent({
            ts: observedAt,
            phase: 'started',
            id: `forge_${this.forgeToolSequence++}`,
            tool,
            command: rawSummary,
          });
          this.forgePendingTool = {
            id: event.id!,
            tool: event.tool,
            summary: event.summary,
            summary_truncated: event.summary_truncated,
          };
          events.push(event);
          continue;
        }

        if (FORGE_FINISHED_PATTERN.test(line)) {
          events.push(...this.completeForgePendingTool(observedAt));
        }
      }
    }

    return events;
  }

  private extractForgeMessage(line: string, prefix: string): string | null {
    if (!line.startsWith(prefix)) {
      return null;
    }

    const text = line.slice(prefix.length).trim();
    return text || null;
  }

  private extractParsedEvent(parsed: any, observedAt: string): PeekEvent[] {
    if (this.agent === 'gemini') {
      const events = this.extractGeminiParsedEvent(parsed, observedAt);
      return events;
    }

    return extractPeekEventsFromParsedEvent(this.agent, parsed, observedAt, this.includeToolCalls, this.toolMemory);
  }

  private extractGeminiParsedEvent(parsed: any, observedAt: string): PeekEvent[] {
    if (isGeminiAssistantMessageEvent(parsed)) {
      this.geminiAssistantBuffer += parsed.content;
      return [];
    }

    const events = this.flushGeminiAssistantBuffer(observedAt);

    if (this.includeToolCalls && parsed.type === 'tool_use') {
      const event = createToolCallEvent({
        ts: observedAt,
        phase: 'started',
        id: parsed.tool_id,
        tool: parsed.tool_name || parsed.name || 'tool_use',
        command: parsed.parameters?.command,
      });
      rememberToolCall(event, this.toolMemory);
      events.push(event);
    } else if (this.includeToolCalls && parsed.type === 'tool_result') {
      events.push(createRememberedCompletion({
        ts: observedAt,
        id: parsed.tool_id,
        memory: this.toolMemory,
        fallbackTool: parsed.tool_name || parsed.name || 'tool_result',
        status: parsed.status,
        defaultStatus: 'unknown',
      }));
    }

    return events;
  }

  private flushGeminiAssistantBuffer(observedAt: string): PeekEvent[] {
    if (this.agent !== 'gemini' || !this.geminiAssistantBuffer) {
      return [];
    }

    const text = this.geminiAssistantBuffer;
    this.geminiAssistantBuffer = '';

    if (!text.trim()) {
      return [];
    }

    return [{ kind: 'message', ts: observedAt, text }];
  }

  private completeForgePendingTool(observedAt: string): PeekEvent[] {
    if (!this.forgePendingTool) {
      return [];
    }

    const pending = this.forgePendingTool;
    this.forgePendingTool = null;
    const event = createToolCallEvent({
      ts: observedAt,
      phase: 'completed',
      id: pending.id,
      tool: pending.tool,
      status: 'unknown',
      defaultStatus: 'unknown',
    });
    event.summary = pending.summary;
    if (pending.summary_truncated) {
      event.summary_truncated = true;
    }
    return [event];
  }

  private flushForgePendingTool(observedAt: string, terminal: boolean): PeekEvent[] {
    if (this.agent !== 'forge' || !terminal) {
      return [];
    }

    return this.completeForgePendingTool(observedAt);
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
