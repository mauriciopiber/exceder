"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    storybook: number | null;
  };
  docker: DockerContainer | null;
  claude: ClaudeInstance | null;
  tags: string[];
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

interface APIResponse {
  groups: Group[];
  projects: ProjectGroup[];
  workspaces: Workspace[];
  unregisteredClaudes: ClaudeInstance[];
  orphanContainers: DockerContainer[];
  tags: Record<string, { name: string; color: string }>;
  summary: {
    totalSlots: number;
    totalWorkspaces: number;
    totalGroups: number;
    runningClaudes: number;
    runningContainers: number;
    orphanClaudes: number;
    orphanContainers: number;
  };
}

interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
  lastActivity: string;
  ttydPort: number | null;
}

interface TmuxResponse {
  sessions: TmuxSession[];
  summary: {
    total: number;
    attached: number;
    withTtyd: number;
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1 gap-2 min-w-0">
      <span className="text-muted-foreground text-sm shrink-0">{label}</span>
      <span className="font-mono text-sm truncate min-w-0">{children}</span>
    </div>
  );
}

function PortLink({ port, label }: { port: number; label?: string }) {
  return (
    <a
      href={`http://localhost:${port}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-400 hover:text-emerald-300 hover:underline transition-colors"
    >
      {label || port}
    </a>
  );
}

function SlotCard({ slot }: { slot: Slot }) {
  const isActive = slot.claude !== null;
  const hasDocker = slot.docker !== null;
  const hasTags = slot.tags && slot.tags.length > 0;

  // Build chat URL with project path and tmux session (convention: slot name)
  const chatUrl = `/chat?project=${encodeURIComponent(slot.path)}&tmux=${encodeURIComponent(slot.name)}`;

  return (
    <Card className="py-4 gap-3 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-emerald-500" : "bg-muted"}`} />
            <CardTitle className="text-base font-mono truncate">{slot.name}</CardTitle>
          </div>
          {slot.number === 0 ? (
            <Badge variant="outline" className="text-xs font-normal shrink-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">main</Badge>
          ) : (
            <Badge variant="outline" className="text-xs font-normal shrink-0">#{slot.number}</Badge>
          )}
        </div>
        {hasTags && (
          <div className="flex flex-wrap gap-1 mt-2">
            {slot.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs bg-violet-500/10 text-violet-400 border-violet-500/30">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="branch"><span className="text-sky-400">{slot.branch}</span></Row>
        <Row label="web"><PortLink port={slot.ports.web} /></Row>
        <Row label="db"><span className="text-muted-foreground">{slot.ports.postgres}</span></Row>
        {slot.ports.storybook && (
          <Row label="storybook"><PortLink port={slot.ports.storybook} /></Row>
        )}
        <Row label="docker">
          {hasDocker ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-emerald-400 truncate">{slot.docker?.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>
        {slot.claude && (
          <div className="pt-2 mt-2 border-t space-y-0">
            <Row label="model"><span className="text-violet-400">{slot.claude.model}</span></Row>
            <Row label="uptime"><span className="text-amber-400">{slot.claude.runtime}</span></Row>
          </div>
        )}
        {/* Chat button - links to chat UI with slot context */}
        <div className="pt-3 mt-3 border-t">
          <a
            href={chatUrl}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
          >
            <span>💬</span>
            <span>Chat</span>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceMemberCard({ member }: { member: WorkspaceMember }) {
  const hasDocker = member.dockers.length > 0;
  const hasClaude = member.claudes.length > 0;
  const totalCost = member.claudes.reduce((sum, c) => sum + (c.usage?.estimatedCost || 0), 0);
  const totalTokens = member.claudes.reduce((sum, c) => sum + (c.usage?.totalTokens || 0), 0);

  return (
    <Card className="py-4 gap-3 border-violet-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${hasClaude ? "bg-emerald-500" : "bg-muted"}`} />
            <CardTitle className="text-base font-mono truncate min-w-0">{member.name}</CardTitle>
          </div>
          {hasClaude && (
            <Badge variant="outline" className="text-xs font-normal shrink-0 text-violet-400 border-violet-500/30">
              {member.claudes.length} claude{member.claudes.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="branch"><span className="text-sky-400">{member.branch}</span></Row>
        <Row label="docker">
          {hasDocker ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-emerald-400">{member.dockers.length} container{member.dockers.length > 1 ? "s" : ""}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>
        {hasClaude && (
          <div className="pt-2 mt-2 border-t space-y-0">
            {totalTokens > 0 && (
              <Row label="tokens">
                <span className="text-emerald-400">{formatTokens(totalTokens)}</span>
              </Row>
            )}
            {totalCost > 0 && (
              <Row label="cost">
                <span className="text-rose-400">${totalCost.toFixed(2)}</span>
              </Row>
            )}
          </div>
        )}
        {/* Show each Claude instance */}
        {member.claudes.length > 0 && (
          <div className="pt-2 mt-2 border-t space-y-2">
            {member.claudes.map((claude) => (
              <div key={claude.pid} className="text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{claude.cwd.split("/").pop()}</span>
                  <span className="text-amber-400">{claude.runtime}</span>
                </div>
                {claude.lastMessage && (
                  <p className="text-muted-foreground line-clamp-1">{claude.lastMessage}</p>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs truncate pt-2 font-mono">{member.path}</p>
      </CardContent>
    </Card>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toString();
}

function ClaudeCard({ claude }: { claude: ClaudeInstance }) {
  const name = claude.cwd.split("/").pop() || "unknown";

  return (
    <Card className="py-4 gap-3 border-amber-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <CardTitle className="text-base font-mono truncate min-w-0">{name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="branch"><span className="text-sky-400 truncate">{claude.branch}</span></Row>
        <Row label="model"><span className="text-violet-400">{claude.model}</span></Row>
        <Row label="uptime"><span className="text-amber-400">{claude.runtime}</span></Row>
        {claude.usage && (
          <div className="pt-2 mt-2 border-t space-y-0">
            <Row label="tokens">
              <span className="text-emerald-400">{formatTokens(claude.usage.totalTokens)}</span>
            </Row>
            <Row label="cost">
              <span className="text-rose-400">${claude.usage.estimatedCost.toFixed(2)}</span>
            </Row>
          </div>
        )}
        {claude.lastMessage && (
          <p className="text-muted-foreground text-xs line-clamp-2 pt-2 mt-2 border-t">
            {claude.lastMessage}
          </p>
        )}
        <p className="text-muted-foreground text-xs truncate pt-2 font-mono">{claude.cwd}</p>
      </CardContent>
    </Card>
  );
}

function ContainerCard({ container }: { container: DockerContainer }) {
  return (
    <Card className="py-4 gap-3 border-sky-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
          <CardTitle className="text-sm font-mono truncate min-w-0">{container.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="port"><span className="text-emerald-400">{container.port || "—"}</span></Row>
        <Row label="status"><span className="text-muted-foreground">{container.status}</span></Row>
      </CardContent>
    </Card>
  );
}

function TmuxSessionCard({ session, onStartTtyd, onStopTtyd, onKill }: {
  session: TmuxSession;
  onStartTtyd: (name: string) => void;
  onStopTtyd: (name: string) => void;
  onKill: (name: string) => void;
}) {
  const hasTtyd = session.ttydPort !== null;

  return (
    <Card className="py-4 gap-3 border-green-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${session.attached ? "bg-emerald-500" : "bg-amber-500"}`} />
            <CardTitle className="text-base font-mono truncate">{session.name}</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs font-normal shrink-0">
            {session.windows} win
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="status">
          <span className={session.attached ? "text-emerald-400" : "text-amber-400"}>
            {session.attached ? "attached" : "detached"}
          </span>
        </Row>
        <Row label="web">
          {hasTtyd ? (
            <a
              href={`http://localhost:${session.ttydPort}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              :{session.ttydPort}
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>
        <Row label="activity">
          <span className="text-muted-foreground text-xs">
            {new Date(session.lastActivity).toLocaleTimeString()}
          </span>
        </Row>

        {/* Actions */}
        <div className="pt-3 mt-3 border-t flex gap-2">
          {hasTtyd ? (
            <button
              onClick={() => onStopTtyd(session.name)}
              className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            >
              Stop Web
            </button>
          ) : (
            <button
              onClick={() => onStartTtyd(session.name)}
              className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            >
              Start Web
            </button>
          )}
          <button
            onClick={() => onKill(session.name)}
            className="text-xs px-2 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
          >
            Kill
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ title, count, color, children }: {
  title: string;
  count?: number;
  color?: "amber" | "sky" | "violet";
  children: React.ReactNode
}) {
  const titleColors = {
    amber: "text-amber-400",
    sky: "text-sky-400",
    violet: "text-violet-400",
  };
  const titleColor = color ? titleColors[color] : "";

  return (
    <section className="mb-8">
      <h2 className={`text-lg font-medium mb-4 ${titleColor}`}>
        {title}
        {count !== undefined && <span className="text-muted-foreground ml-2 font-normal">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

function ProjectSection({ project, nested }: { project: ProjectGroup; nested?: boolean }) {
  const activeSlots = project.slots.filter((s) => s.claude !== null);

  return (
    <div className={nested ? "mb-6" : "mb-8"}>
      <div className="flex items-center gap-3 mb-3">
        <h3 className={`font-medium ${nested ? "text-base" : "text-lg"}`}>{project.name}</h3>
        <span className="text-sm text-muted-foreground font-mono">{project.basePath.split("/").slice(-2).join("/")}</span>
        <span className="text-sm text-muted-foreground">•</span>
        <span className="text-sm">port <span className="text-foreground font-mono">{project.basePort}</span></span>
        <span className="text-sm text-muted-foreground">•</span>
        <span className="text-sm text-emerald-500">{activeSlots.length}</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">{project.slots.length} slots</span>
      </div>

      {project.slots.length === 0 ? (
        <p className="text-muted-foreground text-sm">No slots</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {project.slots.map((slot) => (
            <SlotCard key={slot.name} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupSection({ group }: { group: Group }) {
  const totalSlots = group.projects.reduce((sum, p) => sum + p.slots.length, 0);
  const activeSlots = group.projects.reduce(
    (sum, p) => sum + p.slots.filter((s) => s.claude !== null).length,
    0
  );

  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 mb-4 pb-2 border-b">
        <h2 className="text-xl font-semibold text-violet-400">{group.name}</h2>
        <span className="text-sm text-muted-foreground">
          {group.projects.length} project{group.projects.length !== 1 ? "s" : ""}
        </span>
        <span className="text-sm text-muted-foreground">•</span>
        <span className="text-sm">
          <span className="text-emerald-500">{activeSlots}</span>
          <span className="text-muted-foreground">/{totalSlots} active</span>
        </span>
      </div>

      <div className="pl-4 border-l-2 border-violet-500/20">
        {group.projects.map((project) => (
          <ProjectSection key={project.name} project={project} nested />
        ))}
      </div>
    </section>
  );
}

function WorkspaceSection({ workspace }: { workspace: Workspace }) {
  const totalClaudes = workspace.members.reduce((sum, m) => sum + m.claudes.length, 0);
  const totalContainers = workspace.members.reduce((sum, m) => sum + m.dockers.length, 0);
  const totalCost = workspace.members.reduce(
    (sum, m) => sum + m.claudes.reduce((s, c) => s + (c.usage?.estimatedCost || 0), 0),
    0
  );

  return (
    <Section title={workspace.name} color="violet">
      <div className="flex items-center gap-3 mb-4 text-sm text-muted-foreground">
        <span>{workspace.description}</span>
        <span>•</span>
        <span className="text-violet-400">{totalClaudes} claude{totalClaudes !== 1 ? "s" : ""}</span>
        <span>•</span>
        <span className="text-sky-400">{totalContainers} container{totalContainers !== 1 ? "s" : ""}</span>
        {totalCost > 0 && (
          <>
            <span>•</span>
            <span className="text-rose-400">${totalCost.toFixed(2)}</span>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {workspace.members.map((member) => (
          <WorkspaceMemberCard key={member.path} member={member} />
        ))}
      </div>
    </Section>
  );
}

export default function Home() {
  const [data, setData] = useState<APIResponse | null>(null);
  const [tmuxData, setTmuxData] = useState<TmuxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSessionName, setNewSessionName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchData = async () => {
    try {
      const [slotsRes, tmuxRes] = await Promise.all([
        fetch("/api/slots"),
        fetch("/api/tmux"),
      ]);

      if (!slotsRes.ok) throw new Error("Failed to fetch slots");

      const slotsJson = await slotsRes.json();
      setData(slotsJson);

      if (tmuxRes.ok) {
        const tmuxJson = await tmuxRes.json();
        setTmuxData(tmuxJson);
      }

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleTmuxAction = async (action: string, name: string, extra?: Record<string, unknown>) => {
    try {
      await fetch("/api/tmux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name, ...extra }),
      });
      fetchData();
    } catch (e) {
      console.error("Tmux action failed:", e);
    }
  };

  const handleCreateSession = async (withTtyd: boolean) => {
    if (!newSessionName.trim()) return;

    try {
      await fetch("/api/tmux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: withTtyd ? "create-with-ttyd" : "create",
          name: newSessionName.trim(),
        }),
      });
      setNewSessionName("");
      setShowCreateForm(false);
      fetchData();
    } catch (e) {
      console.error("Create session failed:", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-destructive">Error: {error}</span>
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold mb-4">Workflow</h1>
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Groups</span>
            <span className="font-mono">{data?.summary.totalGroups}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Slots</span>
            <span className="font-mono">{data?.summary.totalSlots}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Claude</span>
            <span className="font-mono">{data?.summary.runningClaudes}</span>
            {(data?.summary.orphanClaudes ?? 0) > 0 && (
              <span className="text-amber-500 text-xs">({data?.summary.orphanClaudes} unregistered)</span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Docker</span>
            <span className="font-mono">{data?.summary.runningContainers}</span>
            {(data?.summary.orphanContainers ?? 0) > 0 && (
              <span className="text-amber-500 text-xs">({data?.summary.orphanContainers} orphan)</span>
            )}
          </div>
        </div>
      </header>

      {/* Workspaces first - grouped work */}
      {data?.workspaces && data.workspaces.length > 0 && (
        <>
          {data.workspaces.map((workspace) => (
            <WorkspaceSection key={workspace.name} workspace={workspace} />
          ))}
        </>
      )}

      {/* Groups with nested projects and slots */}
      {data?.groups?.map((group) => (
        <GroupSection key={group.id} group={group} />
      ))}

      {data?.unregisteredClaudes && data.unregisteredClaudes.length > 0 && (
        <Section title="Unregistered Claude" count={data.unregisteredClaudes.length} color="amber">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.unregisteredClaudes.map((claude) => (
              <ClaudeCard key={claude.pid} claude={claude} />
            ))}
          </div>
        </Section>
      )}

      {data?.orphanContainers && data.orphanContainers.length > 0 && (
        <Section title="Orphan Containers" count={data.orphanContainers.length} color="sky">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.orphanContainers.map((container) => (
              <ContainerCard key={container.name} container={container} />
            ))}
          </div>
        </Section>
      )}

      {/* Tmux Sessions Section */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-green-400">
            Tmux Sessions
            {tmuxData && <span className="text-muted-foreground ml-2 font-normal">({tmuxData.summary.total})</span>}
          </h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="text-sm px-3 py-1.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
          >
            + New Session
          </button>
        </div>

        {showCreateForm && (
          <div className="mb-4 p-4 border border-green-500/20 rounded-lg bg-green-500/5">
            <div className="flex gap-2">
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="Session name..."
                className="flex-1 px-3 py-2 text-sm bg-background border rounded focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <button
                onClick={() => handleCreateSession(false)}
                className="text-sm px-3 py-2 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                Create
              </button>
              <button
                onClick={() => handleCreateSession(true)}
                className="text-sm px-3 py-2 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              >
                Create + Web
              </button>
            </div>
          </div>
        )}

        {tmuxData && tmuxData.sessions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {tmuxData.sessions.map((session) => (
              <TmuxSessionCard
                key={session.name}
                session={session}
                onStartTtyd={(name) => handleTmuxAction("start-ttyd", name)}
                onStopTtyd={(name) => handleTmuxAction("stop-ttyd", name)}
                onKill={(name) => handleTmuxAction("kill", name)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No tmux sessions running</p>
        )}
      </section>
    </main>
  );
}
