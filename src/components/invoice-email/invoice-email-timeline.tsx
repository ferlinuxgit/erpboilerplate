import { ActivityTimeline, type ActivityTimelineItem } from "@/components/ui/activity-timeline";
import { reminderLevelLabels, type ReminderLevel } from "@/server/dunning/schedule";
import type { InvoiceEmailLogEntry } from "@/server/invoice-email/service";

function entryTitle(entry: InvoiceEmailLogEntry) {
  const level: ReminderLevel = entry.reminderLevel === 3 ? 3 : entry.reminderLevel === 2 ? 2 : 1;
  const what = entry.kind === "REMINDER" ? `Recordatorio de cobro · ${reminderLevelLabels[level]}` : "Factura enviada por email";
  if (entry.status === "FAILED") return `${what} · no se pudo enviar`;
  return entry.trigger === "AUTOMATIC" ? `${what} (automático)` : what;
}

function entryDescription(entry: InvoiceEmailLogEntry) {
  const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(entry.sentAt);
  const recipients = `A ${entry.toEmails}${entry.ccEmails ? ` · CC ${entry.ccEmails}` : ""}`;
  return [`${time} · ${recipients}`, `Asunto: ${entry.subject}`, entry.error ? `Motivo: ${entry.error}` : null].filter(Boolean).join(" · ");
}

/** Historial de envíos y recordatorios de una factura (ficha de la factura). */
export function InvoiceEmailTimeline({ entries }: { entries: InvoiceEmailLogEntry[] }) {
  const items: ActivityTimelineItem[] = entries.map((entry) => ({
    id: entry.id,
    title: entryTitle(entry),
    description: entryDescription(entry),
    date: entry.sentAt,
    tone: entry.status === "FAILED" ? "danger" : entry.kind === "REMINDER" ? "warning" : "success",
  }));
  return <ActivityTimeline emptyMessage="Todavía no se ha enviado por email." items={items} />;
}
