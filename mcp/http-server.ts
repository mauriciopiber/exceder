#!/usr/bin/env node
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
const PORT = 3100;

interface SlotRegistry {
  projects: Record<string, { base_port: number; path: string }>;
  slots: Record<string, { project: string; number: number; branch: string; created_at: string }>;
  workspaces?: Record<string, { name: string; description: string; paths: string[]; created_at: string }>;
}

interface DockerContainer {
  name: string;
  port: number;
  status: string;
}

interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface ClaudeInstance {
  pid: number;
  cwd: string;
  branch: string;
  runtime: string;
  model: string;
  session: string;
  lastMessage: string | null;
  usage: ClaudeUsage | null;
}

async function getRegistry(): Promise<SlotRegistry> {
  try {
    const registryPath = path.join(homedir(), ".config/slots/registry.json");
    const content = await readFile(registryPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return { projects: {}, slots: {} };
  }
}

async function getDockerContainers(): Promise<DockerContainer[]> {
  try {
    const { stdout } = await execAsync(
      'docker ps --format "{{.Names}}|{{.Ports}}|{{.Status}}"'
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, ports, status] = line.split("|");
        const portMatch = ports.match(/0\.0\.0\.0:(\d+)/);
        return {
          name,
          port: portMatch ? parseInt(portMatch[1]) : 0,
          status,
        };
      });
  } catch {
    return [];
  }
}

async function getClaudeInstances(): Promise<ClaudeInstance[]> {
  try {
    const { stdout: pids } = await execAsync('pgrep -f "claude" 2>/dev/null || true');
    const instances: ClaudeInstance[] = [];

    for (const pid of pids.trim().split("\n").filter(Boolean)) {
      try {
        const { stdout: lsofOut } = await execAsync(
          `lsof -p ${pid} 2>/dev/null | grep cwd | awk '{print $NF}'`
        );
        const cwd = lsofOut.trim();
        if (!cwd || cwd === "/" || !cwd.startsWith("/Users")) continue;

        const { stdout: branchOut } = await execAsync(
          `git -C "${cwd}" branch --show-current 2>/dev/null || echo "unknown"`
        );

        const { stdout: runtimeOut } = await execAsync(
          `ps -p ${pid} -o etime= 2>/dev/null || echo "unknown"`
        );

        const projectKey = cwd.replace(/\//g, "-");
        const sessionDir = path.join(homedir(), ".claude/projects", projectKey);
        let model = "unknown";
        let session = "unknown";
        let lastMessage: string | null = null;
        let usage: ClaudeUsage | null = null;

        try {
          const { stdout: sessionFile } = await execAsync(
            `ls -t "${sessionDir}"/*.jsonl 2>/dev/null | head -1`
          );
          if (sessionFile.trim()) {
            const { stdout: modelOut } = await execAsync(
              `grep -o '"model":"[^"]*"' "${sessionFile.trim()}" 2>/dev/null | tail -1 | cut -d'"' -f4`
            );
            const { stdout: slugOut } = await execAsync(
              `grep -o '"slug":"[^"]*"' "${sessionFile.trim()}" 2>/dev/null | tail -1 | cut -d'"' -f4`
            );
            model = modelOut.trim().replace("claude-", "").replace("-20251101", "") || "unknown";
            session = slugOut.trim() || "unknown";

            try {
              const { stdout: assistantLines } = await execAsync(
                `grep '"type":"assistant"' "${sessionFile.trim()}" 2>/dev/null | tail -20`
              );

              let totalInput = 0;
              let totalOutput = 0;
              let totalCacheRead = 0;

              for (const line of assistantLines.trim().split("\n").filter(Boolean)) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.message?.usage) {
                    const u = parsed.message.usage;
                    totalInput += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
                    totalOutput += u.output_tokens || 0;
                    totalCacheRead += u.cache_read_input_tokens || 0;
                  }
                  if (parsed.message?.content) {
                    const content = parsed.message.content;
                    if (typeof content === "string") {
                      lastMessage = content.slice(0, 200);
                    } else if (Array.isArray(content)) {
                      const textBlock = content.find((b: { type: string }) => b.type === "text");
                      if (textBlock?.text) {
                        lastMessage = textBlock.text.slice(0, 200);
                      }
                    }
                  }
                } catch {
                  // Skip malformed lines
                }
              }

              if (totalInput > 0 || totalOutput > 0) {
                const isOpus = model.includes("opus");
                const inputRate = isOpus ? 0.015 : 0.003;
                const outputRate = isOpus ? 0.075 : 0.015;
                const cacheRate = inputRate * 0.1;

                const estimatedCost =
                  (totalInput * inputRate / 1000) +
                  (totalOutput * outputRate / 1000) +
                  (totalCacheRead * cacheRate / 1000);

                usage = {
                  inputTokens: totalInput,
                  outputTokens: totalOutput,
                  cacheReadTokens: totalCacheRead,
                  totalTokens: totalInput + totalOutput + totalCacheRead,
                  estimatedCost: Math.round(estimatedCost * 100) / 100,
                };
              }
            } catch {
              // Ignore
            }
          }
        } catch {
          // Ignore
        }

        instances.push({
          pid: parseInt(pid),
          cwd,
          branch: branchOut.trim(),
          runtime: runtimeOut.trim(),
          model,
          session,
          lastMessage,
          usage,
        });
      } catch {
        // Skip this PID
      }
    }

    return instances;
  } catch {
    return [];
  }
}

async function getBranchForPath(dirPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `git -C "${dirPath}" branch --show-current 2>/dev/null || echo "unknown"`
    );
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

// Create MCP Server
const server = new McpServer({
  name: "workflow",
  version: "1.0.0",
});

// Tool: Get all workflow data
server.tool(
  "workflow_status",
  "Get comprehensive workflow status including slots, workspaces, Claude instances, and Docker containers",
  {},
  async () => {
    const [registry, containers, claudes] = await Promise.all([
      getRegistry(),
      getDockerContainers(),
      getClaudeInstances(),
    ]);

    const slots = Object.entries(registry.slots).map(([name, slot]) => {
      const project = registry.projects[slot.project];
      const basePort = project?.base_port || 3000;
      const projectOffset = Math.floor((basePort - 3000) / 10);
      const slotPath = project?.path
        ? path.join(path.dirname(project.path), name)
        : "";

      return {
        name,
        project: slot.project,
        number: slot.number,
        branch: slot.branch,
        path: slotPath,
        ports: {
          web: basePort + slot.number,
          postgres: 5432 + projectOffset + slot.number,
        },
        docker: containers.find((c) => c.name === `${name}-db`) || null,
        claude: claudes.find((c) =>
          slotPath && (c.cwd === slotPath || c.cwd.startsWith(slotPath + "/"))
        ) || null,
      };
    });

    const workspaces = await Promise.all(
      Object.entries(registry.workspaces || {}).map(async ([, ws]) => {
        const members = await Promise.all(
          ws.paths.map(async (wsPath) => {
            const dirName = path.basename(wsPath);
            const branch = await getBranchForPath(wsPath);
            const matchedClaudes = claudes.filter(
              (c) => c.cwd === wsPath || c.cwd.startsWith(wsPath + "/")
            );
            const matchedDockers = containers.filter(
              (c) => c.name.includes(dirName) || c.name.startsWith(dirName)
            );

            return { path: wsPath, name: dirName, branch, claudes: matchedClaudes, dockers: matchedDockers };
          })
        );

        return { name: ws.name, description: ws.description, members };
      })
    );

    const workspaceClaudeCwds = workspaces
      .flatMap((ws) => ws.members)
      .flatMap((m) => m.claudes.map((c) => c.cwd));

    const matchedClaudeCwds = [
      ...slots.filter((s) => s.claude !== null).map((s) => s.claude!.cwd),
      ...workspaceClaudeCwds,
    ];
    const unregisteredClaudes = claudes.filter(
      (c) => !matchedClaudeCwds.includes(c.cwd)
    );

    const workspaceContainerNames = workspaces
      .flatMap((ws) => ws.members)
      .flatMap((m) => m.dockers.map((d) => d.name));

    const matchedContainerNames = [
      ...slots.filter((s) => s.docker !== null).map((s) => s.docker!.name),
      ...workspaceContainerNames,
    ];
    const orphanContainers = containers.filter(
      (c) => !matchedContainerNames.includes(c.name)
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            slots,
            workspaces,
            unregisteredClaudes,
            orphanContainers,
            summary: {
              totalSlots: slots.length,
              totalWorkspaces: workspaces.length,
              runningClaudes: claudes.length,
              runningContainers: containers.length,
              orphanClaudes: unregisteredClaudes.length,
              orphanContainers: orphanContainers.length,
            },
          }, null, 2),
        },
      ],
    };
  }
);

// Tool: List Claude instances
server.tool(
  "list_claudes",
  "List all running Claude Code instances with their working directories, models, and usage stats",
  {},
  async () => {
    const claudes = await getClaudeInstances();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(claudes, null, 2) }],
    };
  }
);

// Tool: List Docker containers
server.tool(
  "list_containers",
  "List all running Docker containers with their ports and status",
  {},
  async () => {
    const containers = await getDockerContainers();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(containers, null, 2) }],
    };
  }
);

// Tool: List slots
server.tool(
  "list_slots",
  "List all registered slots with their ports and associated projects",
  {},
  async () => {
    const registry = await getRegistry();
    const slots = Object.entries(registry.slots).map(([name, slot]) => {
      const project = registry.projects[slot.project];
      const basePort = project?.base_port || 3000;
      const projectOffset = Math.floor((basePort - 3000) / 10);

      return {
        name,
        project: slot.project,
        number: slot.number,
        branch: slot.branch,
        ports: {
          web: basePort + slot.number,
          postgres: 5432 + projectOffset + slot.number,
        },
      };
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(slots, null, 2) }],
    };
  }
);

// Tool: List workspaces
server.tool(
  "list_workspaces",
  "List all registered workspaces with their member paths",
  {},
  async () => {
    const registry = await getRegistry();
    const workspaces = Object.entries(registry.workspaces || {}).map(([key, ws]) => ({
      key,
      name: ws.name,
      description: ws.description,
      paths: ws.paths,
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(workspaces, null, 2) }],
    };
  }
);

// Tool: Get summary
server.tool(
  "workflow_summary",
  "Get a quick summary of the workflow status (counts only)",
  {},
  async () => {
    const [registry, containers, claudes] = await Promise.all([
      getRegistry(),
      getDockerContainers(),
      getClaudeInstances(),
    ]);

    const slotsCount = Object.keys(registry.slots).length;
    const workspacesCount = Object.keys(registry.workspaces || {}).length;
    const totalCost = claudes.reduce((sum, c) => sum + (c.usage?.estimatedCost || 0), 0);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            slots: slotsCount,
            workspaces: workspacesCount,
            claudes: claudes.length,
            containers: containers.length,
            totalEstimatedCost: `$${totalCost.toFixed(2)}`,
          }, null, 2),
        },
      ],
    };
  }
);

// Tool: Add workspace
server.tool(
  "add_workspace",
  "Add a new workspace with paths",
  {
    name: z.string().describe("Unique identifier for the workspace"),
    description: z.string().describe("Human-readable description"),
    paths: z.array(z.string()).describe("Array of absolute paths to include"),
  },
  async ({ name, description, paths }) => {
    try {
      const registry = await getRegistry();
      if (!registry.workspaces) {
        registry.workspaces = {};
      }

      registry.workspaces[name] = {
        name,
        description,
        paths,
        created_at: new Date().toISOString(),
      };

      const registryPath = path.join(homedir(), ".config/slots/registry.json");
      await writeFile(registryPath, JSON.stringify(registry, null, 2));

      return {
        content: [
          { type: "text" as const, text: `Workspace "${name}" created with ${paths.length} paths` },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error creating workspace: ${error instanceof Error ? error.message : "Unknown error"}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Remove workspace
server.tool(
  "remove_workspace",
  "Remove a workspace",
  {
    name: z.string().describe("Name of the workspace to remove"),
  },
  async ({ name }) => {
    try {
      const registry = await getRegistry();
      if (!registry.workspaces || !registry.workspaces[name]) {
        return {
          content: [{ type: "text" as const, text: `Workspace "${name}" not found` }],
          isError: true,
        };
      }

      delete registry.workspaces[name];

      const registryPath = path.join(homedir(), ".config/slots/registry.json");
      await writeFile(registryPath, JSON.stringify(registry, null, 2));

      return {
        content: [{ type: "text" as const, text: `Workspace "${name}" removed` }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error removing workspace: ${error instanceof Error ? error.message : "Unknown error"}` },
        ],
        isError: true,
      };
    }
  }
);

// Create Express app and HTTP transport
const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

// Handle MCP requests
app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    await server.connect(transport);

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
  }

  await transport.handleRequest(req, res, req.body);
});

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok", sessions: transports.size });
});

// Start server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Workflow MCP HTTP server running on http://127.0.0.1:${PORT}`);
  console.log(`  - MCP endpoint: http://127.0.0.1:${PORT}/mcp`);
  console.log(`  - Health check: http://127.0.0.1:${PORT}/health`);
});
