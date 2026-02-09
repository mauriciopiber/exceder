import type { PortInfo } from "@/lib/types";

export function PortLink({ port, label }: { port: number; label?: string }) {
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

export function PortDisplay({
  info,
  label,
  showProcess,
}: {
  info: PortInfo | null;
  label?: string;
  showProcess?: boolean;
}) {
  if (!info) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (info.active) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
        <PortLink port={info.port} label={label} />
        {showProcess && info.process && (
          <span className="text-muted-foreground text-xs truncate">
            ({info.process})
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-muted shrink-0" />
      <span className="text-muted-foreground">{info.port}</span>
    </span>
  );
}
