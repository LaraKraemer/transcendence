import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import { db } from "../db/client.ts";
import { accounts, categories, transactions } from "../db/schema.ts";

const TRANSACTION_STATUSES = ["pending", "cleared", "void"] as const;
type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

function isTransactionStatus(value: unknown): value is TransactionStatus {
  return (
    typeof value === "string" &&
    TRANSACTION_STATUSES.includes(value as TransactionStatus)
  );
}

function isDateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Finds an account only when it belongs to the current authenticated user. */
async function findOwnedAccount(accountId: string, userId: string) {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        eq(accounts.isArchived, false),
      ),
    )
    .limit(1);

  return account;
}

/** Finds a transaction only when its account belongs to the authenticated user. */
async function findOwnedTransaction(transactionId: string, userId: string) {
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!transaction) return undefined;

  const account = await findOwnedAccount(transaction.accountId, userId);
  return account ? transaction : undefined;
}

/** Ensures a selected category belongs to the user and matches the amount sign. */
async function validateCategory(
  categoryId: string | null,
  amountMinor: number,
  userId: string,
): Promise<string | undefined> {
  if (categoryId === null) return undefined;

  const [category] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);

  if (!category) return "Category not found";

  const requiredKind = amountMinor < 0 ? "expense" : "income";
  return category.kind === requiredKind
    ? undefined
    : `A ${requiredKind} transaction requires an ${requiredKind} category`;
}

export const transactionsRouter = Router();

transactionsRouter.use(requireAuthenticatedUser);

/**
 * Lists transactions for one account owned by the authenticated user.
 *
 * Required query parameter: accountId
 */
transactionsRouter.get("/", async (req, res, next) => {
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (!accountId) {
    res.status(400).json({ error: "accountId is required" });
    return;
  }

  try {
    const account = await findOwnedAccount(accountId, res.locals.userId);

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account.id))
      .orderBy(desc(transactions.bookedOn), desc(transactions.createdAt));

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/** Returns one transaction from an account owned by the authenticated user. */
transactionsRouter.get("/:transactionId", async (req, res, next) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  try {
    const transaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

/** Updates a transaction while preserving account ownership and category rules. */
transactionsRouter.patch("/:transactionId", async (req, res, next) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  const body = req.body ?? {};

  try {
    const transaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    const updates: {
      categoryId?: string | null;
      amountMinor?: number;
      description?: string;
      notes?: string | null;
      bookedOn?: string;
      status?: TransactionStatus;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    let hasUpdates = false;

    if (Object.hasOwn(body, "amountMinor")) {
      if (!Number.isSafeInteger(body.amountMinor) || body.amountMinor === 0) {
        res.status(400).json({ error: "amountMinor must be a non-zero safe integer" });
        return;
      }
      updates.amountMinor = body.amountMinor;
      hasUpdates = true;
    }

    if (Object.hasOwn(body, "categoryId")) {
      if (body.categoryId !== null && !isUuid(body.categoryId)) {
        res.status(400).json({ error: "categoryId must be a valid UUID or null" });
        return;
      }
      updates.categoryId = body.categoryId;
      hasUpdates = true;
    }

    if (Object.hasOwn(body, "description")) {
      if (typeof body.description !== "string" || body.description.trim().length === 0 || body.description.trim().length > 500) {
        res.status(400).json({ error: "description must be between 1 and 500 characters" });
        return;
      }
      updates.description = body.description.trim();
      hasUpdates = true;
    }

    if (Object.hasOwn(body, "notes")) {
      if (body.notes !== null && typeof body.notes !== "string") {
        res.status(400).json({ error: "notes must be a string or null" });
        return;
      }
      updates.notes = body.notes === null ? null : body.notes.trim();
      hasUpdates = true;
    }

    if (Object.hasOwn(body, "bookedOn")) {
      if (!isDateOnly(body.bookedOn)) {
        res.status(400).json({ error: "bookedOn must use YYYY-MM-DD format" });
        return;
      }
      updates.bookedOn = body.bookedOn;
      hasUpdates = true;
    }

    if (Object.hasOwn(body, "status")) {
      if (!isTransactionStatus(body.status)) {
        res.status(400).json({ error: "status must be pending, cleared, or void" });
        return;
      }
      updates.status = body.status;
      hasUpdates = true;
    }

    if (!hasUpdates) {
      res.status(400).json({ error: "Provide at least one editable transaction field" });
      return;
    }

    const candidateAmount = updates.amountMinor ?? transaction.amountMinor;
    const candidateCategoryId = Object.hasOwn(updates, "categoryId")
      ? updates.categoryId ?? null
      : transaction.categoryId;
    const categoryError = await validateCategory(candidateCategoryId, candidateAmount, res.locals.userId);
    if (categoryError) {
      res.status(categoryError === "Category not found" ? 404 : 400).json({ error: categoryError });
      return;
    }

    const [updatedTransaction] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.id, transaction.id))
      .returning();

    res.json(updatedTransaction);
  } catch (error) {
    next(error);
  }
});

/** Voids a transaction instead of deleting financial history permanently. */
transactionsRouter.delete("/:transactionId", async (req, res, next) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  try {
    const transaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    await db
      .update(transactions)
      .set({ status: "void", updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Creates an income or expense transaction in an account owned by the
 * authenticated user.
 */
transactionsRouter.post("/", async (req, res, next) => {
  const {
    accountId,
    categoryId,
    amountMinor,
    description,
    notes,
    bookedOn,
    status,
  } = req.body ?? {};

  if (!isUuid(accountId)) {
	res.status(400).json({ error: "accountId must be a valid UUID" });
	return;
	}

  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) {
    res.status(400).json({ error: "amountMinor must be a non-zero safe integer" });
    return;
  }

  if (
    typeof description !== "string" ||
    description.trim().length === 0 ||
    description.trim().length > 500
  ) {
    res.status(400).json({ error: "description must be between 1 and 500 characters" });
    return;
  }

  if (!isDateOnly(bookedOn)) {
    res.status(400).json({ error: "bookedOn must use YYYY-MM-DD format" });
    return;
  }

  if (status !== undefined && !isTransactionStatus(status)) {
    res.status(400).json({ error: "status must be pending, cleared, or void" });
    return;
  }

  if (notes !== undefined && typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }

  if (categoryId !== undefined && !isUuid(categoryId)) {
	res.status(400).json({ error: "categoryId must be a valid UUID" });
  	return;
  }

  try {
    const account = await findOwnedAccount(accountId, res.locals.userId);

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    if (categoryId !== undefined) {
      const [category] = await db
        .select({ id: categories.id, kind: categories.kind })
        .from(categories)
        .where(
          and(
            eq(categories.id, categoryId),
            eq(categories.userId, res.locals.userId),
            eq(categories.isArchived, false),
          ),
        )
        .limit(1);

      if (!category) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      const requiredKind = amountMinor < 0 ? "expense" : "income";

      if (category.kind !== requiredKind) {
        res.status(400).json({
          error: `A ${requiredKind} transaction requires an ${requiredKind} category`,
        });
        return;
      }
    }

    const [transaction] = await db
      .insert(transactions)
      .values({
        accountId: account.id,
		createdById: res.locals.userId,
        ...(categoryId === undefined ? {} : { categoryId }),
        amountMinor,
        description: description.trim(),
        ...(notes === undefined ? {} : { notes: notes.trim() }),
        bookedOn,
        ...(status === undefined ? {} : { status }),
		
      })
      .returning();

    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
});
