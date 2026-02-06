import { NextResponse } from "next/server";
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

interface Slot {
  name: string;
  project: string;
  number: number;
  branch: string;
  path: string;
  createdAt: string;
  ports: {
    web: number;
    postgres: number;
  };
  docker: DockerContainer | null;
  claude: ClaudeInstance | null;
}

interface ProjectGroup {
  name: string;
  basePath: string;
  basePort: number;
  slots: Slot[];
}

interface WorkspaceMember {
  path: string;
  name: string;
  branch: string;
  claudes: ClaudeInstance[];
  dockers: DockerContainer[];
}

interface Workspace {
  name: string;
  description: string;
  members: WorkspaceMember[];
  createdAt: string;
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
        // Get working directory
        const { stdout: lsofOut } = await execAsync(
          `lsof -p ${pid} 2>/dev/null | grep cwd | awk '{print $NF}'`
        );
        const cwd = lsofOut.trim();
        if (!cwd || cwd === "/" || !cwd.startsWith("/Users")) continue;

        // Get branch
        const { stdout: branchOut } = await execAsync(
          `git -C "${cwd}" branch --show-current 2>/dev/null || echo "unknown"`
        );

        // Get runtime
        const { stdout: runtimeOut } = await execAsync(
          `ps -p ${pid} -o etime= 2>/dev/null || echo "unknown"`
        );

        // Try to get session info from claude projects dir
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

            // Get last assistant message and aggregate usage
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
                  // Get last message text
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
                // Rough cost estimate (opus: $15/$75 per 1M tokens, sonnet: $3/$15)
                const isOpus = model.includes("opus");
                const inputRate = isOpus ? 0.015 : 0.003;
                const outputRate = isOpus ? 0.075 : 0.015;
                const cacheRate = inputRate * 0.1; // Cache reads are ~10% of input cost

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
              // Ignore message parsing errors
            }
          }
        } catch {
          // Ignore session file errors
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
        // Skip this PID if we can't get info
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

export async function GET() {
  const [registry, containers, claudes] = await Promise.all([
    getRegistry(),
    getDockerContainers(),
    getClaudeInstances(),
  ]);

  // Build slots with docker and claude info
  const slots: Slot[] = Object.entries(registry.slots).map(([name, slot]) => {
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
      createdAt: slot.created_at,
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

  // Group by project
  const projectGroups: ProjectGroup[] = Object.entries(registry.projects).map(
    ([name, project]) => ({
      name,
      basePath: project.path,
      basePort: project.base_port,
      slots: slots.filter((s) => s.project === name),
    })
  );

  // Add orphan slots (project not registered)
  const orphanSlots = slots.filter(
    (s) => !registry.projects[s.project]
  );
  if (orphanSlots.length > 0) {
    projectGroups.push({
      name: "Other",
      basePath: "",
      basePort: 3000,
      slots: orphanSlots,
    });
  }

  // Build workspaces with claude matching (ALL matches, not just first)
  const workspaces: Workspace[] = await Promise.all(
    Object.entries(registry.workspaces || {}).map(async ([, ws]) => {
      const members: WorkspaceMember[] = await Promise.all(
        ws.paths.map(async (wsPath) => {
          const dirName = path.basename(wsPath);
          const branch = await getBranchForPath(wsPath);

          // Match ALL claudes by path (exact or starts with for subdirs)
          const matchedClaudes = claudes.filter(
            (c) => c.cwd === wsPath || c.cwd.startsWith(wsPath + "/")
          );

          // Match ALL docker containers by directory name pattern
          const matchedDockers = containers.filter(
            (c) => c.name.includes(dirName) || c.name.startsWith(dirName)
          );

          return {
            path: wsPath,
            name: dirName,
            branch,
            claudes: matchedClaudes,
            dockers: matchedDockers,
          };
        })
      );

      return {
        name: ws.name,
        description: ws.description,
        members,
        createdAt: ws.created_at,
      };
    })
  );

  // Track which claudes are matched to workspaces
  const workspaceClaudeCwds = workspaces
    .flatMap((ws) => ws.members)
    .flatMap((m) => m.claudes.map((c) => c.cwd));

  // Find unregistered claude instances (not matched to any slot or workspace)
  const matchedClaudeCwds = [
    ...slots.filter((s) => s.claude !== null).map((s) => s.claude!.cwd),
    ...workspaceClaudeCwds,
  ];
  const unregisteredClaudes = claudes.filter(
    (c) => !matchedClaudeCwds.includes(c.cwd)
  );

  // Track which containers are matched to workspaces
  const workspaceContainerNames = workspaces
    .flatMap((ws) => ws.members)
    .flatMap((m) => m.dockers.map((d) => d.name));

  // Find orphan docker containers (not matched to any slot or workspace)
  const matchedContainerNames = [
    ...slots.filter((s) => s.docker !== null).map((s) => s.docker!.name),
    ...workspaceContainerNames,
  ];
  const orphanContainers = containers.filter(
    (c) => !matchedContainerNames.includes(c.name)
  );

  return NextResponse.json({
    projects: projectGroups,
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
  });
}
