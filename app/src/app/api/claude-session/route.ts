import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseClaudeJSONL } from "@/lib/claude-jsonl";

interface SessionInfo {
  id: string;
  path: string;
  projectKey: string;
  lastModified: string;
  size: number;
}

// GET /api/claude-session?project=/path/to/project
// GET /api/claude-session?project=/path/to/project&session=uuid
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("project");
  const sessionId = url.searchParams.get("session");

  if (!projectPath) {
    return NextResponse.json(
      { error: "Missing project parameter" },
      { status: 400 },
    );
  }

  // Convert project path to Claude's project key format
  const projectKey = projectPath.replace(/\//g, "-");
  const sessionsDir = path.join(homedir(), ".claude/projects", projectKey);

  try {
    if (sessionId) {
      // Return specific session messages
      const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
      const content = await readFile(sessionPath, "utf-8");
      const messages = parseClaudeJSONL(content);

      return NextResponse.json({
        sessionId,
        projectKey,
        messages,
        messageCount: messages.length,
      });
    }

    // List all sessions for the project
    const files = await readdir(sessionsDir);
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = path.join(sessionsDir, file);
      const stats = await stat(filePath);

      sessions.push({
        id: file.replace(".jsonl", ""),
        path: filePath,
        projectKey,
        lastModified: stats.mtime.toISOString(),
        size: stats.size,
      });
    }

    // Sort by last modified, newest first
    sessions.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ sessions: [] });
    }
    return NextResponse.json(
      { error: "Failed to read sessions" },
      { status: 500 },
    );
  }
}
