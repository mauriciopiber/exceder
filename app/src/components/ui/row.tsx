export function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center py-1 gap-2 min-w-0">
      <span className="text-muted-foreground text-sm shrink-0">{label}</span>
      <span className="font-mono text-sm truncate min-w-0">{children}</span>
    </div>
  );
}
