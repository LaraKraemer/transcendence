# API reference

[Back to project README](../README.md)

Docker base URL: `https://localhost:8443`; backend port 3001 is internal. Scripts must trust `nginx/certs/ca/rootCA.pem`. Send JSON unless stated otherwise. Protected requests need the session cookie (credentials: "include" in browser fetches). Missing or other users’ resources return 404.

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

## Friends

| Method | Endpoint | Purpose / input |
|---|---|---|
| `GET` | `/friends` | Return `{ friends, incoming, outgoing }`; only accepted friends include `online`. |
| `POST` | `/friends` | Send a request with `email`, trimmed and lowercased. |
| `POST` | `/friends/:connectionId/accept` | Accept an incoming request. |
| `DELETE` | `/friends/:connectionId` | Cancel, decline or remove a friendship. |

Requests are limited to ten per account and 100 per IP per 15 minutes (`FRIEND_RATE_LIMIT_MAX`, `FRIEND_IP_RATE_LIMIT_MAX`).

## Accounts and categories

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/accounts` | List active accounts or create one; `GET ?archived=true` lists only archived accounts. |
| `GET`, `PATCH`, `DELETE` | `/accounts/:accountId` | Read, update or permanently delete an account and its transactions. |
| `GET` | `/accounts/:accountId/balance` | Return `{ balanceMinor, currencyCode }`: opening balance plus transactions. |
| `GET`, `POST` | `/categories` | List or create categories. |
| `GET`, `PATCH`, `DELETE` | `/categories/:categoryId` | Read, update or delete a category; deletion leaves its transactions uncategorized. |
| `GET` | `/currencies` | List reference currencies with `code`, `name`, `symbol`, `minorUnit`. |


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


### List filters

| Parameter | Meaning |
|---|---|
| `accountId` | One owned account; omit for all accounts, including archived. |
| `q`, `categoryId` | Case-insensitive search (max 500 characters); category UUID or `none`. |
| `type`, `from`, `to` | `expense`, `income` or `transfer`; dates use `YYYY-MM-DD`. |
| `minAmountMinor`, `maxAmountMinor` | Minimum/maximum absolute amount. |
| `sort`, `order` | `bookedOn`, `amountMinor` or `createdAt`; `asc` or `desc`; default `bookedOn desc`. Amount sorting uses signed values. |
| `limit`, `offset` | Page size and number of items to skip. |


## Reports and CSV export

All reports require `from` and `to` as inclusive `YYYY-MM-DD` dates, in order and no more than 1827 days apart.
Optional filters are `accountId`, `categoryId` and `type` (`expense` or `income`). Archived accounts are included; totals stay separate by currency.

| GET endpoint | Extra parameters | Result |
|---|---|---|
| `/analytics/timeseries` | Required `granularity=day\|week\|month` | Rows of `{ period, currencyCode, incomeMinor, expenseMinor, transferOutMinor, transferInMinor }`. |
| `/analytics/categories` | None | Rows of `{ categoryId, type, totalMinor, count, currencyCode }`; no transfers. |
| `/transactions/export` | Required `format=csv` | UTF-8 file `transactions.csv`, including transfer entries. |


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
