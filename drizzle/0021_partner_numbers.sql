ALTER TABLE "partner" ADD COLUMN "number" text;
--> statement-breakpoint
WITH ranked_partners AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id") AS sequence_number
  FROM "partner"
)
UPDATE "partner" AS target
SET "number" = 'TER-' || lpad(ranked_partners.sequence_number::text, 6, '0')
FROM ranked_partners
WHERE target."id" = ranked_partners."id";
--> statement-breakpoint
WITH partner_counts AS (
  SELECT "companyId", count(*) AS partner_count
  FROM "partner"
  GROUP BY "companyId"
),
missing_customers AS (
  SELECT
    customer.*,
    row_number() OVER (PARTITION BY customer."companyId" ORDER BY customer."createdAt", customer."id") AS sequence_offset
  FROM "customer" AS customer
  WHERE customer."partnerId" IS NULL
)
INSERT INTO "partner" (
  "id",
  "companyId",
  "number",
  "type",
  "name",
  "email",
  "phone",
  "countryCode",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-customer-' || missing."id",
  missing."companyId",
  'TER-' || lpad((coalesce(counts.partner_count, 0) + missing.sequence_offset)::text, 6, '0'),
  'CUSTOMER',
  missing."name",
  missing."email",
  missing."phone",
  'ES',
  missing."status" = 'ACTIVE',
  missing."createdAt",
  missing."updatedAt"
FROM missing_customers AS missing
LEFT JOIN partner_counts AS counts ON counts."companyId" = missing."companyId";
--> statement-breakpoint
UPDATE "customer"
SET "partnerId" = 'legacy-customer-' || "id"
WHERE "partnerId" IS NULL;
--> statement-breakpoint
ALTER TABLE "partner" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_company_number_unique" UNIQUE("companyId", "number");
--> statement-breakpoint
CREATE TABLE "partner_number_sequence" (
  "companyId" text PRIMARY KEY NOT NULL,
  "nextNumber" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_number_sequence" ADD CONSTRAINT "partner_number_sequence_companyId_company_id_fk"
  FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "partner_number_sequence" ("companyId", "nextNumber")
SELECT "companyId", count(*) + 1
FROM "partner"
GROUP BY "companyId";
