import { Clock } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type ActivityTimelineItem = {
  id: string;
  title: string;
  description?: string;
  date: Date | string;
  href?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

const toneClasses = {
  neutral: "bg-muted-foreground",
  success: "bg-emerald-600",
  warning: "bg-amber-500",
  danger: "bg-red-600",
};

export function ActivityTimeline({ items, emptyMessage = "Todavía no hay actividad registrada." }: { items: ActivityTimelineItem[]; emptyMessage?: string }) {
  if (items.length === 0) return <p className="border border-dashed border-window-shadow p-3 text-xs text-muted-foreground">{emptyMessage}</p>;

  return (
    <ol className="relative space-y-1 before:absolute before:bottom-5 before:left-[0.7rem] before:top-5 before:w-px before:bg-border">
      {items.map((item) => {
        const content = (
          <div className="flex gap-2 border-b border-window-shadow/60 p-2 hover:bg-window-highlight">
            <span className={cn("relative z-10 mt-1 size-2.5 shrink-0 border border-window-dark-shadow", toneClasses[item.tone ?? "neutral"])} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-xs font-semibold">{item.title}</p>
                <time className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" dateTime={new Date(item.date).toISOString()}><Clock aria-hidden="true" />{new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(item.date))}</time>
              </div>
              {item.description ? <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p> : null}
            </div>
          </div>
        );
        return <li key={item.id}>{item.href ? <Link className="block outline-none focus-visible:ring-2 focus-visible:ring-focus" href={item.href}>{content}</Link> : content}</li>;
      })}
    </ol>
  );
}
