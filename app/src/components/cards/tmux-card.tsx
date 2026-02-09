import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row } from "@/components/ui/row";
import type { TmuxSession } from "@/lib/types";

interface TmuxCardProps {
  session: TmuxSession;
  onStartTtyd: (name: string) => void;
  onStopTtyd: (name: string) => void;
  onKill: (name: string) => void;
}

export function TmuxCard({
  session,
  onStartTtyd,
  onStopTtyd,
  onKill,
}: TmuxCardProps) {
  const hasTtyd = session.ttydPort !== null;

  return (
    <Card className="py-4 gap-3 border-green-500/20 overflow-hidden">
      <CardHeader className="pb-0 px-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${session.attached ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            <CardTitle className="text-base font-mono truncate">
              {session.name}
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-xs font-normal shrink-0">
            {session.windows} win
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-0 space-y-0">
        <Row label="status">
          <span
            className={session.attached ? "text-emerald-400" : "text-amber-400"}
          >
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

        <div className="pt-3 mt-3 border-t flex gap-2">
          {hasTtyd ? (
            <button
              type="button"
              onClick={() => onStopTtyd(session.name)}
              className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            >
              Stop Web
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStartTtyd(session.name)}
              className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            >
              Start Web
            </button>
          )}
          <button
            type="button"
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
