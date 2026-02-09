interface SectionProps {
  title: string;
  count?: number;
  color?: "amber" | "sky" | "violet" | "green" | "pink";
  children: React.ReactNode;
}

export function Section({ title, count, color, children }: SectionProps) {
  const titleColors = {
    amber: "text-amber-400",
    sky: "text-sky-400",
    violet: "text-violet-400",
    green: "text-green-400",
    pink: "text-pink-400",
  };
  const titleColor = color ? titleColors[color] : "";

  return (
    <section className="mb-8">
      <h2 className={`text-lg font-medium mb-4 ${titleColor}`}>
        {title}
        {count !== undefined && (
          <span className="text-muted-foreground ml-2 font-normal">
            ({count})
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}
