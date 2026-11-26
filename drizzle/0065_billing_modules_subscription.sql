ALTER TABLE "subscription" ADD COLUMN "stripeModulesSubscriptionId" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "modulesStatus" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "modulesLastStripeEventAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_stripeModulesSubscriptionId_unique" UNIQUE("stripeModulesSubscriptionId");