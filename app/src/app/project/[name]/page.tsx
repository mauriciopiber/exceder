"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SlotCard } from "@/components/cards";
import type { APIResponse, ProjectGroup } from "@/lib/types";

export default function ProjectPage() {
  const params = useParams();
  const projectName = params.name as string;
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

  // Find the project
  const project: ProjectGroup | undefined = data?.groups
    ?.flatMap((group) => group.projects)
    ?.find((p) => p.name === projectName);

  if (!project) {
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
            <h1 className="text-2xl font-semibold">Project not found</h1>
          </div>
        </header>
        <p className="text-muted-foreground">
          No project named "{projectName}"
        </p>
      </main>
    );
  }

  const activeSlots = project.slots.filter((s) => s.claude !== null);

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
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <span className="text-muted-foreground font-mono text-sm">
            {project.basePath}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-400">{activeSlots.length} active</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">
            {project.slots.length} slots
          </span>
          {project.basePort > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span>
                base port: <span className="font-mono">{project.basePort}</span>
              </span>
            </>
          )}
        </div>
      </header>

      {project.slots.length === 0 ? (
        <p className="text-muted-foreground">No slots</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {project.slots.map((slot) => (
            <SlotCard key={slot.name} slot={slot} />
          ))}
        </div>
      )}
    </main>
  );
}
