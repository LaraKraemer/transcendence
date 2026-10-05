-- Previously voided transactions must stay excluded from balances and reports.
DELETE FROM "transaction" WHERE "status" = 'void';
--> statement-breakpoint
ALTER TABLE "transaction" DROP COLUMN "status";
