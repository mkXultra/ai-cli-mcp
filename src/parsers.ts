import { debugLog } from './cli-utils.js';

/**
 * Parse Codex NDJSON output to extract the last agent message and token count
 */
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
            // Ignore reasoning-only items for message selection.
          } else if (parsed.msg?.type === 'token_count') {
            tokenCount = parsed.msg;
          } else if (parsed.type === 'item.completed' && parsed.item?.type === 'mcp_tool_call') {
            tools.push({
              server: parsed.item.server,
              tool: parsed.item.tool,
              input: parsed.item.arguments, // Map arguments to input to match common patterns
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
          // Skip invalid JSON lines
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

/**
 * Parse Claude Output (supports both JSON and stream-json/NDJSON)
 */
export function parseClaudeOutput(stdout: string): any {
  if (!stdout) return null;

  // First try parsing as a single JSON object (backward compatibility)
  try {
    return JSON.parse(stdout);
  } catch (e) {
    // If not valid single JSON, proceed to parse as NDJSON
  }

  try {
    const lines = stdout.trim().split('\n');
    let lastMessage = null;
    let sessionId = null;
    const toolsMap = new Map<string, any>(); // Map by tool_use id for matching results

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        // Extract session ID from any message that has it
        if (parsed.session_id) {
          sessionId = parsed.session_id;
        }

        // Extract final result message
        if (parsed.type === 'result' && parsed.result) {
          lastMessage = parsed.result;
        }

        // Extract tool usage from assistant messages
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === 'tool_use') {
              toolsMap.set(content.id, {
                tool: content.name,
                input: content.input,
                output: null // Will be filled when tool_result is found
              });
            }
          }
        }

        // Match tool results from user messages
        if (parsed.type === 'user' && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === 'tool_result' && content.tool_use_id) {
              const tool = toolsMap.get(content.tool_use_id);
              if (tool) {
                // Extract text from content array
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

    // Convert Map to array
    const tools = Array.from(toolsMap.values());

    if (lastMessage || sessionId || tools.length > 0) {
      return {
        message: lastMessage, // This is the final result text
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

/**
 * Parse Gemini JSON output
 */
export function parseGeminiOutput(stdout: string): any {
  if (!stdout) return null;

  try {
    return JSON.parse(stdout);
  } catch (e) {
    debugLog(`[Debug] Failed to parse Gemini JSON output: ${e}`);
    return null;
  }
}

/**
 * Parse Forge output framed by Initialize/Continue/Finished markers.
 */
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
