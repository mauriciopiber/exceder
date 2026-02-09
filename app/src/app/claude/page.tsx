"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClaudeCard } from "@/components/cards";
import type { APIResponse, ClaudeInstance } from "@/lib/types";

export default function ClaudePage() {
  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/slots");
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleStopAll = async () => {
    await fetch("/api/docker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop-all-claudes" }),
    });
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Collect all Claude instances
  const allClaudes: { claude: ClaudeInstance; source: string }[] = [];

  // From slots
  data?.groups?.forEach((group) => {
    group.projects.forEach((project) => {
      project.slots.forEach((slot) => {
        if (slot.claude) {
          allClaudes.push({ claude: slot.claude, source: slot.name });
        }
      });
    });
  });

  // From workspaces
  data?.workspaces?.forEach((workspace) => {
    workspace.members.forEach((member) => {
      member.claudes.forEach((claude) => {
        allClaudes.push({ claude, source: member.name });
      });
    });
  });

  // Unregistered
  data?.unregisteredClaudes?.forEach((claude) => {
    allClaudes.push({ claude, source: "unregistered" });
  });

  return (
    <main className="max-w-7xl mx-auto p-8">
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Link>
          <h1 className="text-2xl font-semibold text-emerald-400">
            Claude Instances
          </h1>
          <span className="text-muted-foreground">({allClaudes.length})</span>
          {allClaudes.length > 0 && (
            <button
              type="button"
              onClick={handleStopAll}
              className="text-xs px-3 py-1.5 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 ml-auto"
            >
              Stop All
            </button>
          )}
        </div>
      </header>

      {allClaudes.length === 0 ? (
        <p className="text-muted-foreground">No Claude instances running</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {allClaudes.map(({ claude }) => (
            <ClaudeCard
              key={claude.pid}
              claude={claude}
              onStopped={fetchData}
            />
          ))}
        </div>
      )}
    </main>
  );
}
