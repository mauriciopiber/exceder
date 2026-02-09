/**
 * Claude Code JSONL Parser
 *
 * Parses Claude Code session files and converts them to assistant-ui format.
 * Session files are stored in ~/.claude/projects/{project-key}/*.jsonl
 */

import type { ThreadMessageLike } from "@assistant-ui/react";

// Claude Code JSONL Types

interface ClaudeContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string;
}

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface ClaudeJSONLEntry {
  type:
    | "user"
    | "assistant"
    | "system"
    | "summary"
    | "file-history-snapshot"
    | "queue-operation";
  message?: ClaudeMessage;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
}

// Conversion Functions

export function convertClaudeToThreadMessage(
  entry: ClaudeJSONLEntry,
): ThreadMessageLike | null {
  if (entry.type === "user" && entry.message) {
    const content =
      typeof entry.message.content === "string" ? entry.message.content : "";

    return {
      role: "user",
      content: [{ type: "text", text: content }],
      id: entry.uuid,
      createdAt: entry.timestamp ? new Date(entry.timestamp) : undefined,
    };
  }

  if (entry.type === "assistant" && entry.message) {
    const contentBlocks = Array.isArray(entry.message.content)
      ? entry.message.content
      : [];

    const content: (
      | { type: "text"; text: string }
      | {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
        }
    )[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text" && block.text) {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && block.thinking) {
        // Map thinking to a custom UI element or skip
        // assistant-ui doesn't have built-in "reasoning" type, use text with marker
        content.push({
          type: "text",
          text: `<thinking>${block.thinking}</thinking>`,
        });
      } else if (block.type === "tool_use" && block.name) {
        content.push({
          type: "tool-call",
          toolCallId: block.id || `tool-${Date.now()}`,
          toolName: block.name,
          args: block.input || {},
        });
      }
    }

    // Filter out empty content
    if (content.length === 0) return null;

    return {
      role: "assistant",
      content: content as ThreadMessageLike["content"],
      id: entry.uuid,
      createdAt: entry.timestamp ? new Date(entry.timestamp) : undefined,
    };
  }

  return null;
}

export function parseClaudeJSONL(jsonlContent: string): ThreadMessageLike[] {
  const lines = jsonlContent.trim().split("\n").filter(Boolean);
  const messages: ThreadMessageLike[] = [];

  for (const line of lines) {
    try {
      const entry: ClaudeJSONLEntry = JSON.parse(line);
      const message = convertClaudeToThreadMessage(entry);
      if (message) {
        messages.push(message);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

// Session Discovery

export interface ClaudeSession {
  id: string;
  path: string;
  projectKey: string;
  lastModified: Date;
  messageCount?: number;
}

export async function getClaudeSessions(
  projectPath: string,
): Promise<ClaudeSession[]> {
  // This would be called from an API route, not client-side
  // Returns list of available sessions for a project
  const projectKey = projectPath.replace(/\//g, "-");
  return [{ id: "mock", path: "", projectKey, lastModified: new Date() }];
}
