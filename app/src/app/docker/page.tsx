"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ContainerCard } from "@/components/cards";
import type { APIResponse, DockerContainer } from "@/lib/types";

export default function DockerPage() {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Group containers by source (slot/workspace/orphan)
  const grouped: {
    label: string;
    prefix: string;
    containers: DockerContainer[];
  }[] = [];

  data?.groups?.forEach((group) => {
    group.projects.forEach((project) => {
      project.slots.forEach((slot) => {
        if (slot.containers.length > 0) {
          grouped.push({
            label: slot.name,
            prefix: slot.name,
            containers: slot.containers,
          });
        }
      });
    });
  });

  data?.workspaces?.forEach((workspace) => {
    workspace.members.forEach((member) => {
      if (member.dockers.length > 0) {
        grouped.push({
          label: member.name,
          prefix: member.name,
          containers: member.dockers,
        });
      }
    });
  });

  if (data?.orphanContainers && data.orphanContainers.length > 0) {
    grouped.push({
      label: "Orphan",
      prefix: "",
      containers: data.orphanContainers,
    });
  }

  const totalContainers = grouped.reduce(
    (sum, g) => sum + g.containers.length,
    0,
  );

  const handleStopGroup = async (prefix: string) => {
    await fetch("/api/docker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop-containers", prefix }),
    });
    fetchData();
  };

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
          <h1 className="text-2xl font-semibold text-violet-400">
            Docker Containers
          </h1>
          <span className="text-muted-foreground">({totalContainers})</span>
        </div>
      </header>

      {grouped.length === 0 ? (
        <p className="text-muted-foreground">No Docker containers running</p>
      ) : (
        grouped.map((group) => (
          <section key={group.label} className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium text-sky-400">
                  {group.label}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {group.containers.length} container
                  {group.containers.length !== 1 ? "s" : ""}
                </span>
              </div>
              {group.prefix && (
                <button
                  type="button"
                  onClick={() => handleStopGroup(group.prefix)}
                  className="text-xs px-3 py-1.5 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                >
                  Stop All
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {group.containers.map((container) => (
                <ContainerCard
                  key={container.name}
                  container={container}
                  onStopped={fetchData}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
