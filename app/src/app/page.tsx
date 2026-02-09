"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ClaudeCard,
  ContainerCard,
  formatTokens,
  TmuxCard,
} from "@/components/cards";
import { GroupSection } from "@/components/sections/group-section";
import { Section } from "@/components/sections/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row } from "@/components/ui/row";
import type { APIResponse, TmuxResponse, WorkspaceMember } from "@/lib/types";

function WorkspaceMemberCard({ member }: { member: WorkspaceMember }) {
  const hasDocker = member.dockers.length > 0;
  const hasClaude = member.claudes.length > 0;
  const totalCost = member.claudes.reduce(
    (sum, c) => sum + (c.usage?.estimatedCost || 0),
    0,
  );
  const totalTokens = member.claudes.reduce(
    (sum, c) => sum + (c.usage?.totalTokens || 0),
    0,
  );

  return (
    <Card className="py-4 gap-3 border-violet-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${hasClaude ? "bg-emerald-500" : "bg-muted"}`}
            />
            <CardTitle className="text-base font-mono truncate min-w-0">
              {member.name}
            </CardTitle>
          </div>
          {hasClaude && (
            <Badge
              variant="outline"
              className="text-xs font-normal shrink-0 text-violet-400 border-violet-500/30"
            >
              {member.claudes.length} claude
              {member.claudes.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="branch">
          <span className="text-sky-400">{member.branch}</span>
        </Row>
        <Row label="docker">
          {hasDocker ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-emerald-400">
                {member.dockers.length} container
                {member.dockers.length > 1 ? "s" : ""}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>
        {hasClaude && (
          <div className="pt-2 mt-2 border-t space-y-0">
            {totalTokens > 0 && (
              <Row label="tokens">
                <span className="text-emerald-400">
                  {formatTokens(totalTokens)}
                </span>
              </Row>
            )}
            {totalCost > 0 && (
              <Row label="cost">
                <span className="text-rose-400">${totalCost.toFixed(2)}</span>
              </Row>
            )}
          </div>
        )}
        {member.claudes.length > 0 && (
          <div className="pt-2 mt-2 border-t space-y-2">
            {member.claudes.map((claude) => (
              <div key={claude.pid} className="text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {claude.cwd.split("/").pop()}
                  </span>
                  <span className="text-amber-400">{claude.runtime}</span>
                </div>
                {claude.lastMessage && (
                  <p className="text-muted-foreground line-clamp-1">
                    {claude.lastMessage}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs truncate pt-2 font-mono">
          {member.path}
        </p>
      </CardContent>
    </Card>
  );
}

function WorkspaceSection({
  workspace,
}: {
  workspace: { name: string; description: string; members: WorkspaceMember[] };
}) {
  const totalClaudes = workspace.members.reduce(
    (sum, m) => sum + m.claudes.length,
    0,
  );
  const totalContainers = workspace.members.reduce(
    (sum, m) => sum + m.dockers.length,
    0,
  );
  const totalCost = workspace.members.reduce(
    (sum, m) =>
      sum + m.claudes.reduce((s, c) => s + (c.usage?.estimatedCost || 0), 0),
    0,
  );

  return (
    <Section title={workspace.name} color="violet">
      <div className="flex items-center gap-3 mb-4 text-sm text-muted-foreground">
        <span>{workspace.description}</span>
        <span>•</span>
        <span className="text-violet-400">
          {totalClaudes} claude{totalClaudes !== 1 ? "s" : ""}
        </span>
        <span>•</span>
        <span className="text-sky-400">
          {totalContainers} container{totalContainers !== 1 ? "s" : ""}
        </span>
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

  const fetchData = useCallback(async () => {
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
  }, []);

  const handleTmuxAction = async (action: string, name: string) => {
    try {
      await fetch("/api/tmux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name }),
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
  }, [fetchData]);

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
        <h1 className="text-2xl font-semibold mb-6">Workflow</h1>

        {/* Navigation buttons */}
        <nav className="flex flex-wrap gap-2 mb-4">
          <Link
            href="/slots"
            className="px-4 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 transition-colors font-medium"
          >
            Slots{" "}
            <span className="ml-1 font-mono">{data?.summary.totalSlots}</span>
          </Link>
          <Link
            href="/claude"
            className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors font-medium"
          >
            Claude{" "}
            <span className="ml-1 font-mono">
              {data?.summary.runningClaudes}
            </span>
          </Link>
          <Link
            href="/docker"
            className="px-4 py-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-colors font-medium"
          >
            Docker{" "}
            <span className="ml-1 font-mono">
              {data?.summary.runningContainers}
            </span>
          </Link>
          <Link
            href="/web"
            className="px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-colors font-medium"
          >
            Web{" "}
            <span className="ml-1 font-mono">
              {data?.summary.activeWebServers}
            </span>
          </Link>
          <Link
            href="/storybook"
            className="px-4 py-2 rounded-lg bg-pink-500/10 border border-pink-500/30 text-pink-400 hover:bg-pink-500/20 transition-colors font-medium"
          >
            Storybook{" "}
            <span className="ml-1 font-mono">
              {data?.summary.runningStorybooks}
            </span>
          </Link>
        </nav>

        {/* Summary stats */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>{data?.summary.totalGroups} groups</span>
          <span>•</span>
          <span>{data?.summary.totalSlots} slots</span>
          {(data?.summary.orphanClaudes ?? 0) > 0 && (
            <>
              <span>•</span>
              <span className="text-amber-500">
                {data?.summary.orphanClaudes} unregistered claude
              </span>
            </>
          )}
          {(data?.summary.orphanContainers ?? 0) > 0 && (
            <>
              <span>•</span>
              <span className="text-amber-500">
                {data?.summary.orphanContainers} orphan containers
              </span>
            </>
          )}
        </div>
      </header>

      {/* Workspaces */}
      {data?.workspaces &&
        data.workspaces.length > 0 &&
        data.workspaces.map((workspace) => (
          <WorkspaceSection key={workspace.name} workspace={workspace} />
        ))}

      {/* Groups with nested projects and slots */}
      {data?.groups?.map((group) => (
        <GroupSection key={group.id} group={group} />
      ))}

      {/* Unregistered Claude instances */}
      {data?.unregisteredClaudes && data.unregisteredClaudes.length > 0 && (
        <Section
          title="Unregistered Claude"
          count={data.unregisteredClaudes.length}
          color="amber"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.unregisteredClaudes.map((claude) => (
              <ClaudeCard key={claude.pid} claude={claude} />
            ))}
          </div>
        </Section>
      )}

      {/* Orphan containers */}
      {data?.orphanContainers && data.orphanContainers.length > 0 && (
        <Section
          title="Orphan Containers"
          count={data.orphanContainers.length}
          color="sky"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.orphanContainers.map((container) => (
              <ContainerCard key={container.name} container={container} />
            ))}
          </div>
        </Section>
      )}

      {/* Tmux Sessions */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-green-400">
            Tmux Sessions
            {tmuxData && (
              <span className="text-muted-foreground ml-2 font-normal">
                ({tmuxData.summary.total})
              </span>
            )}
          </h2>
          <button
            type="button"
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
                type="button"
                onClick={() => handleCreateSession(false)}
                className="text-sm px-3 py-2 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                Create
              </button>
              <button
                type="button"
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
              <TmuxCard
                key={session.name}
                session={session}
                onStartTtyd={(name) => handleTmuxAction("start-ttyd", name)}
                onStopTtyd={(name) => handleTmuxAction("stop-ttyd", name)}
                onKill={(name) => handleTmuxAction("kill", name)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No tmux sessions running
          </p>
        )}
      </section>
    </main>
  );
}
