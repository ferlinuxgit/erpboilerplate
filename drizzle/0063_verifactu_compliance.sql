CREATE TABLE "verifactu_certificate" (
	"companyId" text PRIMARY KEY NOT NULL,
	"pfxEncrypted" text NOT NULL,
	"passphraseEncrypted" text NOT NULL,
	"fileName" text,
	"subject" text,
	"validTo" timestamp with time zone,
	"uploadedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "operationDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "vatExemptionCode" text;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD COLUMN "subsanacion" text;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD COLUMN "rechazoPrevio" text;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD COLUMN "operationDate" text;--> statement-breakpoint
ALTER TABLE "verifactu_certificate" ADD CONSTRAINT "verifactu_certificate_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_subsanacion_valid" CHECK ("verifactu_record"."subsanacion" IS NULL OR "verifactu_record"."subsanacion" = 'S');--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_rechazo_valid" CHECK ("verifactu_record"."rechazoPrevio" IS NULL OR "verifactu_record"."rechazoPrevio" IN ('S', 'X'));