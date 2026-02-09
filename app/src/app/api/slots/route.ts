import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execRaw = promisify(exec);

// All shell commands get a 5s timeout to prevent hanging
function execAsync(cmd: string, opts?: { timeout?: number }) {
  return execRaw(cmd, { timeout: opts?.timeout ?? 5000 });
}

interface SlotRegistry {
  groups?: Record<string, { name: string; order: number }>;
  projects: Record<string, { base_port: number; path: string; group?: string }>;
  slots: Record<
    string,
    {
      project: string;
      number: number;
      branch: string;
      created_at: string;
      tags?: string[];
      locked?: boolean;
      lock_note?: string;
    }
  >;
  workspaces?: Record<
    string,
    { name: string; description: string; paths: string[]; created_at: string }
  >;
  tags?: Record<string, { name: string; color: string }>;
}

interface DockerContainer {
  name: string;
  ports: { host: number; container: number }[];
  status: string;
  image: string;
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

interface PortInfo {
  port: number;
  active: boolean;
  owned: boolean; // true if process/container belongs to this project
  process: string | null; // process name or docker container
}

interface StorybookInstance {
  pid: number;
  port: number;
  cwd: string;
  project: string; // extracted from cwd
}

interface Slot {
  name: string;
  project: string;
  number: number;
  branch: string;
  path: string;
  createdAt: string;
  ports: {
    web: PortInfo | null;
    storybook: PortInfo | null;
  };
  containers: DockerContainer[]; // All matched containers
  claude: ClaudeInstance | null;
  tags: string[];
  locked: boolean;
  lockNote: string;
  orphan: boolean;
}

interface ProjectGroup {
  name: string;
  basePath: string;
  basePort: number;
  slots: Slot[];
}

interface Group {
  id: string;
  name: string;
  order: number;
  projects: ProjectGroup[];
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
      'docker ps --format "{{.Names}}|{{.Ports}}|{{.Status}}|{{.Image}}"',
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, portsStr, status, image] = line.split("|");

        // Parse all port mappings: "0.0.0.0:5432->5432/tcp, 0.0.0.0:6379->6379/tcp"
        const ports: { host: number; container: number }[] = [];
        const portMatches = portsStr.matchAll(/0\.0\.0\.0:(\d+)->(\d+)/g);
        for (const match of portMatches) {
          ports.push({
            host: parseInt(match[1], 10),
            container: parseInt(match[2], 10),
          });
        }

        return { name, ports, status, image };
      });
  } catch {
    return [];
  }
}

async function getClaudeInstances(): Promise<ClaudeInstance[]> {
  try {
    const { stdout: pids } = await execAsync(
      'pgrep -f "claude" 2>/dev/null || true',
    );
    const instances: ClaudeInstance[] = [];

    for (const pid of pids.trim().split("\n").filter(Boolean)) {
      try {
        // Get working directory
        const { stdout: lsofOut } = await execAsync(
          `lsof -p ${pid} 2>/dev/null | grep cwd | awk '{print $NF}'`,
        );
        const cwd = lsofOut.trim();
        if (!cwd || cwd === "/" || !cwd.startsWith("/Users")) continue;

        // Get branch
        const { stdout: branchOut } = await execAsync(
          `git -C "${cwd}" branch --show-current 2>/dev/null || echo "unknown"`,
        );

        // Get runtime
        const { stdout: runtimeOut } = await execAsync(
          `ps -p ${pid} -o etime= 2>/dev/null || echo "unknown"`,
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
            `ls -t "${sessionDir}"/*.jsonl 2>/dev/null | head -1`,
          );
          if (sessionFile.trim()) {
            const { stdout: modelOut } = await execAsync(
              `grep -o '"model":"[^"]*"' "${sessionFile.trim()}" 2>/dev/null | tail -1 | cut -d'"' -f4`,
            );
            const { stdout: slugOut } = await execAsync(
              `grep -o '"slug":"[^"]*"' "${sessionFile.trim()}" 2>/dev/null | tail -1 | cut -d'"' -f4`,
            );
            model =
              modelOut.trim().replace("claude-", "").replace("-20251101", "") ||
              "unknown";
            session = slugOut.trim() || "unknown";

            // Get last assistant message and aggregate usage
            try {
              const { stdout: assistantLines } = await execAsync(
                `grep '"type":"assistant"' "${sessionFile.trim()}" 2>/dev/null | tail -20`,
              );

              let totalInput = 0;
              let totalOutput = 0;
              let totalCacheRead = 0;

              for (const line of assistantLines
                .trim()
                .split("\n")
                .filter(Boolean)) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.message?.usage) {
                    const u = parsed.message.usage;
                    totalInput +=
                      (u.input_tokens || 0) +
                      (u.cache_creation_input_tokens || 0);
                    totalOutput += u.output_tokens || 0;
                    totalCacheRead += u.cache_read_input_tokens || 0;
                  }
                  // Get last message text
                  if (parsed.message?.content) {
                    const content = parsed.message.content;
                    if (typeof content === "string") {
                      lastMessage = content.slice(0, 200);
                    } else if (Array.isArray(content)) {
                      const textBlock = content.find(
                        (b: { type: string }) => b.type === "text",
                      );
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
                  (totalInput * inputRate) / 1000 +
                  (totalOutput * outputRate) / 1000 +
                  (totalCacheRead * cacheRate) / 1000;

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
          pid: parseInt(pid, 10),
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

    // Deduplicate by cwd (parent + child processes share same cwd)
    const seen = new Set<string>();
    const unique = instances.filter((inst) => {
      if (seen.has(inst.cwd)) return false;
      seen.add(inst.cwd);
      return true;
    });

    return unique;
  } catch {
    return [];
  }
}

async function getStorybookInstances(): Promise<StorybookInstance[]> {
  try {
    // Find storybook dispatcher processes (the main running storybook)
    const { stdout } = await execAsync(
      `ps aux | grep "storybook/dist/bin/dispatcher.js" | grep -v grep`,
    );

    const instances: StorybookInstance[] = [];

    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      try {
        // Parse: user PID ... node /path/to/storybook/dist/bin/dispatcher.js dev -p PORT
        const parts = line.split(/\s+/);
        const pid = parseInt(parts[1], 10);

        // Extract port from -p argument
        const pIndex = parts.indexOf("-p");
        const port =
          pIndex >= 0 && parts[pIndex + 1]
            ? parseInt(parts[pIndex + 1], 10)
            : 6006;

        // Extract project path from the command
        const pathMatch = line.match(
          /\/Users\/[^/]+\/Projects\/[^/]+\/([^/]+)/,
        );
        const project = pathMatch ? pathMatch[1] : "unknown";

        // Get full cwd
        const cwdMatch = line.match(/(\/Users\/[^\s]+\/node_modules)/);
        const cwd = cwdMatch
          ? cwdMatch[1].replace("/node_modules", "").replace("/apps/web", "")
          : "";

        instances.push({ pid, port, cwd, project });
      } catch {
        // Skip malformed lines
      }
    }

    return instances;
  } catch {
    return [];
  }
}

// Single lsof call to get ALL listening ports at once
async function getAllListeningPorts(): Promise<Map<number, string>> {
  const portMap = new Map<number, string>();
  try {
    const { stdout } = await execAsync(
      `lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | awk '{print $1, $9}'`,
    );
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const processName = parts[0];
      const portMatch = parts[1].match(/:(\d+)$/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        if (!portMap.has(port)) {
          portMap.set(port, processName);
        }
      }
    }
  } catch {
    // ignore
  }
  return portMap;
}

function getPortInfo(
  port: number | null,
  slotName: string | undefined,
  listeningPorts: Map<number, string>,
  containers: DockerContainer[],
): PortInfo | null {
  if (port === null || port === 0) return null;

  const processName = listeningPorts.get(port);
  if (!processName) {
    return { port, active: false, owned: false, process: null };
  }

  // Resolve docker process to container name
  let resolvedProcess = processName;
  if (
    processName === "OrbStack" ||
    processName === "com.docke" ||
    processName === "docker"
  ) {
    const container = containers.find((c) =>
      c.ports.some((p) => p.host === port),
    );
    resolvedProcess = container ? container.name : "docker";
  }

  // Check ownership
  let owned = false;
  if (slotName) {
    const normalizedSlot = slotName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedProcess = resolvedProcess
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    owned =
      normalizedProcess.includes(normalizedSlot) ||
      normalizedSlot.includes(normalizedProcess) ||
      resolvedProcess.toLowerCase().startsWith(slotName.toLowerCase());
  }

  return { port, active: true, owned, process: resolvedProcess };
}

async function getEnvPort(
  slotPath: string,
  varName: string,
): Promise<number | null> {
  const envFiles = [".env.local", ".env"];
  const subdirs = ["", "apps/web", "apps/api", "packages/ui"];

  for (const subdir of subdirs) {
    for (const envFile of envFiles) {
      try {
        const envPath = path.join(slotPath, subdir, envFile);
        const content = await readFile(envPath, "utf-8");
        const regex = new RegExp(`${varName}=["']?(\\d+)["']?`);
        const match = content.match(regex);
        if (match) {
          return parseInt(match[1], 10);
        }
      } catch {
        // File doesn't exist, continue
      }
    }
  }
  return null;
}

async function _getStorybookPort(slotPath: string): Promise<number | null> {
  try {
    // Try to read STORYBOOK_PORT from .env files
    for (const envFile of [".env.local", ".env"]) {
      try {
        const envPath = path.join(slotPath, envFile);
        const content = await readFile(envPath, "utf-8");
        const match = content.match(/STORYBOOK_PORT=["']?(\d+)["']?/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } catch {
        // File doesn't exist, continue
      }
    }
    // Check apps/web/.env.local or similar nested locations
    for (const subdir of ["apps/web", "packages/ui"]) {
      for (const envFile of [".env.local", ".env"]) {
        try {
          const envPath = path.join(slotPath, subdir, envFile);
          const content = await readFile(envPath, "utf-8");
          const match = content.match(/STORYBOOK_PORT=["']?(\d+)["']?/);
          if (match) {
            return parseInt(match[1], 10);
          }
        } catch {
          // File doesn't exist, continue
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getBranchForPath(dirPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `git -C "${dirPath}" branch --show-current 2>/dev/null || echo "unknown"`,
    );
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

export async function GET() {
  try {
    return await Promise.race([
      handleGET(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("API timeout")), 15000),
      ),
    ]);
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Request timed out or failed" },
      { status: 500 },
    );
  }
}

async function handleGET() {
  const [registry, containers, claudes, storybooks, listeningPorts] =
    await Promise.all([
      getRegistry(),
      getDockerContainers(),
      getClaudeInstances(),
      getStorybookInstances(),
      getAllListeningPorts(),
    ]);

  // Build slots with docker and claude info
  const slotsWithStorybook = await Promise.all(
    Object.entries(registry.slots).map(async ([name, slot]) => {
      const project = registry.projects[slot.project];

      const slotPath = project?.path
        ? path.join(path.dirname(project.path), name)
        : "";

      // Check if directory exists on disk
      const orphan = !slotPath || !existsSync(slotPath);

      // Read ports from .env files
      const [webPort, storybookPort] =
        slotPath && !orphan
          ? await Promise.all([
              getEnvPort(slotPath, "PORT"),
              getEnvPort(slotPath, "STORYBOOK_PORT"),
            ])
          : [null, null];

      // Check port status (sync lookup from cached lsof)
      const webInfo = getPortInfo(webPort, name, listeningPorts, containers);
      const storybookInfo = getPortInfo(
        storybookPort,
        name,
        listeningPorts,
        containers,
      );

      // Match all containers that start with slot name
      const matchedContainers = containers.filter(
        (c) => c.name.startsWith(name) || c.name.startsWith(`${name}-`),
      );

      return {
        name,
        project: slot.project,
        number: slot.number,
        branch: slot.branch,
        path: slotPath,
        createdAt: slot.created_at,
        ports: {
          web: webInfo,
          storybook: storybookInfo,
        },
        containers: matchedContainers,
        // Match claude by exact path OR subdirectories within the slot
        claude:
          claudes.find(
            (c) =>
              slotPath &&
              (c.cwd === slotPath || c.cwd.startsWith(`${slotPath}/`)),
          ) || null,
        tags: slot.tags || [],
        locked: slot.locked || false,
        lockNote: slot.lock_note || "",
        orphan,
      };
    }),
  );
  const slots: Slot[] = slotsWithStorybook;

  // Create "main" slot for each registered project (the parent worktree)
  const mainSlotsWithStorybook = await Promise.all(
    Object.entries(registry.projects).map(async ([name, project]) => {
      const mainPath = project.path;

      // Read ports from .env files
      const [webPort, storybookPort] = mainPath
        ? await Promise.all([
            getEnvPort(mainPath, "PORT"),
            getEnvPort(mainPath, "STORYBOOK_PORT"),
          ])
        : [null, null];

      // Check port status (sync lookup from cached lsof)
      const webInfo = getPortInfo(webPort, name, listeningPorts, containers);
      const storybookInfo = getPortInfo(
        storybookPort,
        name,
        listeningPorts,
        containers,
      );

      // Match containers that start with project name (but not slot names like project-1)
      const matchedContainers = containers.filter(
        (c) =>
          (c.name.startsWith(name) || c.name.startsWith(`${name}-`)) &&
          !c.name.match(new RegExp(`^${name}-\\d`)), // Exclude slot containers like project-1-db
      );

      return {
        name: name,
        project: name,
        number: 0, // main is always slot 0
        branch: "main",
        path: mainPath,
        createdAt: "",
        ports: {
          web: webInfo,
          storybook: storybookInfo,
        },
        containers: matchedContainers,
        claude:
          claudes.find(
            (c) =>
              mainPath &&
              (c.cwd === mainPath || c.cwd.startsWith(`${mainPath}/`)),
          ) || null,
        tags: [],
        locked: false,
        lockNote: "",
        orphan: false,
      };
    }),
  );
  const mainSlots: Slot[] = mainSlotsWithStorybook;

  // Group by project (main + numbered slots)
  const projectGroups: ProjectGroup[] = Object.entries(registry.projects).map(
    ([name, project]) => {
      const mainSlot = mainSlots.find((s) => s.project === name);
      const numberedSlots = slots.filter((s) => s.project === name);
      return {
        name,
        basePath: project.path,
        basePort: project.base_port,
        slots: mainSlot ? [mainSlot, ...numberedSlots] : numberedSlots,
      };
    },
  );

  // Add orphan slots (project not registered)
  const orphanSlots = slots.filter((s) => !registry.projects[s.project]);
  if (orphanSlots.length > 0) {
    projectGroups.push({
      name: "Other",
      basePath: "",
      basePort: 3000,
      slots: orphanSlots,
    });
  }

  // Build hierarchical groups
  const registryGroups = registry.groups || {};
  const groups: Group[] = Object.entries(registryGroups)
    .map(([id, group]) => {
      const groupProjects = projectGroups.filter(
        (pg) => registry.projects[pg.name]?.group === id,
      );
      return {
        id,
        name: group.name,
        order: group.order,
        projects: groupProjects,
      };
    })
    .sort((a, b) => a.order - b.order);

  // Add ungrouped projects to "Other" group
  const ungroupedProjects = projectGroups.filter(
    (pg) => !registry.projects[pg.name]?.group,
  );
  if (ungroupedProjects.length > 0) {
    groups.push({
      id: "other",
      name: "Other",
      order: 999,
      projects: ungroupedProjects,
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
            (c) => c.cwd === wsPath || c.cwd.startsWith(`${wsPath}/`),
          );

          // Match ALL docker containers by directory name pattern
          const matchedDockers = containers.filter(
            (c) => c.name.includes(dirName) || c.name.startsWith(dirName),
          );

          return {
            path: wsPath,
            name: dirName,
            branch,
            claudes: matchedClaudes,
            dockers: matchedDockers,
          };
        }),
      );

      return {
        name: ws.name,
        description: ws.description,
        members,
        createdAt: ws.created_at,
      };
    }),
  );

  // Track which claudes are matched to workspaces
  const workspaceClaudeCwds = workspaces
    .flatMap((ws) => ws.members)
    .flatMap((m) => m.claudes.map((c) => c.cwd));

  // Find unregistered claude instances (not matched to any slot, main, or workspace)
  const matchedClaudeCwds = [
    ...slots.filter((s) => s.claude !== null).map((s) => s.claude?.cwd),
    ...mainSlots.filter((s) => s.claude !== null).map((s) => s.claude?.cwd),
    ...workspaceClaudeCwds,
  ];
  const unregisteredClaudes = claudes.filter(
    (c) => !matchedClaudeCwds.includes(c.cwd),
  );

  // Track which containers are matched to workspaces
  const workspaceContainerNames = workspaces
    .flatMap((ws) => ws.members)
    .flatMap((m) => m.dockers.map((d) => d.name));

  // Find orphan docker containers (not matched to any slot or workspace)
  const matchedContainerNames = [
    ...slots.flatMap((s) => s.containers.map((c) => c.name)),
    ...mainSlots.flatMap((s) => s.containers.map((c) => c.name)),
    ...workspaceContainerNames,
  ];
  const orphanContainers = containers.filter(
    (c) => !matchedContainerNames.includes(c.name),
  );

  // Find orphan storybook instances (port doesn't match any slot's configured storybook port)
  const allSlotStorybookPorts = [
    ...slots
      .filter((s) => s.ports.storybook?.port)
      .map((s) => s.ports.storybook?.port),
    ...mainSlots
      .filter((s) => s.ports.storybook?.port)
      .map((s) => s.ports.storybook?.port),
  ];
  const orphanStorybooks = storybooks.filter(
    (sb) => !allSlotStorybookPorts.includes(sb.port),
  );

  // Count active web servers across all slots
  const allSlots = [...slots, ...mainSlots];
  const activeWebServers = allSlots.filter((s) => s.ports.web?.active).length;

  return NextResponse.json({
    groups,
    projects: projectGroups, // kept for backward compatibility
    workspaces,
    unregisteredClaudes,
    orphanContainers,
    orphanStorybooks,
    allStorybooks: storybooks,
    tags: registry.tags || {},
    summary: {
      totalSlots: slots.length,
      totalWorkspaces: workspaces.length,
      totalGroups: groups.length,
      runningClaudes: claudes.length,
      runningContainers: containers.length,
      runningStorybooks: storybooks.length,
      activeWebServers,
      orphanClaudes: unregisteredClaudes.length,
      orphanContainers: orphanContainers.length,
      orphanStorybooks: orphanStorybooks.length,
    },
  });
}
