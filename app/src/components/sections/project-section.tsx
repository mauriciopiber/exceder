import Link from "next/link";
import { SlotCard } from "@/components/cards/slot-card";
import type { ProjectGroup } from "@/lib/types";

interface ProjectSectionProps {
  project: ProjectGroup;
  nested?: boolean;
}

export function ProjectSection({ project, nested }: ProjectSectionProps) {
  const activeSlots = project.slots.filter((s) => s.claude !== null);

  return (
    <div className={nested ? "mb-6" : "mb-8"}>
      <div className="flex items-center gap-3 mb-3">
        <Link
          href={`/project/${project.name}`}
          className={`font-medium hover:text-sky-400 underline underline-offset-2 ${nested ? "text-base" : "text-lg"}`}
        >
          {project.name}
        </Link>
        <span className="text-sm text-muted-foreground font-mono">
          {project.basePath.split("/").slice(-2).join("/")}
        </span>
        {project.basePort > 0 && (
          <>
            <span className="text-sm text-muted-foreground">•</span>
            <span className="text-sm">
              port{" "}
              <span className="text-foreground font-mono">
                {project.basePort}
              </span>
            </span>
          </>
        )}
        <span className="text-sm text-muted-foreground">•</span>
        <span className="text-sm text-emerald-500">{activeSlots.length}</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">
          {project.slots.length} slots
        </span>
      </div>

      {project.slots.length === 0 ? (
        <p className="text-muted-foreground text-sm">No slots</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {project.slots.map((slot) => (
            <SlotCard key={slot.name} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}
