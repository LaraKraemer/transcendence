import { bigint ,check, date, boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appUsers = pgTable(
  "app_user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Email is normalised to lowercase by the registration flow. The index also
    // protects the invariant if a user is ever created outside that flow.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("app_user_email_unique").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    // The raw token lives only in the HTTP-only browser cookie. A database leak
    // therefore cannot be used directly to impersonate a user.
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_token_hash_unique").on(table.tokenHash),
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const transactions = pgTable(
  "transaction",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),

    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
	createdById: uuid("created_by_id") .notNull() .references(() => appUsers.id),

    // Negative values are expenses; positive values are income.
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),

    description: text("description").notNull(),
    notes: text("notes"),

    // YYYY-MM-DD: this is the date used for filtering and reports.
    bookedOn: date("booked_on").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),

    status: text("status").notNull().default("cleared"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "transaction_amount_non_zero",
      sql`${table.amountMinor} <> 0`,
    ),
    index("transaction_account_booked_on_idx").on(
      table.accountId,
      table.bookedOn,
    ),
    index("transaction_category_id_idx").on(table.categoryId),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;


// account entity
export const accounts = pgTable(
  "account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currencyCode: text("currency_code").notNull().default("EUR"),
    openingBalanceMinor: bigint("opening_balance_minor", { mode: "number" })
      .notNull()
      .default(0),
    institution: text("institution"),
    accountRef: text("account_ref"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

// category entity
export const categories = pgTable(
  "category",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    color: text("color").notNull(),
    kind: text("kind").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("category_user_id_idx").on(table.userId),
    uniqueIndex("category_user_name_kind_unique").on(
      table.userId,
      table.name,
      table.kind,
    ),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;