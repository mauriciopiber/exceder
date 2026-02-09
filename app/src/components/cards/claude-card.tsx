"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row } from "@/components/ui/row";
import type { ClaudeInstance } from "@/lib/types";

export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toString();
}

export function ClaudeCard({
  claude,
  onStopped,
}: {
  claude: ClaudeInstance;
  onStopped?: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const name = claude.cwd.split("/").pop() || "unknown";

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop-claude", pid: claude.pid }),
      });
      onStopped?.();
    } catch (e) {
      console.error("Failed to stop claude:", e);
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card className="py-4 gap-3 border-amber-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <CardTitle className="text-base font-mono truncate min-w-0">
              {name}
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
        <Row label="branch">
          <span className="text-sky-400 truncate">{claude.branch}</span>
        </Row>
        <Row label="model">
          <span className="text-violet-400">{claude.model}</span>
        </Row>
        <Row label="uptime">
          <span className="text-amber-400">{claude.runtime}</span>
        </Row>
        {claude.usage && (
          <div className="pt-2 mt-2 border-t space-y-0">
            <Row label="tokens">
              <span className="text-emerald-400">
                {formatTokens(claude.usage.totalTokens)}
              </span>
            </Row>
            <Row label="cost">
              <span className="text-rose-400">
                ${claude.usage.estimatedCost.toFixed(2)}
              </span>
            </Row>
          </div>
        )}
        {claude.lastMessage && (
          <p className="text-muted-foreground text-xs line-clamp-2 pt-2 mt-2 border-t">
            {claude.lastMessage}
          </p>
        )}
        <p className="text-muted-foreground text-xs truncate pt-2 font-mono">
          {claude.cwd}
        </p>
      </CardContent>
    </Card>
  );
}
