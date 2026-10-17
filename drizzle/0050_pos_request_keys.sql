CREATE TABLE "pos_request_key" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"key" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_request_key_unique" UNIQUE("companyId","key")
);
--> statement-breakpoint
ALTER TABLE "pos_request_key" ADD CONSTRAINT "pos_request_key_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_request_key_created_idx" ON "pos_request_key" USING btree ("createdAt");