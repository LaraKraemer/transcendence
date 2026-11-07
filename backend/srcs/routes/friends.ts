import { Router } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { requireAuthenticatedUser } from "../auth.ts";
import { db } from "../db/client.ts";
import { appUsers, userConnections } from "../db/schema.ts";
import { createFriendRequestRateLimiters } from "../rate-limit.ts";
import { isUuid, TEXT_LIMITS } from "../validation.ts";

export const friendsRouter = Router();
friendsRouter.use(requireAuthenticatedUser);
const otherUser = alias(appUsers, "friend_user");

/** Lists only the caller's relationships; presence is returned for accepted friends alone. */
friendsRouter.get("/", async (_req, res, next) => {
  try {
    const userId = res.locals.userId as string;
    const rows = await db
      .select({
        id: userConnections.id,
        requesterId: userConnections.requesterId,
        status: userConnections.status,
        userId: otherUser.id,
        email: otherUser.email,
        displayName: otherUser.displayName,
        online: sql<boolean>`coalesce(${otherUser.lastActiveAt} >= now() - interval '10 minutes', false)`,
      })
      .from(userConnections)
      .innerJoin(
        otherUser,
        or(
          and(eq(userConnections.requesterId, userId), eq(otherUser.id, userConnections.addresseeId)),
          and(eq(userConnections.addresseeId, userId), eq(otherUser.id, userConnections.requesterId)),
        ),
      )
      .where(or(eq(userConnections.requesterId, userId), eq(userConnections.addresseeId, userId)))
      .orderBy(userConnections.createdAt);

    const friends: { id: string; user: { id: string; email: string; displayName: string }; online: boolean }[] = [];
    const incoming: { id: string; user: { id: string; email: string; displayName: string } }[] = [];
    const outgoing: typeof incoming = [];
    for (const { id, requesterId, status, userId: otherId, email, displayName, online } of rows) {
      const connection = { id, user: { id: otherId, email, displayName } };
      if (status === "accepted") friends.push({ ...connection, online });
      else if (requesterId === userId) outgoing.push(connection);
      else incoming.push(connection);
    }
    res.set("Cache-Control", "no-store").json({ friends, incoming, outgoing });
  } catch (error) {
    next(error);
  }
});

/** Sends an exact-email request, rejecting self-requests and existing pairs. */
friendsRouter.post("/", ...createFriendRequestRateLimiters(), async (req, res, next) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > TEXT_LIMITS.email || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  try {
    const userId = res.locals.userId as string;
    const [addressee] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(sql`lower(${appUsers.email}) = ${email}`)
      .limit(1);
    if (!addressee) {
      res.status(404).json({ error: "No user found" });
      return;
    }
    if (addressee.id === userId) {
      res.status(409).json({ error: "Cannot send a friend request to yourself" });
      return;
    }
    const [connection] = await db
      .insert(userConnections)
      .values({ requesterId: userId, addresseeId: addressee.id })
      .onConflictDoNothing()
      .returning({ id: userConnections.id });
    if (!connection) {
      res.status(409).json({ error: "A friend request or friendship already exists" });
      return;
    }
    res.status(201).json({ id: connection.id });
  } catch (error) {
    next(error);
  }
});

/** Only the recipient can accept a still-pending request. */
friendsRouter.post("/:connectionId/accept", async (req, res, next) => {
  const { connectionId } = req.params;
  if (!isUuid(connectionId)) {
    res.status(400).json({ error: "connectionId must be a valid UUID" });
    return;
  }
  try {
    const [connection] = await db
      .update(userConnections)
      .set({ status: "accepted" })
      .where(
        and(
          eq(userConnections.id, connectionId),
          eq(userConnections.addresseeId, res.locals.userId as string),
          eq(userConnections.status, "pending"),
        ),
      )
      .returning({ id: userConnections.id });
    if (!connection) {
      res.status(404).json({ error: "Friend request not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** Either participant can cancel, decline or remove a relationship. */
friendsRouter.delete("/:connectionId", async (req, res, next) => {
  const { connectionId } = req.params;
  if (!isUuid(connectionId)) {
    res.status(400).json({ error: "connectionId must be a valid UUID" });
    return;
  }
  try {
    const userId = res.locals.userId as string;
    const [connection] = await db
      .delete(userConnections)
      .where(
        and(
          eq(userConnections.id, connectionId),
          or(eq(userConnections.requesterId, userId), eq(userConnections.addresseeId, userId)),
        ),
      )
      .returning({ id: userConnections.id });
    if (!connection) {
      res.status(404).json({ error: "Friend request not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
