import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Una subcuenta 572 por banco, caja (57000000) para el efectivo y forma de pago «Efectivo».
 *
 *   npm run accounting:bank-subaccounts                      → ensayo de todas las empresas (no guarda nada)
 *   npm run accounting:bank-subaccounts -- --apply           → aplica los cambios
 *   npm run accounting:bank-subaccounts -- --company=<id>    → solo una empresa (se puede repetir)
 *
 * Cada empresa va en una transacción; si el saldo del grupo 57 cambiase se deshace. Es idempotente.
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
  const { formatBankSubaccountReport, runBankSubaccountAssignment } = await import("../src/server/accounting/bank-subaccounts");

  const targets = companyIds.length > 0
    ? companyIds
    : (await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt))).map((row) => row.id);
  console.log(`Subcuentas de bancos y caja · ${apply ? "APLICAR" : "ENSAYO (dry-run, no se guarda nada)"} · ${targets.length} empresa(s)\n`);

  let failed = false;
  for (const companyId of targets) {
    try {
      console.log(formatBankSubaccountReport(await runBankSubaccountAssignment(db, { apply, companyId })));
      console.log("");
    } catch (error) {
      failed = true;
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
