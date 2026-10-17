DROP INDEX "pos_ticket_refund_once_unique";--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD COLUMN "returnedLines" jsonb;--> statement-breakpoint
CREATE INDEX "pos_ticket_refund_of_idx" ON "pos_ticket" USING btree ("refundOfTicketId");