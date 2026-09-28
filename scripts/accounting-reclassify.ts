import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Reclasificación de la contabilidad existente al plan por subcuentas (fase 1).
 *
 *   npm run accounting:reclassify                      → ensayo de todas las empresas (no guarda nada)
 *   npm run accounting:reclassify -- --apply           → aplica los cambios
 *   npm run accounting:reclassify -- --company=<id>    → solo una empresa (se puede repetir)
 *
 * Cada empresa va en UNA transacción: en el ensayo se ejecuta todo y se deshace al final, así el
 * informe es exactamente lo que haría --apply. Si las sumas por cuenta de 3 dígitos cambian o algún
 * asiento queda descuadrado, la empresa se deshace y el proceso termina con error. Es idempotente.
 * Haz una copia de seguridad de la base de datos antes de ejecutar con --apply.
 */
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
  const { formatReclassificationReport, ReclassificationInvariantError, runReclassification } = await import("../src/server/accounting/reclassify");

  const targets = companyIds.length > 0
    ? companyIds
    : (await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt))).map((row) => row.id);
  console.log(`Reclasificación contable · ${apply ? "APLICAR" : "ENSAYO (dry-run, no se guarda nada)"} · ${targets.length} empresa(s)\n`);

  let failed = false;
  for (const companyId of targets) {
    try {
      const [report] = await runReclassification(db, { apply, companyIds: [companyId] });
      console.log(formatReclassificationReport(report));
      console.log("");
    } catch (error) {
      failed = true;
      if (error instanceof ReclassificationInvariantError) {
        console.error(formatReclassificationReport(error.report));
      }
      console.error(`ERROR en la empresa ${companyId}: ${error instanceof Error ? error.message : String(error)} (transacción deshecha)\n`);
    }
  }
  if (!apply) console.log("Ensayo terminado: no se ha guardado ningún cambio. Ejecuta con --apply para aplicarlo.");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
