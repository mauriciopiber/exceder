"use client";

import { useEffect, useRef, useState } from "react";

// Simple message type for our POC
interface SimpleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}

interface ClaudeChatProps {
  projectPath: string;
  sessionId: string;
  tmuxSession?: string;
  onClose?: () => void;
}

interface APIMessage {
  id?: string;
  role: "user" | "assistant";
  content: string | { type: string; text?: string }[];
  createdAt?: string;
}

// Helper to convert API messages to SimpleMessage format
function convertMessages(apiMessages: APIMessage[]): SimpleMessage[] {
  return apiMessages.map((msg) => {
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n");
    }
    return {
      id: msg.id || `msg-${Math.random()}`,
      role: msg.role,
      content: text,
      createdAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
    };
  });
}

function ClaudeChatInner({
  projectPath,
  sessionId,
  tmuxSession,
  onClose,
}: ClaudeChatProps) {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Connect to SSE stream for real-time updates
  useEffect(() => {
    const streamUrl = `/api/claude-session/stream?project=${encodeURIComponent(projectPath)}&session=${sessionId}`;

    console.log("Connecting to SSE stream:", streamUrl);
    const eventSource = new EventSource(streamUrl);

    eventSource.onopen = () => {
      console.log("SSE connected");
      setIsStreaming(true);
      setIsLoading(false);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("SSE message:", data.type);

        if (data.type === "messages") {
          const newMessages = convertMessages(data.messages);
          setMessages(newMessages);
          setError(null);
        } else if (data.type === "error") {
          setError(data.error);
        }
      } catch (e) {
        console.error("Failed to parse SSE message:", e);
      }
    };

    eventSource.onerror = (e) => {
      console.error("SSE error:", e);
      setIsStreaming(false);
      // Fallback to polling if SSE fails
      eventSource.close();
    };

    return () => {
      console.log("Closing SSE connection");
      eventSource.close();
    };
  }, [projectPath, sessionId]);

  // Handle sending messages via tmux
  const handleSend = async () => {
    if (!inputValue.trim()) return;

    if (!tmuxSession) {
      console.warn("No tmux session configured");
      return;
    }

    try {
      await fetch("/api/tmux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-keys",
          name: tmuxSession,
          keys: inputValue,
          enter: true,
        }),
      });
      setInputValue("");
      // SSE will automatically pick up new messages
    } catch (e) {
      console.error("Failed to send to tmux:", e);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground">Loading session...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-destructive">Error: {error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <div>
          <h3 className="font-medium">Claude Session</h3>
          <p className="text-xs text-muted-foreground font-mono">
            {sessionId.slice(0, 8)}...
            {isStreaming && <span className="ml-2 text-green-500">LIVE</span>}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-2 py-1 rounded hover:bg-muted"
          >
            Close
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-lg px-4 py-2 max-w-[80%] ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans text-sm">
                {msg.content}
              </pre>
              {msg.createdAt && (
                <p className="text-xs opacity-50 mt-1">
                  {msg.createdAt.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        {!tmuxSession && (
          <p className="text-xs text-muted-foreground mb-2">
            Select a tmux session to enable sending messages
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={
              tmuxSession ? "Send a message..." : "Select tmux session first"
            }
            disabled={!tmuxSession}
            className="flex-1 px-3 py-2 border rounded-md bg-background disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!tmuxSession}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClaudeChat(props: ClaudeChatProps) {
  return <ClaudeChatInner {...props} />;
}

// Simple standalone version for testing
export function ClaudeChatStandalone() {
  const [projectPath, _setProjectPath] = useState(
    "/Users/mauriciopiber/Projects/piber/realcraft",
  );
  const [sessionId, setSessionId] = useState("");
  const [tmuxSession, setTmuxSession] = useState("");
  const [sessions, setSessions] = useState<
    { id: string; lastModified: string; size: number }[]
  >([]);
  const [tmuxSessions, setTmuxSessions] = useState<string[]>([]);

  // Fetch Claude sessions
  useEffect(() => {
    fetch(`/api/claude-session?project=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(console.error);
  }, [projectPath]);

  // Fetch tmux sessions
  useEffect(() => {
    fetch("/api/tmux")
      .then((r) => r.json())
      .then((data) => {
        // Extract session names from the response
        const names = (data.sessions || []).map(
          (s: { name: string }) => s.name,
        );
        setTmuxSessions(names);
      })
      .catch(console.error);
  }, []);

  if (!sessionId) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-lg font-medium">Select a Claude Session</h2>

        {/* Tmux session selector */}
        <div className="space-y-2">
          <label
            htmlFor="tmux-session-select"
            className="text-sm text-muted-foreground"
          >
            Tmux Session (for sending messages):
          </label>
          <select
            id="tmux-session-select"
            value={tmuxSession}
            onChange={(e) => setTmuxSession(e.target.value)}
            className="w-full p-2 border rounded bg-background"
          >
            <option value="">Select tmux session...</option>
            {tmuxSessions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Session list */}
        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">
            Claude Code Sessions:
          </span>
          {sessions.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setSessionId(s.id)}
              className="w-full text-left p-3 border rounded hover:bg-muted"
            >
              <div className="font-mono text-sm">{s.id.slice(0, 8)}...</div>
              <div className="text-xs text-muted-foreground">
                {new Date(s.lastModified).toLocaleString()} •{" "}
                {(s.size / 1024).toFixed(0)} KB
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[600px] border rounded-lg overflow-hidden">
      <ClaudeChat
        projectPath={projectPath}
        sessionId={sessionId}
        tmuxSession={tmuxSession || undefined}
        onClose={() => setSessionId("")}
      />
    </div>
  );
}
