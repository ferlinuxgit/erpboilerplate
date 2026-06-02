"use client";

import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";

type AuditLogRow = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityName: string;
  entityId: string;
  payload: string | null;
  createdAt: Date | string;
};

type AuditLogListProps = {
  rows: AuditLogRow[];
};

function actionTone(action: string) {
  if (action.includes("delete")) return "danger";
  if (action.includes("create")) return "success";
  if (action.includes("update")) return "info";
  return "neutral";
}

function compactPayload(payload: string | null) {
  if (!payload) return "Sin payload";
  return payload.length > 120 ? `${payload.slice(0, 120)}...` : payload;
}

const columns: ResourceListColumn<AuditLogRow>[] = [
  {
    header: "Fecha",
    cell: (log) => formatDateTime(log.createdAt),
    exportValue: (log) => formatDateTime(log.createdAt),
    sortValue: (log) => new Date(log.createdAt),
  },
  {
    header: "Acción",
    cell: (log) => <StatusBadge tone={actionTone(log.action)}>{log.action}</StatusBadge>,
    exportValue: (log) => log.action,
    sortValue: (log) => log.action,
  },
  {
    header: "Entidad",
    cell: (log) => (
      <div>
        <p className="font-medium">{log.entityName}</p>
        <p className="text-xs text-muted-foreground">{log.entityId}</p>
      </div>
    ),
    exportValue: (log) => `${log.entityName}:${log.entityId}`,
    sortValue: (log) => `${log.entityName}:${log.entityId}`,
  },
  {
    header: "Actor",
    cell: (log) => log.actorUserId ?? "Sistema",
    exportValue: (log) => log.actorUserId ?? "Sistema",
    sortValue: (log) => log.actorUserId ?? "",
  },
  {
    header: "Detalle",
    cell: (log) => <span className="line-clamp-2 text-sm text-muted-foreground">{compactPayload(log.payload)}</span>,
    exportValue: (log) => log.payload ?? "",
    sortValue: (log) => log.payload ?? "",
  },
];

export function AuditLogList({ rows }: AuditLogListProps) {
  return (
    <ResourceList
      columns={columns}
      emptyDescription="Las acciones auditadas aparecerán aquí cuando el tenant tenga actividad administrativa u operativa."
      emptyTitle="Sin eventos de auditoría."
      exportFileName="auditoria.csv"
      getRowId={(log) => log.id}
      getSearchText={(log) => [formatDateTime(log.createdAt), log.action, log.entityName, log.entityId, log.actorUserId, log.payload].filter(Boolean).join(" ")}
      items={rows}
      pageSize={16}
      pageSizeOptions={[16, 32, 64]}
      searchPlaceholder="Buscar por acción, entidad, actor o payload"
      testId="audit-log-list"
      title="Eventos auditados"
    />
  );
}
