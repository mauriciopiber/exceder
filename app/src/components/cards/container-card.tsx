"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row } from "@/components/ui/row";
import type { DockerContainer } from "@/lib/types";

export function ContainerCard({
  container,
  onStopped,
}: {
  container: DockerContainer;
  onStopped?: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const portStr = container.ports
    .map((p) => `${p.host}:${p.container}`)
    .join(", ");

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop-container",
          container: container.name,
        }),
      });
      onStopped?.();
    } catch (e) {
      console.error("Failed to stop container:", e);
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card className="py-4 gap-3 border-sky-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
            <CardTitle className="text-sm font-mono truncate min-w-0">
              {container.name}
            </CardTitle>
          </div>
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="text-xs px-2 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 shrink-0"
          >
            {stopping ? "..." : "Stop"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="ports">
          <span className="text-emerald-400">{portStr || "—"}</span>
        </Row>
        <Row label="image">
          <span className="text-muted-foreground text-xs truncate">
            {container.image}
          </span>
        </Row>
        <Row label="status">
          <span className="text-muted-foreground">{container.status}</span>
        </Row>
      </CardContent>
    </Card>
  );
}
