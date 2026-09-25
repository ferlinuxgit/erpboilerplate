import { PageShell } from "@/components/ui/page";

export default function ExpensesLoading() {
  return (
    <PageShell>
      <div className="h-20 rounded-[2px] bg-muted motion-safe:animate-pulse" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-24 rounded-[2px] bg-muted motion-safe:animate-pulse" />
        <div className="h-24 rounded-[2px] bg-muted motion-safe:animate-pulse" />
        <div className="h-24 rounded-[2px] bg-muted motion-safe:animate-pulse" />
      </div>
      <div className="h-72 rounded-[2px] bg-muted motion-safe:animate-pulse" />
    </PageShell>
  );
}
