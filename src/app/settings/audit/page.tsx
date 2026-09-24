import { and, count, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Metadata } from "next";

import { AuditLogList } from "@/components/settings/audit-log-list";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { auditLog, user } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { auditActionLabels, auditEntityLabels } from "@/lib/status-labels";
import {
  countRows,
  dateRangeConditions,
  escapeLike,
  listOrderBy,
  paginate,
  searchTerms,
  toServerListState,
  unfilteredTotal,
  windowCount,
} from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Auditoría" };

/** Filter value for events without a user (system jobs, webhooks). */
const SYSTEM_ACTOR_FILTER = "__system__";
const MAX_FILTER_OPTIONS = 500;

const auditSortKeys = ["createdAt", "action", "entity", "actor", "payload"] as const;

/** Catalogued codes whose Spanish label contains `term`, so "factura" also finds `invoice.*`. */
function codesWithLabel(labels: Record<string, string>, term: string) {
  const needle = term.toLocaleLowerCase("es-ES");
  return Object.entries(labels)
    .filter(([, label]) => label.toLocaleLowerCase("es-ES").includes(needle))
    .map(([code]) => code);
}

/** Every term must match a raw column or the Spanish label of the action/entity. */
function auditSearch(q: string): SQL | undefined {
  const terms = searchTerms(q);
  if (terms.length === 0) return undefined;
  return and(
    ...terms.map((term) => {
      const pattern = `%${escapeLike(term)}%`;
      const actionCodes = codesWithLabel(auditActionLabels, term);
      const entityCodes = codesWithLabel(auditEntityLabels, term);
      return or(
        ...[auditLog.action, auditLog.entityName, auditLog.entityId, auditLog.payload, auditLog.actorUserId, user.name, user.email].map(
          (column) => sql`${column} ilike ${pattern}`,
        ),
        actionCodes.length > 0 ? inArray(auditLog.action, actionCodes) : undefined,
        entityCodes.length > 0 ? inArray(auditLog.entityName, entityCodes) : undefined,
      );
    }),
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("settings.manage");
  const scope = and(eq(auditLog.tenantId, ctx.tenant.id), eq(auditLog.companyId, ctx.company.id));

  // Filter options come from the whole log (not only the current page) and double as the
  // whitelist of accepted filter values.
  const [entityRows, actorRows] = await Promise.all([
    db
      .selectDistinct({ entityName: auditLog.entityName })
      .from(auditLog)
      .where(scope)
      .orderBy(auditLog.entityName)
      .limit(MAX_FILTER_OPTIONS),
    db
      .selectDistinct({ actorUserId: auditLog.actorUserId, actorName: user.name, actorEmail: user.email })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(scope)
      .limit(MAX_FILTER_OPTIONS),
  ]);
  const actorOptions = actorRows.map((row) => ({
    value: row.actorUserId ?? SYSTEM_ACTOR_FILTER,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
  }));

  const params = parseListParams(await searchParams, {
    sortKeys: auditSortKeys,
    defaultSort: { key: "createdAt", dir: "desc" },
    filters: {
      entity: entityRows.map((row) => row.entityName),
      actor: actorOptions.map((option) => option.value),
    },
  });

  const actorFilter = params.filters.actor;
  const where = and(
    scope,
    auditSearch(params.q),
    ...dateRangeConditions(auditLog.createdAt, params.from, params.to),
    params.filters.entity ? eq(auditLog.entityName, params.filters.entity) : undefined,
    actorFilter ? (actorFilter === SYSTEM_ACTOR_FILTER ? isNull(auditLog.actorUserId) : eq(auditLog.actorUserId, actorFilter)) : undefined,
  );
  const sortColumns = {
    createdAt: auditLog.createdAt,
    action: auditLog.action,
    entity: sql`${auditLog.entityName} || ':' || ${auditLog.entityId}`,
    actor: sql`coalesce(${user.name}, ${user.email}, ${auditLog.actorUserId})`,
    payload: auditLog.payload,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: auditLog.id,
          actorUserId: auditLog.actorUserId,
          actorName: user.name,
          actorEmail: user.email,
          action: auditLog.action,
          entityName: auditLog.entityName,
          entityId: auditLog.entityId,
          payload: auditLog.payload,
          createdAt: auditLog.createdAt,
          total: windowCount(),
        })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.actorUserId))
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, auditLog.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(db.select({ value: count() }).from(auditLog).leftJoin(user, eq(user.id, auditLog.actorUserId)).where(where)),
  });
  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(auditLog).where(scope)),
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Auditoría"
        description={`Eventos sensibles de ${ctx.company.name}; usa este registro para revisar cambios operativos y de seguridad.`}
      />
      <PageSection title="Eventos auditados" description="Registro completo del espacio y la empresa activa, del más reciente al más antiguo. Filtra por entidad, usuario o fechas.">
        <AuditLogList
          actors={actorOptions}
          entities={entityRows.map((row) => row.entityName)}
          rows={result.rows}
          server={toServerListState(params, result, recordCount)}
        />
      </PageSection>
    </PageShell>
  );
}
