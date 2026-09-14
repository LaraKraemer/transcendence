-- Add the column as nullable so existing transaction rows remain valid.
ALTER TABLE "transaction" ADD COLUMN "created_by_id" uuid;

--> statement-breakpoint

-- Each existing transaction belongs to an account, and each current account
-- has exactly one owner. Use that owner as the transaction creator.
UPDATE "transaction" AS transaction
SET "created_by_id" = account."user_id"
FROM "account" AS account
WHERE transaction."account_id" = account."id";

--> statement-breakpoint

-- Every existing transaction now has a creator, so make it required.
ALTER TABLE "transaction"
ALTER COLUMN "created_by_id" SET NOT NULL;

--> statement-breakpoint

ALTER TABLE "transaction"
ADD CONSTRAINT "transaction_created_by_id_app_user_id_fk"
FOREIGN KEY ("created_by_id")
REFERENCES "public"."app_user"("id")
ON DELETE no action
ON UPDATE no action;