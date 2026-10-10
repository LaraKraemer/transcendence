ALTER TABLE "transaction" DROP CONSTRAINT "transaction_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;