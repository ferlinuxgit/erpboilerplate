"use client";

import { ResourceList, type ResourceListColumn, type ServerListState } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import { auditActionLabel, auditEntityLabel } from "@/lib/status-labels";

type AuditLogRow = {
  id: string;
  actorUserId: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entityName: string;
  entityId: string;
  payload: string | null;
  createdAt: Date | string;
};

type AuditActorOption = {
  value: string;
  actorUserId: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
};

type AuditLogListProps = {
  rows: AuditLogRow[];
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
  /** Server mode: every entity name in the log (filter options). */
  entities?: string[];
  /** Server mode: every actor in the log (filter options). */
  actors?: AuditActorOption[];
};

const SYSTEM_ACTOR = "Sistema";

function actionTone(action: string) {
  if (/(delete|void|remove|revoke|archive|deactivate|error)/i.test(action)) return "danger";
  if (/(create|issue|accept|open)/i.test(action)) return "success";
  if (/(update|convert|reopen|rotate|reverse)/i.test(action)) return "info";
  return "neutral";
}

function compactPayload(payload: string | null) {
  if (!payload) return "Sin payload";
  return payload.length > 120 ? `${payload.slice(0, 120)}...` : payload;
}

function actorLabel(log: Pick<AuditLogRow, "actorUserId" | "actorName" | "actorEmail">) {
  if (!log.actorUserId) return SYSTEM_ACTOR;
  if (log.actorName) return log.actorName;
  if (log.actorEmail) return log.actorEmail;
  if (log.actorUserId.startsWith("api-key:")) return "Clave API";
  return log.actorUserId;
}

function actorFilterValue(log: AuditLogRow) {
  return log.actorUserId ?? "__system__";
}

function ActionCell({ action }: { action: string }) {
  return (
    <div className="space-y-1">
      <StatusBadge tone={actionTone(action)}>{auditActionLabel(action)}</StatusBadge>
      <p className="font-mono text-xs text-muted-foreground">{action}</p>
    </div>
  );
}

function ActorCell({ log }: { log: AuditLogRow }) {
  const label = actorLabel(log);
  const secondary = log.actorName && log.actorEmail ? log.actorEmail : null;
  return (
    <div>
      <p className="font-medium">{label}</p>
      {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

const columns: ResourceListColumn<AuditLogRow>[] = [
  {
    header: "Fecha",
    cell: (log) => formatDateTime(log.createdAt),
    exportValue: (log) => formatDateTime(log.createdAt),
    sortValue: (log) => new Date(log.createdAt),
    sortKey: "createdAt",
  },
  {
    header: "Acción",
    cell: (log) => <ActionCell action={log.action} />,
    exportValue: (log) => `${auditActionLabel(log.action)} (${log.action})`,
    sortValue: (log) => auditActionLabel(log.action),
    sortKey: "action",
  },
  {
    header: "Entidad",
    cell: (log) => (
      <div>
        <p className="font-medium">{auditEntityLabel(log.entityName)}</p>
        <p className="font-mono text-xs text-muted-foreground">{log.entityId}</p>
      </div>
    ),
    exportValue: (log) => `${auditEntityLabel(log.entityName)}:${log.entityId}`,
    sortValue: (log) => `${auditEntityLabel(log.entityName)}:${log.entityId}`,
    sortKey: "entity",
  },
  {
    header: "Usuario",
    cell: (log) => <ActorCell log={log} />,
    exportValue: (log) => (log.actorEmail ? `${actorLabel(log)} <${log.actorEmail}>` : actorLabel(log)),
    sortValue: (log) => actorLabel(log),
    sortKey: "actor",
  },
  {
    header: "Detalle",
    cell: (log) => <span className="line-clamp-2 text-sm text-muted-foreground">{compactPayload(log.payload)}</span>,
    exportValue: (log) => log.payload ?? "",
    sortValue: (log) => log.payload ?? "",
    sortKey: "payload",
  },
];

function uniqueOptions(entries: Array<{ value: string; label: string }>) {
  const byValue = new Map<string, string>();
  for (const entry of entries) if (!byValue.has(entry.value)) byValue.set(entry.value, entry.label);
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function actorOptionLabel(log: Pick<AuditLogRow, "actorUserId" | "actorName" | "actorEmail">) {
  return log.actorName && log.actorEmail ? `${log.actorName} (${log.actorEmail})` : actorLabel(log);
}

export function AuditLogList({ actors, entities, rows, server }: AuditLogListProps) {
  // Server mode lists every value in the log; client mode only has the loaded rows.
  const entityOptions = uniqueOptions(
    (entities ?? rows.map((log) => log.entityName)).map((entityName) => ({ value: entityName, label: auditEntityLabel(entityName) })),
  );
  const actorOptions = uniqueOptions(
    actors
      ? actors.map((actor) => ({ value: actor.value, label: actorOptionLabel(actor) }))
      : rows.map((log) => ({ value: actorFilterValue(log), label: actorOptionLabel(log) })),
  );

  return (
    <ResourceList
      columns={columns}
      emptyDescription="Las acciones auditadas aparecerán aquí cuando el espacio tenga actividad administrativa u operativa."
      emptyTitle="Sin eventos de auditoría."
      exportFileName="auditoria.csv"
      getRowId={(log) => log.id}
      getRowLabel={(log) => `${auditActionLabel(log.action)} · ${formatDateTime(log.createdAt)}`}
      getSearchText={(log) =>
        [
          formatDateTime(log.createdAt),
          auditActionLabel(log.action),
          log.action,
          auditEntityLabel(log.entityName),
          log.entityName,
          log.entityId,
          actorLabel(log),
          log.actorEmail,
          log.payload,
        ]
          .filter(Boolean)
          .join(" ")
      }
      items={rows}
      server={server}
      dateRange={{ label: "Fecha del evento", getValue: (log) => log.createdAt }}
      filters={[
        {
          key: "entity",
          label: "Entidad",
          allLabel: "Todas las entidades",
          options: entityOptions,
          getValue: (log) => log.entityName,
        },
        {
          key: "actor",
          label: "Usuario",
          allLabel: "Todos los usuarios",
          options: actorOptions,
          getValue: (log) => actorFilterValue(log),
        },
      ]}
      renderMobileCard={(log) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <ActionCell action={log.action} />
            <p className="font-mono text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Entidad</dt>
            <dd className="break-all">{auditEntityLabel(log.entityName)} · {log.entityId}</dd>
            <dt className="text-muted-foreground">Usuario</dt>
            <dd className="break-all">{log.actorEmail && log.actorName ? `${log.actorName} · ${log.actorEmail}` : actorLabel(log)}</dd>
          </dl>
          <p className="line-clamp-3 break-all text-xs text-muted-foreground">{compactPayload(log.payload)}</p>
        </div>
      )}
      searchPlaceholder="Buscar por acción, entidad, usuario o payload"
      testId="audit-log-list"
      title="Eventos auditados"
    />
  );
}
