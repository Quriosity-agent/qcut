ALTER TABLE "credit_balances" ALTER COLUMN "plan_credits" TYPE numeric(12,3) USING "plan_credits"::numeric;--> statement-breakpoint
ALTER TABLE "credit_balances" ALTER COLUMN "top_up_credits" TYPE numeric(12,3) USING "top_up_credits"::numeric;--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "amount" TYPE numeric(12,3) USING "amount"::numeric;--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "balance_after" TYPE numeric(12,3) USING "balance_after"::numeric;--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "stripe_webhook_events_event_id_unique" UNIQUE("event_id")
);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;
