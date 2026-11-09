# API reference

[Back to project README](../README.md)

Local base URL: `http://localhost:3001`. These endpoints are available in this branch.
Send JSON unless stated otherwise. Protected routes need the `session` cookie; browser requests must use `credentials: "include"`.
Users can access only their own data. Missing items and items owned by someone else both return `404`.

## Authentication and profile

| Method | Endpoint | Purpose / input |
|---|---|---|
| `POST` | `/auth/register` | Register with `email`, `password`, `displayName`; starts a session. |
| `POST` | `/auth/login` | Sign in with `email` and `password`. |
| `POST` | `/auth/google` | Google sign-in with `code`, `codeVerifier`, `redirectUri`; called by the frontend. |
| `POST` | `/auth/2fa/setup` | Create a TOTP secret; returns `secret` and `otpauthUri`, but leaves 2FA off. |
| `POST` | `/auth/2fa/enable` | Send `code` to enable 2FA; returns ten recovery codes shown once. |
| `POST` | `/auth/2fa/verify` | Send `code` to finish a pending login. |
| `POST` | `/auth/2fa/recover` | Send `recoveryCode` to finish a pending login; each code works once. |
| `POST` | `/auth/2fa/disable` | Send `code` or `recoveryCode`, plus `password` for password accounts; disables 2FA and ends other sessions. |
| `POST` | `/auth/logout` | End the current session. |
| `GET` | `/auth/me` | Get the signed-in user. |
| `PATCH` | `/auth/me` | Change `displayName`. |
| `PATCH` | `/auth/password` | Send `currentPassword` and `newPassword`; success returns `204` and ends all sessions. |
| `DELETE` | `/auth/me` | Permanently delete the user and all owned data, including archived accounts; returns `204` and ends all sessions. |
| `PUT` | `/auth/me/avatar` | Upload a raw JPEG/PNG body, up to 5 MiB; use `image/jpeg` or `image/png`, not multipart. |
| `GET` | `/auth/me/avatar` | Get the profile image. |
| `DELETE` | `/auth/me/avatar` | Remove the profile image. |

Passwords need at least 12 JavaScript characters and at most 72 UTF-8 bytes; only hashes are stored.
`avatarUrl` is a versioned image URL, or `null` without an image; replacing the image changes the URL.

Google sign-in requires a verified Google email. Linking an existing same-email account requires its email to be verified too; otherwise the API returns `409`.
Google-only accounts return `hasPassword: false` and cannot use password login or password changes.
See [Google setup](development.md#google-sign-in-setup) for credentials and redirect configuration.

Register and save the session cookie:

```bash
curl -i -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-secure-password","displayName":"Your name"}' \
  http://localhost:3001/auth/register
```

Use `curl -b cookies.txt` for later protected requests.
Register, login and Google sign-in share a limit of 100 requests per IP per 15 minutes; login also allows 10 attempts per IP/email in that time. Limits reset on backend restart and are not shared across instances.

When 2FA is enabled, password and Google login return `twoFactorRequired: true` with a ten-minute pending session; only verification, recovery and logout are allowed until the second step succeeds.
Codes use 30-second steps with one step of clock tolerance either way; a step cannot be reused. Code endpoints allow ten attempts per IP/user per 15 minutes (`TWOFA_RATE_LIMIT_MAX`).
`GET /auth/me` includes `twoFactorEnabled`; 2FA setup requires `TOTP_ENCRYPTION_KEY`.

## Accounts and categories

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/accounts` | List active accounts or create one; `GET ?archived=true` lists only archived accounts. |
| `GET`, `PATCH`, `DELETE` | `/accounts/:accountId` | Read, update or permanently delete an account and its transactions. |
| `GET` | `/accounts/:accountId/balance` | Return `{ balanceMinor, currencyCode }`: opening balance plus transactions. |
| `GET`, `POST` | `/categories` | List or create categories. |
| `GET`, `PATCH`, `DELETE` | `/categories/:categoryId` | Read, update or delete a category; deletion leaves its transactions uncategorized. |
| `GET` | `/currencies` | List reference currencies with `code`, `name`, `symbol`, `minorUnit`. |

Archived accounts stay readable and appear in reports. They cannot receive new transactions, imports or transfers, but existing non-transfer transactions can still be edited/deleted.
Restore with `PATCH {"isArchived": false}` before editing account details; permanent deletion is allowed without restoring.
Changing an account's currency returns `409` if transactions exist; otherwise it is allowed but does not convert the opening balance.
Account currency codes accept any three uppercase letters; the reference catalog has 17 currencies, all with `minorUnit: 2`.

## Transactions

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/transactions` | List transactions or create an expense/income. |
| `GET`, `PATCH`, `DELETE` | `/transactions/:transactionId` | Read, update or delete a transaction. |
| `POST` | `/transactions/transfers` | Create two linked transfer entries between different active owned accounts. |
| `GET` | `/transactions/summary?accountId=<uuid>` | Category/type totals for one account; optional `from` and `to` dates. |
| `GET` | `/transactions/count/:categoryId` | Return `{ transactionCount }` for a category. |
| `POST` | `/transactions/import?accountId=<uuid>` | Import JSON; see below. |
| `GET` | `/transactions/export` | Export CSV; see Reports below. |

Money uses safe integers in minor units: `-2499` means an expense of 24.99 for a two-decimal currency. Zero is rejected; expenses are negative, income positive.
Categories allow expense, income or both; changing a category does not change existing transactions.
Transfers have no category and cannot be edited. Deleting either entry deletes both; deleting an account can leave the other account's entry behind.
Same-currency transfer amounts must match. Optional `merchant` accepts up to 100 trimmed characters; blank or `null` clears it.
The summary returns `{ categoryId, type, totalMinor, count }` rows, including uncategorized entries and transfers, in the selected account's currency.

### List filters

| Parameter | Meaning |
|---|---|
| `accountId` | One owned account; omit for all accounts, including archived. |
| `q`, `categoryId` | Case-insensitive search (max 500 characters); category UUID or `none`. |
| `type`, `from`, `to` | `expense`, `income` or `transfer`; dates use `YYYY-MM-DD`. |
| `minAmountMinor`, `maxAmountMinor` | Minimum/maximum absolute amount. |
| `sort`, `order` | `bookedOn`, `amountMinor` or `createdAt`; `asc` or `desc`; default `bookedOn desc`. Amount sorting uses signed values. |
| `limit`, `offset` | Page size and number of items to skip. |

The response includes `total`, `moneyInMinor` and `moneyOutMinor` across all matches, not just the page; these sums can mix currencies.
When both transfer entries are in the account selection, the list shows one item with the other account and amount.

## Reports and CSV export

All reports require `from` and `to` as inclusive `YYYY-MM-DD` dates, in order and no more than 1827 days apart.
Optional filters are `accountId`, `categoryId` and `type` (`expense` or `income`). Archived accounts are included; totals stay separate by currency.

| GET endpoint | Extra parameters | Result |
|---|---|---|
| `/analytics/timeseries` | Required `granularity=day\|week\|month` | Rows of `{ period, currencyCode, incomeMinor, expenseMinor, transferOutMinor, transferInMinor }`. |
| `/analytics/categories` | None | Rows of `{ categoryId, type, totalMinor, count, currencyCode }`; no transfers. |
| `/transactions/export` | Required `format=csv` | UTF-8 file `transactions.csv`, including transfer entries. |

Expenses stay negative. Weeks start Monday, months on day 1; time series include empty periods as zero rows.
A period can start before `from`, but only transactions within the requested range count.
Transfer fields are separate from income/expense and zero when a type or category filter is used; CSV transfer entries have an empty category.
CSV columns: `account,currency,date,type,category,merchant,description,amount`; ordered by booked date, creation time and ID. Amounts use a decimal point and the currency's precision (fallback 2).

```text
GET /analytics/timeseries?from=2026-01-01&to=2026-01-31&granularity=week
GET /transactions/export?format=csv&from=2026-01-01&to=2026-01-31
```

## JSON import

Send raw `application/json` to `POST /transactions/import?accountId=<uuid>`: up to 5 MiB and 1–1,000 rows, into an active account with the same currency.

```json
{
  "version": 1,
  "currency": "EUR",
  "transactions": [
    { "bookedOn": "2026-10-20", "type": "expense", "amountMinor": -2499 }
  ]
}
```

Each row needs `bookedOn`, `type` and `amountMinor`; optional fields are `description`, `notes`, `category`, `occurredAt`.
An optional category name must match an existing owned category after trimming, with the same case, and allow the transaction type; blank/null means no category.
Transfers, unknown fields/versions and invalid rows are rejected. All rows are saved together or none are saved; success returns `201 { "imported": <count> }`.
The source file is not stored. Importing again creates duplicates, so check the list before retrying after a network error.

## Public status

| GET endpoint | Purpose |
|---|---|
| `/health` | Database readiness. |
| `/status` | Database latency, avatar storage access, uptime, version and latest successful backup. |

## Errors

Errors return `{ "error": "message" }`.

| Status | Meaning |
|---|---|
| `400` | Invalid input or filters. |
| `401` | Not signed in, or incorrect login/password. |
| `404` | Item missing or owned by another user. |
| `409` | Conflict, such as an archived destination or email already in use. |
| `413` | Body exceeds the size limit. |
| `415` | Unsupported avatar content type. |
| `429` | Too many authentication attempts. |

See the [Bruno collection](../backend/bruno/README.md) for runnable API examples and the [testing guide](testing.md) for checks.
