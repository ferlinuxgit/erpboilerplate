import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const companyId = argument("--company-id");
const cutoffText = argument("--cutoff");
const expectedCount = Number(argument("--expected-count"));
const apply = process.argv.includes("--apply");

if (!companyId || !cutoffText || !Number.isInteger(expectedCount) || expectedCount < 1) {
  throw new Error("Uso: node scripts/repair-invoice-dates.mjs --company-id <id> --cutoff YYYY-MM-DD --expected-count <n> [--apply]");
}

const cutoff = new Date(`${cutoffText}T00:00:00.000Z`);
if (Number.isNaN(cutoff.getTime())) throw new Error("La fecha de corte no es válida.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("set search_path to public");

try {
  await client.query("begin");
  const company = (
    await client.query(
      `select c.id, c."tenantId", t."ownerId", c.name, c."legalName", c."vatNumber"
       from company c
       join tenant t on t.id = c."tenantId"
       where c.id = $1
       for update`,
      [companyId],
    )
  ).rows[0];
  if (!company) throw new Error("Empresa no encontrada.");

  const invoices = (
    await client.query(
      `select id, number, "issueDate", "dueDate", "updatedAt", status, "paymentStatus"
       from invoice
       where "companyId" = $1 and "issueDate" < $2
       order by "issueDate", number
       for update`,
      [companyId, cutoff],
    )
  ).rows;
  if (invoices.length !== expectedCount) {
    throw new Error(`Se esperaban ${expectedCount} facturas y se encontraron ${invoices.length}.`);
  }

  const entries = (
    await client.query(
      `select je.id, je."postedAt", je.reference
       from journal_entry je
       join invoice i
         on i."companyId" = je."companyId"
        and je.reference = ('Factura ' || i.number)
        and je."postedAt" = i."issueDate"
       where i."companyId" = $1 and i."issueDate" < $2
       order by je."postedAt", je.reference
       for update of je`,
      [companyId, cutoff],
    )
  ).rows;
  if (entries.length !== expectedCount) {
    throw new Error(`Se esperaban ${expectedCount} asientos y se encontraron ${entries.length}.`);
  }

  const preview = {
    company: company.name,
    cutoff: cutoffText,
    invoices: invoices.map((invoice) => ({
      number: invoice.number,
      previousDate: invoice.issueDate.toISOString().slice(0, 10),
      nextDate: cutoffText,
    })),
    journalEntryCount: entries.length,
  };

  if (!apply) {
    await client.query("rollback");
    console.log(JSON.stringify({ mode: "dry-run", ...preview }, null, 2));
    process.exit(0);
  }

  const backupPath = `/tmp/erpboilerplate-invoice-date-repair-${companyId}-${Date.now()}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify({ createdAt: new Date().toISOString(), company, cutoff: cutoff.toISOString(), invoices, entries }, null, 2),
    { mode: 0o600 },
  );

  const invoiceUpdate = await client.query(
    `update invoice
     set "dueDate" = case
       when "dueDate" is null then null
       else "dueDate" + ($2::timestamptz - "issueDate")
     end,
     "issueDate" = $2,
     "updatedAt" = now()
     where id = any($1::text[])`,
    [invoices.map((invoice) => invoice.id), cutoff],
  );
  const entryUpdate = await client.query(
    `update journal_entry set "postedAt" = $2 where id = any($1::text[])`,
    [entries.map((entry) => entry.id), cutoff],
  );
  if (invoiceUpdate.rowCount !== expectedCount || entryUpdate.rowCount !== expectedCount) {
    throw new Error(`Actualización incompleta: facturas=${invoiceUpdate.rowCount}, asientos=${entryUpdate.rowCount}.`);
  }

  await client.query(
    `insert into audit_log
      (id, "tenantId", "companyId", "actorUserId", action, "entityName", "entityId", payload, "createdAt")
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      randomUUID(),
      company.tenantId,
      companyId,
      company.ownerId,
      "invoice.bulk_date_repair",
      "invoice",
      companyId,
      JSON.stringify({
        cutoff: cutoffText,
        invoiceCount: expectedCount,
        previousDates: invoices.map((invoice) => ({
          number: invoice.number,
          issueDate: invoice.issueDate.toISOString(),
          dueDate: invoice.dueDate?.toISOString() ?? null,
        })),
      }),
    ],
  );

  await client.query("commit");
  const backup = readFileSync(backupPath);
  console.log(JSON.stringify({
    mode: "applied",
    ...preview,
    updatedInvoices: invoiceUpdate.rowCount,
    updatedJournalEntries: entryUpdate.rowCount,
    backupPath,
    backupSha256: createHash("sha256").update(backup).digest("hex"),
  }, null, 2));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
