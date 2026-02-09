"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SlotCard } from "@/components/cards";
import type { APIResponse, Slot } from "@/lib/types";

export default function SlotsPage() {
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

  // Collect all slots
  const allSlots: { slot: Slot; project: string }[] = [];

  data?.groups?.forEach((group) => {
    group.projects.forEach((project) => {
      project.slots.forEach((slot) => {
        allSlots.push({ slot, project: project.name });
      });
    });
  });

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
          <h1 className="text-2xl font-semibold text-sky-400">All Slots</h1>
          <span className="text-muted-foreground">({allSlots.length})</span>
        </div>
      </header>

      {allSlots.length === 0 ? (
        <p className="text-muted-foreground">No slots configured</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {allSlots.map(({ slot }) => (
            <SlotCard key={slot.name} slot={slot} />
          ))}
        </div>
      )}
    </main>
  );
}
