#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { homedir } from "os";
import path from "path";

const execAsync = promisify(exec);

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

const server = new McpServer({
  name: "workflow",
  version: "1.0.0",
});

// Tool: Get all workflow data (slots, workspaces, containers, claudes)
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
        // Match claude by exact path OR subdirectories within the slot
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
            // Match ALL Claudes under this workspace path
            const matchedClaudes = claudes.filter(
              (c) => c.cwd === wsPath || c.cwd.startsWith(wsPath + "/")
            );
            // Match ALL Docker containers for this workspace
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
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(claudes, null, 2),
        },
      ],
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
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(containers, null, 2),
        },
      ],
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
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(slots, null, 2),
        },
      ],
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
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(workspaces, null, 2),
        },
      ],
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

    // Calculate total estimated cost
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
      const { writeFile } = await import("fs/promises");
      await writeFile(registryPath, JSON.stringify(registry, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: `Workspace "${name}" created with ${paths.length} paths`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating workspace: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
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
          content: [
            {
              type: "text" as const,
              text: `Workspace "${name}" not found`,
            },
          ],
          isError: true,
        };
      }

      delete registry.workspaces[name];

      const registryPath = path.join(homedir(), ".config/slots/registry.json");
      const { writeFile } = await import("fs/promises");
      await writeFile(registryPath, JSON.stringify(registry, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: `Workspace "${name}" removed`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error removing workspace: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== TMUX TOOLS ====================

interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
  lastActivity: string;
  ttydPort: number | null;
}

interface TtydProcess {
  pid: number;
  port: number;
  session: string;
}

async function getTtydProcesses(): Promise<TtydProcess[]> {
  try {
    const { stdout } = await execAsync('ps aux | grep "[t]tyd" | grep -v grep');
    const processes: TtydProcess[] = [];

    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const pidMatch = line.match(/^\S+\s+(\d+)/);
      const portMatch = line.match(/-p\s+(\d+)/);
      const sessionMatch = line.match(/tmux\s+(?:new\s+-A\s+-s|attach\s+-t)\s+(\S+)/);

      if (pidMatch && portMatch) {
        processes.push({
          pid: parseInt(pidMatch[1]),
          port: parseInt(portMatch[1]),
          session: sessionMatch?.[1] || "unknown",
        });
      }
    }
    return processes;
  } catch {
    return [];
  }
}

async function getTmuxSessions(): Promise<TmuxSession[]> {
  try {
    const { stdout } = await execAsync(
      'tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}|#{session_activity}" 2>/dev/null'
    );
    const ttydProcesses = await getTtydProcesses();

    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, windows, created, attached, activity] = line.split("|");
      const ttyd = ttydProcesses.find(t => t.session === name);

      return {
        name,
        windows: parseInt(windows) || 1,
        created: new Date(parseInt(created) * 1000).toISOString(),
        attached: attached === "1",
        lastActivity: new Date(parseInt(activity) * 1000).toISOString(),
        ttydPort: ttyd?.port || null,
      };
    });
  } catch {
    return [];
  }
}

// Tool: List tmux sessions
server.tool(
  "list_tmux_sessions",
  "List all tmux sessions with their status and web access (ttyd) info",
  {},
  async () => {
    const sessions = await getTmuxSessions();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            sessions,
            summary: {
              total: sessions.length,
              attached: sessions.filter(s => s.attached).length,
              withTtyd: sessions.filter(s => s.ttydPort !== null).length,
            },
          }, null, 2),
        },
      ],
    };
  }
);

// Tool: Create tmux session
server.tool(
  "create_tmux_session",
  "Create a new tmux session, optionally with ttyd web access",
  {
    name: z.string().describe("Session name"),
    cwd: z.string().optional().describe("Working directory for the session"),
    withTtyd: z.boolean().optional().describe("Start ttyd for web access"),
    ttydPort: z.number().optional().describe("Port for ttyd (default: 7681)"),
  },
  async ({ name, cwd, withTtyd, ttydPort }) => {
    try {
      const workDir = cwd || process.cwd();
      const port = ttydPort || 7681;

      // Create tmux session
      await execAsync(`tmux new-session -d -s "${name}" -c "${workDir}"`);

      if (withTtyd) {
        // Start ttyd pointing to the session
        await execAsync(`ttyd -W -p ${port} tmux attach -t "${name}" &`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Session "${name}" created with ttyd on port ${port}. Access at http://localhost:${port}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${name}" created in ${workDir}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Start ttyd for a session
server.tool(
  "start_ttyd",
  "Start ttyd web access for an existing tmux session",
  {
    session: z.string().describe("Name of the tmux session"),
    port: z.number().optional().describe("Port for ttyd (default: 7681)"),
  },
  async ({ session, port }) => {
    try {
      const ttydPort = port || 7681;

      // Kill existing ttyd on this port
      await execAsync(`lsof -ti:${ttydPort} | xargs kill -9 2>/dev/null || true`);

      // Start ttyd
      await execAsync(`ttyd -W -p ${ttydPort} tmux attach -t "${session}" &`);

      return {
        content: [
          {
            type: "text" as const,
            text: `ttyd started on port ${ttydPort} for session "${session}". Access at http://localhost:${ttydPort}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Send keys to tmux session
server.tool(
  "send_to_tmux",
  "Send keys/commands to a tmux session (useful for starting Claude Code remotely)",
  {
    session: z.string().describe("Name of the tmux session"),
    keys: z.string().describe("Keys or command to send"),
    enter: z.boolean().optional().describe("Press Enter after keys (default: true)"),
  },
  async ({ session, keys, enter }) => {
    try {
      const enterKey = enter !== false ? " Enter" : "";
      await execAsync(`tmux send-keys -t "${session}" "${keys}"${enterKey}`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Sent to session "${session}": ${keys}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Kill tmux session
server.tool(
  "kill_tmux_session",
  "Kill a tmux session and its associated ttyd process",
  {
    session: z.string().describe("Name of the tmux session to kill"),
  },
  async ({ session }) => {
    try {
      // Kill associated ttyd first
      const ttydProcesses = await getTtydProcesses();
      const ttyd = ttydProcesses.find(t => t.session === session);
      if (ttyd) {
        await execAsync(`kill ${ttyd.pid} 2>/dev/null || true`);
      }

      // Kill tmux session
      await execAsync(`tmux kill-session -t "${session}"`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${session}" killed${ttyd ? " (ttyd also stopped)" : ""}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Workflow MCP server running on stdio");
}

main().catch(console.error);
