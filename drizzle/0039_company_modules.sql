CREATE TABLE "company_module" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"moduleId" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updatedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_module_company_module_unique" UNIQUE("companyId","moduleId")
);
--> statement-breakpoint
ALTER TABLE "company_module" ADD CONSTRAINT "company_module_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_module" ADD CONSTRAINT "company_module_updatedByUserId_user_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;