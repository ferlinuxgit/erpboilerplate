ALTER TABLE "partner" ADD COLUMN "taxIdNormalized" text;
UPDATE "partner"
SET "taxIdNormalized" = NULLIF(
  CASE
    WHEN upper(regexp_replace("taxId", '[^A-Za-z0-9]', '', 'g')) LIKE upper("countryCode") || '%'
      AND length(upper(regexp_replace("taxId", '[^A-Za-z0-9]', '', 'g'))) - length("countryCode") >= 6
      THEN substring(upper(regexp_replace("taxId", '[^A-Za-z0-9]', '', 'g')) FROM length("countryCode") + 1)
    ELSE upper(regexp_replace("taxId", '[^A-Za-z0-9]', '', 'g'))
  END,
  ''
)
WHERE "taxId" IS NOT NULL;
WITH duplicate_tax_ids AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "companyId", "countryCode", "taxIdNormalized"
    ORDER BY "createdAt", "id"
  ) AS duplicate_rank
  FROM "partner"
  WHERE "taxIdNormalized" IS NOT NULL
)
UPDATE "partner" AS target
SET "taxIdNormalized" = NULL
FROM duplicate_tax_ids
WHERE target."id" = duplicate_tax_ids."id" AND duplicate_tax_ids.duplicate_rank > 1;
CREATE UNIQUE INDEX "partner_company_country_tax_normalized_unique"
  ON "partner" ("companyId", "countryCode", "taxIdNormalized")
  WHERE "taxIdNormalized" IS NOT NULL;

ALTER TABLE "supplier_invoice" ADD COLUMN "supplierDocumentNumberNormalized" text;
ALTER TABLE "supplier_invoice" ADD COLUMN "supplierIdentityKey" text;
ALTER TABLE "supplier_invoice" ADD COLUMN "documentSha256" text;
ALTER TABLE "supplier_invoice" ADD COLUMN "idempotencyKey" text;
ALTER TABLE "supplier_invoice" ADD COLUMN "currencyCode" text DEFAULT 'EUR' NOT NULL;
UPDATE "supplier_invoice" AS invoice
SET
  "supplierDocumentNumberNormalized" = NULLIF(upper(regexp_replace(invoice."supplierDocumentNumber", '[^A-Za-z0-9]', '', 'g')), ''),
  "supplierIdentityKey" = CASE
    WHEN NULLIF(upper(regexp_replace(partner."taxId", '[^A-Za-z0-9]', '', 'g')), '') IS NOT NULL
      THEN 'tax:' || upper(coalesce(partner."countryCode", 'ES')) || ':' || coalesce(
        partner."taxIdNormalized",
        CASE
          WHEN upper(regexp_replace(partner."taxId", '[^A-Za-z0-9]', '', 'g')) LIKE upper(partner."countryCode") || '%'
            AND length(upper(regexp_replace(partner."taxId", '[^A-Za-z0-9]', '', 'g'))) - length(partner."countryCode") >= 6
            THEN substring(upper(regexp_replace(partner."taxId", '[^A-Za-z0-9]', '', 'g')) FROM length(partner."countryCode") + 1)
          ELSE upper(regexp_replace(partner."taxId", '[^A-Za-z0-9]', '', 'g'))
        END
      )
    WHEN NULLIF(upper(regexp_replace(translate(partner."name", 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[^A-Za-z0-9]', '', 'g')), '') IS NOT NULL
      THEN 'name:' || upper(coalesce(partner."countryCode", 'ES')) || ':' || upper(regexp_replace(translate(partner."name", 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '[^A-Za-z0-9]', '', 'g'))
    ELSE 'partner:' || partner."id"
  END
FROM "partner"
WHERE invoice."supplierPartnerId" = partner."id";
WITH duplicate_invoice_keys AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "companyId", "supplierIdentityKey", "supplierDocumentNumberNormalized"
    ORDER BY "createdAt", "id"
  ) AS duplicate_rank
  FROM "supplier_invoice"
  WHERE "supplierIdentityKey" IS NOT NULL
    AND "supplierDocumentNumberNormalized" IS NOT NULL
    AND "status" <> 'VOID'
)
UPDATE "supplier_invoice" AS target
SET "supplierDocumentNumberNormalized" = NULL
FROM duplicate_invoice_keys
WHERE target."id" = duplicate_invoice_keys."id" AND duplicate_invoice_keys.duplicate_rank > 1;
DROP INDEX IF EXISTS "supplier_invoice_supplier_document_unique";
CREATE UNIQUE INDEX "supplier_invoice_supplier_document_canonical_unique"
  ON "supplier_invoice" ("companyId", "supplierIdentityKey", "supplierDocumentNumberNormalized")
  WHERE "supplierIdentityKey" IS NOT NULL AND "supplierDocumentNumberNormalized" IS NOT NULL AND "status" <> 'VOID';
CREATE UNIQUE INDEX "supplier_invoice_document_sha_unique"
  ON "supplier_invoice" ("companyId", "documentSha256")
  WHERE "documentSha256" IS NOT NULL AND "status" <> 'VOID';
CREATE UNIQUE INDEX "supplier_invoice_idempotency_unique"
  ON "supplier_invoice" ("companyId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE TABLE "expense_ingestion_batch" (
  "id" text PRIMARY KEY NOT NULL,
  "companyId" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
  "tenantId" text NOT NULL REFERENCES "tenant"("id") ON DELETE cascade,
  "actorUserId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "expectedFiles" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "expense_ingestion_batch_company_created_idx" ON "expense_ingestion_batch" ("companyId", "createdAt");

ALTER TABLE "expense_ocr_job" ADD COLUMN "batchId" text REFERENCES "expense_ingestion_batch"("id") ON DELETE set null;
ALTER TABLE "expense_ocr_job" ADD COLUMN "documentSha256" text;
ALTER TABLE "expense_ocr_job" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "expense_ocr_job" ADD COLUMN "leaseExpiresAt" timestamp with time zone;
ALTER TABLE "expense_ocr_job" ADD COLUMN "extractionProvider" text;
ALTER TABLE "expense_ocr_job" ADD COLUMN "extractionModel" text;
ALTER TABLE "expense_ocr_job" ADD COLUMN "extractionSchemaVersion" integer DEFAULT 1 NOT NULL;
CREATE INDEX "expense_ocr_job_batch_idx" ON "expense_ocr_job" ("batchId", "createdAt");
CREATE INDEX "expense_ocr_job_lease_idx" ON "expense_ocr_job" ("status", "leaseExpiresAt");
