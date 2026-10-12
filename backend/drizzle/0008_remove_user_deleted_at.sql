DO $$
BEGIN
  LOCK TABLE "app_user" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM "app_user" WHERE "deleted_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot drop app_user.deleted_at: soft-deleted users exist. Decide how to handle them before retrying; they must not regain access.';
  END IF;
  ALTER TABLE "app_user" DROP COLUMN "deleted_at";
END $$;
