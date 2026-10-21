-- Categories are only for expenses and income now; transfers have no category.
-- Deleting the system "Transfer" row sets category_id = NULL on existing transfer
-- legs (ON DELETE SET NULL), so no transaction changes otherwise.
DELETE FROM "category" WHERE "is_system";--> statement-breakpoint
ALTER TABLE "category" DROP CONSTRAINT "category_system_has_no_user";--> statement-breakpoint
ALTER TABLE "category" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "category" DROP COLUMN "is_system";
