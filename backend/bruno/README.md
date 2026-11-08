# Local API collection

Open this folder in the Bruno desktop app and select the **local** environment.

Before running the collection, create `backend/bruno/.env` from `.env.example`
and set a local test password of at least 12 characters. The `.env` file is
ignored by Git.

The collection calls the API at `https://localhost:8443`, so it needs the stack
running and the local CA: pass `--cacert ../../nginx/certs/ca/rootCA.pem` to
`bru run`, or set that file as the custom CA certificate in the desktop app's
**Preferences**.

Backend startup applies migrations and populates the currency catalog.
The collection checks all 17 currencies.

Run requests in numeric order. The collection creates a disposable user and
captures account, category, and transaction IDs as Bruno runtime variables.
Bruno keeps the session cookie after registration, so the following protected
requests run as that user.

The collection lists transactions across all accounts, where a transfer is one item,
and combines text, uncategorised, type and absolute-amount filters with sorting and pagination:
the income is listed, the transfer leg is not.
It archives the savings account and checks that only it appears in `GET /accounts?archived=true`.

The collection deletes the created transaction, then permanently deletes the account,
and checks that fetching each deleted resource returns 404.

The analytics requests then create EUR and USD data, including an archived account
and a transfer. They check separate currency totals, zero-filled periods, and
UTF-8 CSV with formula-safe text and decimal amounts. Reporting requires both
`from` and `to`; the range is inclusive and capped at 1827 days (about five years).

The final `09-two-factor` folder registers another disposable user and runs the whole 2FA flow:
setup, enable, a pending login that cannot read `/auth/me`, recovery-code login and disable. It computes
the TOTP codes in a pre-request script and needs `TOTP_ENCRYPTION_KEY` set on the running backend
(`openssl rand -base64 32`).
