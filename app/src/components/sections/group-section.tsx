import Link from "next/link";
import type { Group } from "@/lib/types";
import { ProjectSection } from "./project-section";

export function GroupSection({ group }: { group: Group }) {
  const totalSlots = group.projects.reduce((sum, p) => sum + p.slots.length, 0);
  const activeSlots = group.projects.reduce(
    (sum, p) => sum + p.slots.filter((s) => s.claude !== null).length,
    0,
  );

  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 mb-4 pb-2 border-b">
        <Link
          href={`/group/${group.id}`}
          className="text-xl font-semibold text-violet-400 hover:text-violet-300 transition-colors"
        >
          {group.name}
        </Link>
        <span className="text-sm text-muted-foreground">
          {group.projects.length} project
          {group.projects.length !== 1 ? "s" : ""}
        </span>
        <span className="text-sm text-muted-foreground">•</span>
        <span className="text-sm">
          <span className="text-emerald-500">{activeSlots}</span>
          <span className="text-muted-foreground">/{totalSlots} active</span>
        </span>
      </div>

      <div className="pl-4 border-l-2 border-violet-500/20">
        {group.projects.map((project) => (
          <ProjectSection key={project.name} project={project} nested />
        ))}
      </div>
    </section>
  );
}
