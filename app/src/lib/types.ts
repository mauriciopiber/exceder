export interface PortInfo {
  port: number;
  active: boolean;
  owned: boolean;
  process: string | null;
}

export interface DockerContainer {
  name: string;
  ports: { host: number; container: number }[];
  status: string;
  image: string;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ClaudeInstance {
  pid: number;
  cwd: string;
  branch: string;
  runtime: string;
  model: string;
  session: string;
  lastMessage: string | null;
  usage: ClaudeUsage | null;
}

export interface StorybookInstance {
  pid: number;
  port: number;
  cwd: string;
  project: string;
}

export interface Slot {
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
  containers: DockerContainer[];
  claude: ClaudeInstance | null;
  tags: string[];
  locked: boolean;
  lockNote: string;
  orphan: boolean;
}

export interface ProjectGroup {
  name: string;
  basePath: string;
  basePort: number;
  slots: Slot[];
}

export interface Group {
  id: string;
  name: string;
  order: number;
  projects: ProjectGroup[];
}

export interface WorkspaceMember {
  path: string;
  name: string;
  branch: string;
  claudes: ClaudeInstance[];
  dockers: DockerContainer[];
}

export interface Workspace {
  name: string;
  description: string;
  members: WorkspaceMember[];
  createdAt: string;
}

export interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
  lastActivity: string;
  ttydPort: number | null;
}

export interface APIResponse {
  groups: Group[];
  projects: ProjectGroup[];
  workspaces: Workspace[];
  unregisteredClaudes: ClaudeInstance[];
  orphanContainers: DockerContainer[];
  orphanStorybooks: StorybookInstance[];
  allStorybooks: StorybookInstance[];
  tags: Record<string, { name: string; color: string }>;
  summary: {
    totalSlots: number;
    totalWorkspaces: number;
    totalGroups: number;
    runningClaudes: number;
    runningContainers: number;
    runningStorybooks: number;
    activeWebServers: number;
    orphanClaudes: number;
    orphanContainers: number;
    orphanStorybooks: number;
  };
}

export interface TmuxResponse {
  sessions: TmuxSession[];
  summary: {
    total: number;
    attached: number;
    withTtyd: number;
  };
}
