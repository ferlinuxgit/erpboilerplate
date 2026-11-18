CREATE TABLE "billing_price" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"amountCents" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"interval" text,
	"stripeProductId" text NOT NULL,
	"stripePriceId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_price_stripePriceId_unique" UNIQUE("stripePriceId"),
	CONSTRAINT "billing_price_code_amount_unique" UNIQUE("code","amountCents","currency","interval")
);
--> statement-breakpoint
CREATE TABLE "ocr_credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"companyId" text,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"description" text NOT NULL,
	"ocrJobId" text,
	"stripeCheckoutSessionId" text,
	"model" text,
	"inputTokens" integer,
	"cachedInputTokens" integer,
	"outputTokens" integer,
	"costMicroUsd" integer,
	"actorUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ocr_credit_ledger_stripeCheckoutSessionId_unique" UNIQUE("stripeCheckoutSessionId"),
	CONSTRAINT "ocr_credit_ledger_job_usage_unique" UNIQUE("ocrJobId","kind")
);
--> statement-breakpoint
ALTER TABLE "tenant" DROP CONSTRAINT "tenant_ownerId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "addons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "pastDueSince" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "trialEndsAt" timestamp with time zone DEFAULT now() + interval '14 days';--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "billingExempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "suspendedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "suspendedReason" text;--> statement-breakpoint
ALTER TABLE "ocr_credit_ledger" ADD CONSTRAINT "ocr_credit_ledger_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_credit_ledger" ADD CONSTRAINT "ocr_credit_ledger_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ocr_credit_ledger_tenant_idx" ON "ocr_credit_ledger" USING btree ("tenantId","createdAt");--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Escrito a mano: los espacios que ya existían empiezan su prueba al desplegar el cobro, con 30 días
-- (los nuevos, 14 por defecto), y todos reciben los créditos de lectura de bienvenida.
UPDATE "tenant" SET "trialEndsAt" = now() + interval '30 days';--> statement-breakpoint
INSERT INTO "ocr_credit_ledger" ("id", "tenantId", "kind", "delta", "description")
SELECT gen_random_uuid()::text, "id", 'TRIAL', 25, 'Créditos de bienvenida para leer facturas con IA' FROM "tenant";
