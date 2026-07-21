ALTER TABLE "goods_receipt" ADD COLUMN "companyId" text;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD COLUMN "number" text;
--> statement-breakpoint
UPDATE "goods_receipt" AS receipt
SET "companyId" = purchase_order."companyId"
FROM "purchase_order"
WHERE receipt."purchaseOrderId" = purchase_order."id";
--> statement-breakpoint
WITH ranked_receipts AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "receivedAt", "id") AS sequence_number
  FROM "goods_receipt"
)
UPDATE "goods_receipt" AS target
SET "number" = 'RCP-MIG-' || lpad(ranked_receipts.sequence_number::text, 6, '0')
FROM ranked_receipts
WHERE target."id" = ranked_receipts."id";
--> statement-breakpoint
ALTER TABLE "goods_receipt" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_company_number_unique" UNIQUE("companyId", "number");
--> statement-breakpoint
CREATE INDEX "goods_receipt_company_date_idx" ON "goods_receipt" ("companyId", "receivedAt");
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "number" text;
--> statement-breakpoint
WITH ranked_payments AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "postedAt", "createdAt", "id") AS sequence_number
  FROM "payment"
)
UPDATE "payment" AS target
SET "number" = 'COB-MIG-' || lpad(ranked_payments.sequence_number::text, 6, '0')
FROM ranked_payments
WHERE target."id" = ranked_payments."id";
--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_number_unique" UNIQUE("companyId", "number");
--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD COLUMN "number" text;
--> statement-breakpoint
WITH ranked_supplier_payments AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "postedAt", "createdAt", "id") AS sequence_number
  FROM "supplier_payment"
)
UPDATE "supplier_payment" AS target
SET "number" = 'PAG-MIG-' || lpad(ranked_supplier_payments.sequence_number::text, 6, '0')
FROM ranked_supplier_payments
WHERE target."id" = ranked_supplier_payments."id";
--> statement-breakpoint
ALTER TABLE "supplier_payment" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_company_number_unique" UNIQUE("companyId", "number");
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "number" text;
--> statement-breakpoint
WITH ranked_entries AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "postedAt", "id") AS sequence_number
  FROM "journal_entry"
)
UPDATE "journal_entry" AS target
SET "number" = 'ASI-' || lpad(ranked_entries.sequence_number::text, 6, '0')
FROM ranked_entries
WHERE target."id" = ranked_entries."id";
--> statement-breakpoint
ALTER TABLE "journal_entry" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_number_unique" UNIQUE("companyId", "number");
--> statement-breakpoint
CREATE TABLE "journal_entry_number_sequence" (
  "companyId" text PRIMARY KEY NOT NULL,
  "nextNumber" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entry_number_sequence" ADD CONSTRAINT "journal_entry_number_sequence_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "journal_entry_number_sequence" ("companyId", "nextNumber")
SELECT "companyId", count(*) + 1
FROM "journal_entry"
GROUP BY "companyId";
