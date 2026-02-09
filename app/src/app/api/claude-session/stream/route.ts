import { readFile, watch } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import { parseClaudeJSONL } from "@/lib/claude-jsonl";

// GET /api/claude-session/stream?project=/path&session=uuid
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("project");
  const sessionId = url.searchParams.get("session");

  if (!projectPath || !sessionId) {
    return new Response("Missing project or session parameter", {
      status: 400,
    });
  }

  const projectKey = projectPath.replace(/\//g, "-");
  const sessionPath = path.join(
    homedir(),
    ".claude/projects",
    projectKey,
    `${sessionId}.jsonl`,
  );

  // Track last known line count to only send new messages
  let lastLineCount = 0;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial messages
      const sendMessages = async () => {
        try {
          const content = await new Promise<string>((resolve, reject) => {
            readFile(sessionPath, "utf-8", (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });

          const lines = content.trim().split("\n").filter(Boolean);
          const messages = parseClaudeJSONL(content);

          // Only send if we have new messages
          if (lines.length > lastLineCount) {
            const newMessages = messages.slice(
              lastLineCount > 0 ? Math.floor(lastLineCount / 2) : 0,
            );
            lastLineCount = lines.length;

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "messages", messages: newMessages })}\n\n`,
              ),
            );
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: String(error) })}\n\n`,
            ),
          );
        }
      };

      // Send initial data
      sendMessages();

      // Watch for file changes
      const watcher = watch(sessionPath, { persistent: false }, (eventType) => {
        if (eventType === "change") {
          sendMessages();
        }
      });

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 30000);

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        watcher.close();
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
