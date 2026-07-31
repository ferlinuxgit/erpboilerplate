ALTER TABLE "tax" ADD COLUMN "kind" text DEFAULT 'VAT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax" ADD COLUMN "operation" text DEFAULT 'ADD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax" ADD COLUMN "isDefault" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax" ADD COLUMN "createdAt" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "tax"
SET "kind" = 'WITHHOLDING', "operation" = 'SUBTRACT'
WHERE lower("name") LIKE '%irpf%'
   OR lower("name") LIKE '%retencion%'
   OR lower("name") LIKE '%retención%';
--> statement-breakpoint
UPDATE "tax"
SET "kind" = 'SURCHARGE', "operation" = 'ADD'
WHERE lower("name") LIKE '%recargo%';
--> statement-breakpoint
CREATE INDEX "tax_company_active_idx" ON "tax" USING btree ("companyId", "isActive");
--> statement-breakpoint
ALTER TABLE "tax" ADD CONSTRAINT "tax_rate_nonnegative" CHECK ("tax"."rate" >= 0);
--> statement-breakpoint
ALTER TABLE "tax" ADD CONSTRAINT "tax_kind_valid" CHECK ("tax"."kind" IN ('VAT', 'SURCHARGE', 'WITHHOLDING', 'OTHER'));
--> statement-breakpoint
ALTER TABLE "tax" ADD CONSTRAINT "tax_operation_valid" CHECK ("tax"."operation" IN ('ADD', 'SUBTRACT'));
--> statement-breakpoint
CREATE TABLE "invoice_line_tax" (
	"id" text PRIMARY KEY NOT NULL,
	"invoiceLineId" text NOT NULL,
	"taxId" text,
	"name" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"kind" text NOT NULL,
	"operation" text NOT NULL,
	"baseAmount" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_line_tax_rate_nonnegative" CHECK ("invoice_line_tax"."rate" >= 0),
	CONSTRAINT "invoice_line_tax_operation_valid" CHECK ("invoice_line_tax"."operation" IN ('ADD', 'SUBTRACT'))
);
--> statement-breakpoint
ALTER TABLE "invoice_line_tax" ADD CONSTRAINT "invoice_line_tax_invoiceLineId_invoice_line_id_fk" FOREIGN KEY ("invoiceLineId") REFERENCES "public"."invoice_line"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_line_tax" ADD CONSTRAINT "invoice_line_tax_taxId_tax_id_fk" FOREIGN KEY ("taxId") REFERENCES "public"."tax"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "invoice_line_tax_line_idx" ON "invoice_line_tax" USING btree ("invoiceLineId");
--> statement-breakpoint
CREATE INDEX "invoice_line_tax_tax_idx" ON "invoice_line_tax" USING btree ("taxId");
--> statement-breakpoint
INSERT INTO "invoice_line_tax" ("id", "invoiceLineId", "taxId", "name", "rate", "kind", "operation", "baseAmount", "amount")
SELECT
  'migrated-add-' || line."id",
  line."id",
  configured_tax."id",
  coalesce(configured_tax."name", 'IVA ' || trim(to_char(line."taxRate", 'FM999990.999')) || '%'),
  line."taxRate",
  coalesce(configured_tax."kind", 'VAT'),
  'ADD',
  round(line."quantity" * line."unitPrice" * (1 - line."discountPct" / 100), 2),
  round(line."quantity" * line."unitPrice" * (1 - line."discountPct" / 100) * line."taxRate" / 100, 2)
FROM "invoice_line" AS line
INNER JOIN "invoice" AS document ON document."id" = line."invoiceId"
LEFT JOIN LATERAL (
  SELECT configured."id", configured."name", configured."kind"
  FROM "tax" AS configured
  WHERE configured."companyId" = document."companyId"
    AND configured."operation" = 'ADD'
    AND configured."rate" = line."taxRate"
  ORDER BY configured."isActive" DESC, configured."id"
  LIMIT 1
) AS configured_tax ON true
WHERE line."taxRate" > 0;
--> statement-breakpoint
INSERT INTO "invoice_line_tax" ("id", "invoiceLineId", "taxId", "name", "rate", "kind", "operation", "baseAmount", "amount")
SELECT
  'migrated-subtract-' || line."id",
  line."id",
  configured_tax."id",
  coalesce(configured_tax."name", 'Retención ' || trim(to_char(line."retentionRate", 'FM999990.999')) || '%'),
  line."retentionRate",
  coalesce(configured_tax."kind", 'WITHHOLDING'),
  'SUBTRACT',
  round(line."quantity" * line."unitPrice" * (1 - line."discountPct" / 100), 2),
  round(line."quantity" * line."unitPrice" * (1 - line."discountPct" / 100) * line."retentionRate" / 100, 2)
FROM "invoice_line" AS line
INNER JOIN "invoice" AS document ON document."id" = line."invoiceId"
LEFT JOIN LATERAL (
  SELECT configured."id", configured."name", configured."kind"
  FROM "tax" AS configured
  WHERE configured."companyId" = document."companyId"
    AND configured."operation" = 'SUBTRACT'
    AND configured."rate" = line."retentionRate"
  ORDER BY configured."isActive" DESC, configured."id"
  LIMIT 1
) AS configured_tax ON true
WHERE line."retentionRate" > 0;
