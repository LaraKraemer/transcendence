# Local API collection

Open this folder in the Bruno desktop app and select the **local** environment.

Before running the collection, create `backend/bruno/.env` from `.env.example`
and set a local test password of at least 12 characters. The `.env` file is
ignored by Git.

After migrations, run `docker compose exec backend npm run db:seed` to populate
the currency catalog. The collection checks all 19 seeded currencies, including UAH.

Run requests in numeric order. The collection creates a disposable user and
captures account, category, and transaction IDs as Bruno runtime variables.
Bruno keeps the session cookie after registration, so the following protected
requests run as that user.

The collection deletes the created transaction and checks that fetching it returns 404.
