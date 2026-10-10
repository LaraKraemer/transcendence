\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  active_account_id uuid := gen_random_uuid();
  archived_account_id uuid := gen_random_uuid();
  unrelated_account_id uuid := gen_random_uuid();
  empty_account_id uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO app_user (id, email, password_hash, display_name)
  VALUES (owner_id, owner_id::text || '@cascade-test.invalid', 'unused', 'Cascade smoke test');

  INSERT INTO account (id, user_id, name, type, is_archived) VALUES
    (active_account_id, owner_id, 'Active', 'checking', false),
    (archived_account_id, owner_id, 'Archived', 'checking', true),
    (unrelated_account_id, owner_id, 'Unrelated', 'checking', false),
    (empty_account_id, owner_id, 'Empty', 'cash', false);

  INSERT INTO category (id, user_id, name, icon, color, kind)
  VALUES (category_id, owner_id, 'Expenses', 'shopping-cart', '#15803d', 'expense');

  INSERT INTO "transaction" (account_id, category_id, created_by_id, amount_minor, description, booked_on) VALUES
    (active_account_id, category_id, owner_id, -100, 'Categorized expense', CURRENT_DATE),
    (active_account_id, NULL, owner_id, 200, 'Uncategorized income', CURRENT_DATE),
    (archived_account_id, category_id, owner_id, -300, 'Archived expense', CURRENT_DATE),
    (unrelated_account_id, category_id, owner_id, -400, 'Unrelated expense', CURRENT_DATE);

  DELETE FROM account WHERE id IN (active_account_id, archived_account_id, empty_account_id);

  IF EXISTS (SELECT FROM account WHERE id IN (active_account_id, archived_account_id, empty_account_id))
    OR EXISTS (SELECT FROM "transaction" WHERE account_id IN (active_account_id, archived_account_id)) THEN
    RAISE EXCEPTION 'Deleted accounts or their transactions remain';
  END IF;

  IF NOT EXISTS (SELECT FROM account WHERE id = unrelated_account_id)
    OR (SELECT count(*) FROM "transaction" WHERE account_id = unrelated_account_id) <> 1
    OR NOT EXISTS (SELECT FROM category WHERE id = category_id)
    OR NOT EXISTS (SELECT FROM app_user WHERE id = owner_id) THEN
    RAISE EXCEPTION 'Account deletion removed unrelated data';
  END IF;
END $$;

ROLLBACK;
