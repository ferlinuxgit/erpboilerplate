import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Fusiona los impuestos duplicados (mismo tipo, porcentaje y operación con distinto nombre).
 *
 *   npm run taxes:dedupe                      → ensayo de todas las empresas (no guarda nada)
 *   npm run taxes:dedupe -- --apply           → aplica los cambios
 *   npm run taxes:dedupe -- --company=<id>    → solo una empresa (se puede repetir)
 *
 * Las facturas guardan copia del nombre y porcentaje de cada impuesto: no cambia ninguna factura.
 */
class DryRunRollback extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const companyIds = args.filter((arg) => arg.startsWith("--company=")).map((arg) => arg.slice("--company=".length)).filter(Boolean);
  const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--dry-run" && !arg.startsWith("--company="));
  if (unknown.length > 0) {
    console.error(`Argumentos no reconocidos: ${unknown.join(" ")}. Usa --dry-run (por defecto), --apply y --company=<id>.`);
    process.exit(2);
  }

  const { asc } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { company } = await import("../src/db/schema");
  const { dedupeCompanyTaxes, formatTaxDedupeReport } = await import("../src/server/taxes/duplicates");

  const targets = companyIds.length > 0
    ? companyIds
    : (await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt))).map((row) => row.id);
  console.log(`Impuestos duplicados · ${apply ? "APLICAR" : "ENSAYO (dry-run, no se guarda nada)"} · ${targets.length} empresa(s)\n`);
  for (const companyId of targets) {
    let report: Awaited<ReturnType<typeof dedupeCompanyTaxes>> | null = null;
    try {
      await db.transaction(async (tx) => {
        report = await dedupeCompanyTaxes(tx, companyId);
        if (!apply) throw new DryRunRollback();
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }
    if (report) console.log(`${formatTaxDedupeReport(report, apply)}\n`);
  }
  if (!apply) console.log("Ensayo terminado: no se ha guardado ningún cambio. Ejecuta con --apply para aplicarlo.");
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
