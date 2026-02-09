"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProjectSection } from "@/components/sections/project-section";
import type { APIResponse, Group } from "@/lib/types";

export default function GroupPage() {
  const params = useParams();
  const groupId = params.id as string;

  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/slots");
      if (res.ok) {
        setData(await res.json());
      }
      setLoading(false);
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  const group: Group | undefined = data?.groups?.find((g) => g.id === groupId);

  if (!group) {
    return (
      <main className="max-w-7xl mx-auto p-8">
        <div className="flex items-center gap-4 mb-4">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Link>
          <h1 className="text-2xl font-semibold text-rose-400">
            Group not found
          </h1>
        </div>
        <p className="text-muted-foreground">
          No group with id &quot;{groupId}&quot;
        </p>
      </main>
    );
  }

  const totalSlots = group.projects.reduce((sum, p) => sum + p.slots.length, 0);
  const activeClaudes = group.projects.reduce(
    (sum, p) => sum + p.slots.filter((s) => s.claude !== null).length,
    0,
  );
  const totalContainers = group.projects.reduce(
    (sum, p) =>
      sum + p.slots.reduce((s, slot) => s + slot.containers.length, 0),
    0,
  );

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
            {group.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>
            {group.projects.length} project
            {group.projects.length !== 1 ? "s" : ""}
          </span>
          <span>•</span>
          <span>{totalSlots} slots</span>
          <span>•</span>
          <span className="text-emerald-400">
            {activeClaudes} active claude{activeClaudes !== 1 ? "s" : ""}
          </span>
          <span>•</span>
          <span className="text-sky-400">
            {totalContainers} container{totalContainers !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      {group.projects.map((project) => (
        <ProjectSection key={project.name} project={project} nested={false} />
      ))}
    </main>
  );
}
