import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readPrivateFile } from "@/server/storage/files";

/**
 * Exportación completa de un espacio (portabilidad, art. 20 RGPD): todos sus datos en JSON por
 * tabla (una fila por línea) y los documentos guardados, en un ZIP que se genera mientras se
 * descarga (sin cargarlo entero en memoria).
 *
 * El plan sale del propio esquema: una tabla es del espacio si tiene `tenantId`, si tiene
 * `companyId` (empresas del espacio) o si cuelga por clave ajena de una tabla que lo es (líneas de
 * factura, movimientos bancarios…). Una tabla nueva entra sola en la exportación.
 */

type Scope =
  | { kind: "tenant-root" }
  | { kind: "tenant"; column: string }
  | { kind: "company"; column: string }
  | { kind: "child"; column: string; parent: string; parentColumn: string };

export type ExportPlanEntry = { table: string; scope: Scope; /** Clave primaria: orden estable al leer por lotes. */ orderBy: string[] };

/** Tablas que nunca se exportan: credenciales y datos de la plataforma, no del cliente. */
const EXCLUDED = new Set(["session", "account", "verification", "api_key", "processed_stripe_event", "billing_price", "plan", "permission", "role_permission", "advisor_session"]);

function allTables() {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable => value instanceof PgTable).map((table) => getTableConfig(table));
}

export function buildTenantExportPlan(): ExportPlanEntry[] {
  const tables = allTables();
  const byName = new Map(tables.map((config) => [config.name, config]));
  const scopes = new Map<string, Scope>();
  scopes.set("tenant", { kind: "tenant-root" });
  for (const config of tables) {
    if (config.name === "tenant" || EXCLUDED.has(config.name)) continue;
    const columns = new Set(config.columns.map((column) => column.name));
    if (columns.has("companyId")) scopes.set(config.name, { kind: "company", column: "companyId" });
    else if (columns.has("tenantId")) scopes.set(config.name, { kind: "tenant", column: "tenantId" });
  }
  // Tablas hijas: por su clave ajena hacia una tabla ya del espacio (varias pasadas: nietas…).
  for (let pass = 0; pass < 6; pass += 1) {
    for (const config of tables) {
      if (scopes.has(config.name) || EXCLUDED.has(config.name)) continue;
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        const parent = getTableConfig(reference.foreignTable).name;
        if (!scopes.has(parent) || reference.columns.length !== 1) continue;
        scopes.set(config.name, { kind: "child", column: reference.columns[0].name, parent, parentColumn: reference.foreignColumns[0].name });
        break;
      }
    }
  }
  const primaryKey = (name: string) => {
    const config = byName.get(name)!;
    const single = config.columns.filter((column) => column.primary).map((column) => column.name);
    const composite = config.primaryKeys[0]?.columns.map((column) => column.name) ?? [];
    return single.length ? single : composite.length ? composite : config.columns.map((column) => column.name).slice(0, 1);
  };
  return [...scopes.entries()].filter(([name]) => byName.has(name)).map(([table, scope]) => ({ table, scope, orderBy: primaryKey(table) })).sort((a, b) => a.table.localeCompare(b.table));
}

/** Condición SQL de las filas del espacio en una tabla (recursiva para las hijas). */
function scopeCondition(plan: Map<string, Scope>, table: string, tenantId: string, alias: string): SQL {
  const scope = plan.get(table)!;
  const column = (name: string) => sql.raw(`${alias}."${name}"`);
  switch (scope.kind) {
    case "tenant-root":
      return sql`${column("id")} = ${tenantId}`;
    case "tenant":
      return sql`${column(scope.column)} = ${tenantId}`;
    case "company":
      return sql`${column(scope.column)} in (select "id" from "company" where "tenantId" = ${tenantId})`;
    case "child": {
      const parentAlias = `${alias}_p`;
      return sql`${column(scope.column)} in (select ${sql.raw(`${parentAlias}."${scope.parentColumn}"`)} from ${sql.raw(`"${scope.parent}" ${parentAlias}`)} where ${scopeCondition(plan, scope.parent, tenantId, parentAlias)})`;
    }
  }
}

const BATCH = 2_000;
const encoder = new TextEncoder();

/** ZIP de la exportación del espacio, generado mientras se envía. */
export function streamTenantExport(tenantId: string): ReadableStream<Uint8Array> {
  const plan = buildTenantExportPlan();
  const scopes = new Map(plan.map((entry) => [entry.table, entry.scope]));
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      const addText = (name: string, text: string) => {
        const file = new ZipDeflate(name, { level: 6 });
        zip.add(file);
        file.push(encoder.encode(text), true);
      };
      const manifest: Array<{ table: string; rows: number }> = [];
      const missingFiles: string[] = [];
      try {
        for (const entry of plan) {
          const file = new ZipDeflate(`datos/${entry.table}.jsonl`, { level: 6 });
          zip.add(file);
          let rows = 0;
          for (let offset = 0; ; offset += BATCH) {
            const result = await db.execute(sql`select row_to_json(t) as "row" from ${sql.raw(`"${entry.table}" t`)} where ${scopeCondition(scopes, entry.table, tenantId, "t")} order by ${sql.raw(entry.orderBy.map((column) => `t."${column}"`).join(", "))} limit ${BATCH} offset ${offset}`);
            const batch = (result as unknown as { rows: Array<{ row: unknown }> }).rows;
            if (batch.length) file.push(encoder.encode(batch.map((item) => JSON.stringify(item.row)).join("\n") + "\n"));
            rows += batch.length;
            if (batch.length < BATCH) break;
          }
          file.push(new Uint8Array(0), true);
          manifest.push({ table: entry.table, rows });
          // Documentos guardados (facturas de proveedor, adjuntos…): junto a los datos.
          if (rows > 0 && scopes.get(entry.table)?.kind !== "tenant-root") {
            const columns = await db.execute(sql`select column_name from information_schema.columns where table_name = ${entry.table} and column_name = 'storageKey'`);
            if ((columns as unknown as { rows: unknown[] }).rows.length) {
              const stored = await db.execute(sql`select t."id", t."storageKey" from ${sql.raw(`"${entry.table}" t`)} where t."storageKey" is not null and ${scopeCondition(scopes, entry.table, tenantId, "t")}`);
              for (const document of (stored as unknown as { rows: Array<{ id: string; storageKey: string }> }).rows) {
                try {
                  const body = await readPrivateFile(document.storageKey);
                  const name = document.storageKey.split("/").pop() ?? document.id;
                  const blob = new ZipPassThrough(`documentos/${entry.table}/${name}`);
                  zip.add(blob);
                  blob.push(new Uint8Array(body), true);
                } catch {
                  missingFiles.push(document.storageKey);
                }
              }
            }
          }
        }
        addText("LEEME.txt", [
          "Exportación completa de tu espacio de trabajo.",
          "",
          "- datos/: una tabla por fichero, en JSON Lines (un registro JSON por línea).",
          "- documentos/: los documentos guardados (facturas de proveedor, adjuntos…).",
          "- manifiesto.json: tablas y número de registros.",
          "",
          "Los libros oficiales (diario, IVA, cuentas anuales) también se descargan en su formato legal desde la aplicación.",
        ].join("\n"));
        addText("manifiesto.json", JSON.stringify({ tenantId, generatedAt: new Date().toISOString(), tables: manifest, missingFiles }, null, 2));
        zip.end();
      } catch (error) {
        logger.error({ err: error, tenantId }, "tenant.export_failed");
        controller.error(error);
      }
    },
  });
}
