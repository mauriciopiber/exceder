import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContainerDisplay } from "@/components/ui/container-display";
import { PortDisplay } from "@/components/ui/port-display";
import { Row } from "@/components/ui/row";
import type { Slot } from "@/lib/types";

export function SlotCard({ slot }: { slot: Slot }) {
  const isActive = slot.claude !== null;
  const hasContainers = slot.containers.length > 0;
  const hasTags = slot.tags && slot.tags.length > 0;

  const chatUrl = `/chat?project=${encodeURIComponent(slot.path)}&tmux=${encodeURIComponent(slot.name)}`;

  return (
    <Card className="py-4 gap-3 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-emerald-500" : "bg-muted"}`}
            />
            <CardTitle className="text-base font-mono truncate">
              {slot.name}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {slot.orphan && (
              <Badge
                variant="outline"
                className="text-xs font-normal bg-amber-500/10 text-amber-400 border-amber-500/30"
                title="Directory not found on disk"
              >
                orphan
              </Badge>
            )}
            {slot.locked && (
              <Badge
                variant="outline"
                className="text-xs font-normal bg-rose-500/10 text-rose-400 border-rose-500/30"
                title={slot.lockNote || "Locked"}
              >
                locked
              </Badge>
            )}
            {slot.number === 0 ? (
              <Badge
                variant="outline"
                className="text-xs font-normal bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              >
                main
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-normal">
                #{slot.number}
              </Badge>
            )}
          </div>
        </div>
        {hasTags && (
          <div className="flex flex-wrap gap-1 mt-2">
            {slot.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-xs bg-violet-500/10 text-violet-400 border-violet-500/30"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="branch">
          <span className="text-sky-400">{slot.branch}</span>
        </Row>
        {slot.ports.web && (
          <Row label="web">
            <PortDisplay info={slot.ports.web} />
          </Row>
        )}
        {slot.ports.storybook && (
          <Row label="storybook">
            <PortDisplay info={slot.ports.storybook} />
          </Row>
        )}
        {hasContainers ? (
          <div className="pt-1 space-y-1">
            <span className="text-muted-foreground text-sm">docker</span>
            {slot.containers.map((c) => (
              <ContainerDisplay key={c.name} container={c} />
            ))}
          </div>
        ) : (
          <Row label="docker">
            <span className="text-muted-foreground">—</span>
          </Row>
        )}
        {slot.claude && (
          <div className="pt-2 mt-2 border-t space-y-0">
            <Row label="model">
              <span className="text-violet-400">{slot.claude.model}</span>
            </Row>
            <Row label="uptime">
              <span className="text-amber-400">{slot.claude.runtime}</span>
            </Row>
          </div>
        )}
        <div className="pt-3 mt-3 border-t">
          <a
            href={chatUrl}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
          >
            <span>Chat</span>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
