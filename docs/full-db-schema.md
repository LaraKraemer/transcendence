# Implemented database schema

[Back to project README](../README.md#database-schema)

This describes the nine tables defined in [schema.ts](../backend/srcs/db/schema.ts); no planned tables or fields are included.
The README has a shorter overview; this diagram lists every implemented column.

```mermaid
erDiagram
    app_user {
        uuid id PK
        text email
        text password_hash "nullable"
        text display_name
        text avatar_url "nullable"
        timestamptz email_verified_at "nullable"
        timestamptz last_active_at "nullable"
        timestamptz password_changed_at
        text totp_secret_encrypted "nullable"
        timestamptz totp_enabled_at "nullable"
        bigint totp_last_used_step "nullable"
        timestamptz created_at
        timestamptz updated_at
    }
    session {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        text user_agent "nullable"
        text ip_address "nullable"
        timestamptz expires_at
        timestamptz revoked_at "nullable"
        timestamptz twofa_verified_at "nullable"
        timestamptz created_at
    }
    recovery_code {
        uuid id PK
        uuid user_id FK
        text code_hash
        timestamptz used_at "nullable"
        timestamptz created_at
    }
    user_identity {
        uuid id PK
        uuid user_id FK
        text provider
        text provider_user_id
        timestamptz created_at
    }
    user_connection {
        uuid id PK
        uuid requester_id FK
        uuid addressee_id FK
        text status
        timestamptz created_at
    }
    account {
        uuid id PK
        uuid user_id FK
        text name
        text type
        text currency_code
        bigint opening_balance_minor
        text institution "nullable"
        text account_ref "nullable"
        boolean is_archived
        timestamptz created_at
        timestamptz updated_at
    }
    category {
        uuid id PK
        uuid user_id FK
        text name
        text icon
        text color
        text[] types
        timestamptz created_at
    }
    transaction {
        uuid id PK
        uuid account_id FK
        uuid category_id FK "nullable"
        uuid created_by_id FK
        text type
        uuid transfer_group_id "nullable"
        bigint amount_minor
        text description "nullable"
        text notes "nullable"
        text merchant_name "nullable"
        date booked_on
        timestamptz occurred_at "nullable"
        timestamptz created_at
        timestamptz updated_at
    }
    currency {
        text code PK
        text name
        text symbol
        smallint minor_unit
    }

    app_user ||--o{ session : "user_id"
    app_user ||--o{ recovery_code : "user_id"
    app_user ||--o{ user_identity : "user_id"
    app_user ||--o{ user_connection : "requester_id"
    app_user ||--o{ user_connection : "addressee_id"
    app_user ||--o{ account : "user_id"
    app_user ||--o{ category : "user_id"
    account ||--o{ transaction : "account_id"
    category o|--o{ transaction : "category_id"
    app_user ||--o{ transaction : "created_by_id"
```

## Keys and rules

| Rule | Implementation |
|---|---|
| Primary keys | PostgreSQL-generated UUIDs, except `currency.code`, which is text. |
| Unique email | Unique index on `lower(app_user.email)`. |
| Unique sessions | `session.token_hash` is unique; raw session tokens are not stored. |
| Recovery codes | Unique `(user_id, code_hash)`; hashes only, with `used_at` recording use. |
| External identities | Unique `(provider, provider_user_id)` and `(user_id, provider)`. |
| Friend requests | Unique unordered requester/addressee pair; users must differ; status is `pending` or `accepted`. |
| Categories | Name is unique per user; the application validates a nonempty `types` subset of expense/income. |
| Transaction checks | Amount is nonzero; expense negative, income positive, transfer either; transfer group is present exactly for transfers. |
| Deletion | All foreign keys cascade on deletion except `transaction.category_id`, which is set to NULL. |
| Currency | Independent reference table with no foreign keys; accounts accept three uppercase letters, validated by the application. |
| Transfers | Entries share a UUID in `transfer_group_id`; there is no transfer table or foreign key for the group. |
| Data types | `timestamptz` means timestamp with time zone; `text[]` is an array of text values; money uses `bigint` minor units checked as safe integers by the application. |
| Enum-like values | Stored as text; allowed values are checked by the application and, for friend status and transaction type/sign, by database constraints. |
