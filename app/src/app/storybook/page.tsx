"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SlotCard } from "@/components/cards";
import { Section } from "@/components/sections/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row } from "@/components/ui/row";
import type { APIResponse, Slot, StorybookInstance } from "@/lib/types";

function OrphanStorybookCard({
  storybook,
  onStopped,
}: {
  storybook: StorybookInstance;
  onStopped?: () => void;
}) {
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop-storybook", pid: storybook.pid }),
      });
      onStopped?.();
    } catch (e) {
      console.error("Failed to stop storybook:", e);
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card className="py-4 gap-3 border-amber-500/20">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-mono">
            {storybook.project}
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`http://localhost:${storybook.port}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-2 py-1 rounded bg-pink-500/10 text-pink-400 hover:bg-pink-500/20"
            >
              :{storybook.port}
            </a>
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="text-xs px-2 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {stopping ? "..." : "Stop"}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="pid">
          <span className="text-muted-foreground">{storybook.pid}</span>
        </Row>
        <Row label="status">
          <span className="text-amber-400">orphan</span>
        </Row>
        {storybook.cwd && (
          <p className="text-muted-foreground text-xs truncate pt-2 font-mono">
            {storybook.cwd}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function StorybookPage() {
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
      body: JSON.stringify({ action: "stop-all-storybooks" }),
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

  // Collect slots with active storybook ports
  const slotsWithStorybook: { slot: Slot; project: string }[] = [];

  data?.groups?.forEach((group) => {
    group.projects.forEach((project) => {
      project.slots.forEach((slot) => {
        if (slot.ports?.storybook?.active) {
          slotsWithStorybook.push({ slot, project: project.name });
        }
      });
    });
  });

  const orphanStorybooks = data?.orphanStorybooks || [];
  const totalRunning = data?.summary.runningStorybooks || 0;

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
          <h1 className="text-2xl font-semibold text-pink-400">
            Storybook Instances
          </h1>
          <span className="text-muted-foreground">
            ({totalRunning} running)
          </span>
          {totalRunning > 0 && (
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

      {/* Slots with active storybook */}
      <Section
        title="Attached to Slots"
        count={slotsWithStorybook.length}
        color="pink"
      >
        {slotsWithStorybook.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No slots with active storybook
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {slotsWithStorybook.map(({ slot }) => (
              <SlotCard key={slot.name} slot={slot} />
            ))}
          </div>
        )}
      </Section>

      {/* Orphan storybooks */}
      {orphanStorybooks.length > 0 && (
        <Section
          title="Orphan Storybooks"
          count={orphanStorybooks.length}
          color="amber"
        >
          <p className="text-muted-foreground text-sm mb-4">
            Running on ports not configured in any slot's .env
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {orphanStorybooks.map((sb) => (
              <OrphanStorybookCard
                key={sb.pid}
                storybook={sb}
                onStopped={fetchData}
              />
            ))}
          </div>
        </Section>
      )}

      {slotsWithStorybook.length === 0 && orphanStorybooks.length === 0 && (
        <p className="text-muted-foreground">No Storybook instances running</p>
      )}
    </main>
  );
}
