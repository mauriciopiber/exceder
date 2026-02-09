import type { DockerContainer } from "@/lib/types";

export function ContainerDisplay({
  container,
}: {
  container: DockerContainer;
}) {
  const portStr = container.ports.map((p) => p.host).join(", ");
  const shortStatus = container.status
    .replace(/^Up /, "")
    .replace(/ \(healthy\)$/, "");

  return (
    <div className="flex items-center gap-1.5 text-xs min-w-0">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
      <span className="text-emerald-400 font-mono truncate">
        {container.name}
      </span>
      {portStr && <span className="text-muted-foreground">:{portStr}</span>}
      <span className="text-muted-foreground/60 truncate">{shortStatus}</span>
    </div>
  );
}
