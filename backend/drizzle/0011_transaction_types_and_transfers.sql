-- Categories: "kind" (one of expense/income/transfer) becomes "types", a list of
-- the transaction types the category can be used for. Added nullable first so
-- existing rows can be backfilled.
ALTER TABLE "category" ADD COLUMN "types" text[];--> statement-breakpoint

-- A transfer category accepted either sign, so it becomes usable for both.
UPDATE "category"
SET "types" = CASE WHEN "kind" = 'transfer' THEN ARRAY['expense', 'income'] ELSE ARRAY["kind"] END;--> statement-breakpoint

-- Categories are now unique per (user, name). Merge rows that only differed by
-- kind: the oldest one stays, its types become the union of the group, and the
-- transactions of the others are moved to it before they are deleted.
UPDATE "transaction" AS t
SET "category_id" = keeper."id"
FROM "category" AS c
JOIN (
  SELECT DISTINCT ON ("user_id", "name") "id", "user_id", "name"
  FROM "category"
  ORDER BY "user_id", "name", "created_at", "id"
) AS keeper ON keeper."user_id" = c."user_id" AND keeper."name" = c."name"
WHERE t."category_id" = c."id" AND c."id" <> keeper."id";--> statement-breakpoint

UPDATE "category" AS c
SET "types" = ARRAY(
  SELECT u.v
  FROM unnest(ARRAY['expense', 'income']) WITH ORDINALITY AS u(v, n)
  WHERE u.v = ANY (
    SELECT unnest(same."types") FROM "category" AS same
    WHERE same."user_id" = c."user_id" AND same."name" = c."name"
  )
  ORDER BY u.n
);--> statement-breakpoint

DELETE FROM "category"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("user_id", "name") "id"
  FROM "category"
  ORDER BY "user_id", "name", "created_at", "id"
);--> statement-breakpoint

ALTER TABLE "category" ALTER COLUMN "types" SET NOT NULL;--> statement-breakpoint
DROP INDEX "category_user_name_kind_unique";--> statement-breakpoint
ALTER TABLE "category" DROP COLUMN "kind";--> statement-breakpoint
CREATE UNIQUE INDEX "category_user_name_unique" ON "category" USING btree ("user_id","name");--> statement-breakpoint

-- Transactions get their own type. Existing rows take it from the sign of the
-- amount (never "transfer"), so no category link changes.
ALTER TABLE "transaction" ADD COLUMN "type" text;--> statement-breakpoint
UPDATE "transaction" SET "type" = CASE WHEN "amount_minor" < 0 THEN 'expense' ELSE 'income' END;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "transfer_group_id" uuid;--> statement-breakpoint
CREATE INDEX "transaction_transfer_group_id_idx" ON "transaction" USING btree ("transfer_group_id");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_type_matches_amount" CHECK (("transaction"."type" = 'expense' AND "transaction"."amount_minor" < 0) OR ("transaction"."type" = 'income' AND "transaction"."amount_minor" > 0) OR "transaction"."type" = 'transfer');--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transfer_group" CHECK (("transaction"."type" = 'transfer') = ("transaction"."transfer_group_id" IS NOT NULL));--> statement-breakpoint

-- The global, read-only "Transfer" category used by every transfer. It has no
-- owner, so user_id becomes nullable (only system rows may leave it empty).
ALTER TABLE "category" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_system_has_no_user" CHECK ("category"."is_system" = ("category"."user_id" IS NULL));--> statement-breakpoint
-- The id is also TRANSFER_CATEGORY_ID in srcs/db/categories.ts.
INSERT INTO "category" ("id", "user_id", "name", "icon", "color", "types", "is_system")
VALUES ('00000000-0000-4000-8000-000000000001', NULL, 'Transfer', 'arrow-left-right', '#334155', ARRAY['transfer'], true);
