CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"booked_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"status" text DEFAULT 'cleared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_amount_non_zero" CHECK ("transaction"."amount_minor" <> 0)
);
--> statement-breakpoint
DROP TABLE "expenses" CASCADE;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_account_booked_on_idx" ON "transaction" USING btree ("account_id","booked_on");--> statement-breakpoint
CREATE INDEX "transaction_category_id_idx" ON "transaction" USING btree ("category_id");