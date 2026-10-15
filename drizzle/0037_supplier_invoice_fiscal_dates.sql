ALTER TABLE "supplier_invoice" ADD COLUMN "accountingDate" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "prorrataPct" numeric(6, 3) DEFAULT '100' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "voidedAt" timestamp with time zone;--> statement-breakpoint
-- Facturas existentes: se registraron (y contabilizaron) en su fecha de factura.
UPDATE "supplier_invoice" SET "accountingDate" = "issueDate";--> statement-breakpoint
-- La prorrata aplicada hasta ahora era la vigente de la empresa.
UPDATE "supplier_invoice" si SET "prorrataPct" = cs."prorrataPct"
FROM "company_settings" cs
WHERE cs."companyId" = si."companyId";--> statement-breakpoint
-- Anuladas: fecha del asiento de anulación (sin él, se siguen excluyendo de todos los periodos).
UPDATE "supplier_invoice" si SET "voidedAt" = reversal."postedAt"
FROM (
  SELECT je."sourceId", max(je."postedAt") AS "postedAt"
  FROM "journal_entry" je
  WHERE je."sourceType" = 'supplierInvoice' AND je."reversesEntryId" IS NOT NULL
  GROUP BY je."sourceId"
) reversal
WHERE si."status" = 'VOID' AND reversal."sourceId" = si."id";
