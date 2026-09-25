import { z } from "zod";

import type { BankImportMapping } from "@/lib/bank-import/tabular";
import { HttpError } from "@/lib/http";
import { MAX_STATEMENT_BYTES, type StatementFile } from "@/server/treasury/import";

const column = z.number().int().min(0).max(200);
const mappingSchema = z.object({
  headerRow: z.number().int().min(-1).max(200),
  dateColumn: z.number().int().min(-1).max(200),
  valueDateColumn: column.nullable().optional(),
  amountColumn: column.nullable().optional(),
  debitColumn: column.nullable().optional(),
  creditColumn: column.nullable().optional(),
  descriptionColumns: z.array(column).max(10),
  balanceColumn: column.nullable().optional(),
  referenceColumn: column.nullable().optional(),
  dateFormat: z.enum(["DMY", "MDY", "YMD"]),
  decimalSeparator: z.enum([",", "."]),
  invertSign: z.boolean().optional(),
  headers: z.array(z.string().max(200)).max(200).optional(),
});

/** Lee el formulario multipart del asistente de importación (fichero + opciones). */
export async function readImportForm(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Adjunta el fichero del extracto.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Adjunta el fichero del extracto.");
  if (file.size > MAX_STATEMENT_BYTES) throw new HttpError(413, "El fichero supera 5 MB. Descarga un periodo más corto.");
  const bankAccountId = String(form.get("bankAccountId") ?? "").trim();
  if (!bankAccountId) throw new HttpError(400, "Elige la cuenta bancaria de destino.");

  let mapping: BankImportMapping | null = null;
  const rawMapping = form.get("mapping");
  if (typeof rawMapping === "string" && rawMapping.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(rawMapping);
    } catch {
      throw new HttpError(400, "El mapeo de columnas no es válido.");
    }
    const parsed = mappingSchema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, "El mapeo de columnas no es válido.");
    mapping = parsed.data;
  }
  const rawIndex = form.get("norma43AccountIndex");
  const norma43AccountIndex = typeof rawIndex === "string" && /^\d+$/.test(rawIndex) ? Number(rawIndex) : null;
  const statement: StatementFile = { name: file.name.slice(0, 200), bytes: new Uint8Array(await file.arrayBuffer()) };
  return {
    bankAccountId,
    file: statement,
    mapping,
    norma43AccountIndex,
    saveMapping: form.get("saveMapping") === "true",
    applyRules: form.get("applyRules") !== "false",
  };
}
