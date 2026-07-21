import { PageShell } from "@/components/ui/page";

export default function ExpensesLoading() {
  return (
    <PageShell>
      <div className="h-20 animate-pulse rounded-[2px] bg-muted" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-[2px] bg-muted" />
        <div className="h-24 animate-pulse rounded-[2px] bg-muted" />
        <div className="h-24 animate-pulse rounded-[2px] bg-muted" />
      </div>
      <div className="h-72 animate-pulse rounded-[2px] bg-muted" />
    </PageShell>
  );
}
