import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});
vi.mock("../../srcs/auth.ts", () => ({
  requireAuthenticatedUser: (_req: Request, res: Response, next: () => void) => {
    res.locals.userId = userId;
    next();
  },
}));
vi.mock("../../srcs/rate-limit.ts", () => ({ createFriendRequestRateLimiters: () => [] }));

import { friendsRouter } from "../../srcs/routes/friends.ts";
import { dispatch } from "../helpers/dispatch.ts";

const userId = "550e8400-e29b-41d4-a716-446655440001";
const friendId = "550e8400-e29b-41d4-a716-446655440002";
const connectionId = "550e8400-e29b-41d4-a716-446655440003";
const incomingUserId = "550e8400-e29b-41d4-a716-446655440004";
const incomingConnectionId = "550e8400-e29b-41d4-a716-446655440005";
const acceptedUserId = "550e8400-e29b-41d4-a716-446655440006";
const acceptedConnectionId = "550e8400-e29b-41d4-a716-446655440007";

beforeEach(() => query.mockReset());

describe("POST /friends", () => {
  const request = (email: string) => dispatch(friendsRouter, { method: "POST", url: "/", body: { email } });

  it("rejects an invalid email before querying", async () => {
    expect(await request("invalid")).toEqual({ status: 400, body: { error: "A valid email is required" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 when no user has the email", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await request("missing@example.com")).toEqual({ status: 404, body: { error: "No user found" } });
  });

  it("rejects a request to yourself", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    expect(await request("self@example.com")).toEqual({
      status: 409,
      body: { error: "Cannot send a friend request to yourself" },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("normalizes the email and creates a request for the signed-in user", async () => {
    query.mockResolvedValueOnce({ rows: [[friendId]] });
    query.mockResolvedValueOnce({ rows: [[connectionId]] });

    expect(await request("  FRIEND@EXAMPLE.COM  ")).toEqual({ status: 201, body: { id: connectionId } });
    expect(query.mock.calls[0]![1]).toContain("friend@example.com");
    const insertSql: string = query.mock.calls[1]![0].text;
    expect(insertSql).toContain("on conflict do nothing");
    expect(query.mock.calls[1]![1]).toEqual([userId, friendId]);
  });

  it("returns 409 when the pair already exists", async () => {
    query.mockResolvedValueOnce({ rows: [[friendId]] });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await request("friend@example.com")).toEqual({
      status: 409,
      body: { error: "A friend request or friendship already exists" },
    });
  });
});

describe("POST /friends/:connectionId/accept", () => {
  it("returns 404 for a non-addressee and scopes the update to the pending recipient", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await dispatch(friendsRouter, { method: "POST", url: `/${connectionId}/accept` })).toEqual({
      status: 404,
      body: { error: "Friend request not found" },
    });
    const updateSql: string = query.mock.calls[0]![0].text;
    expect(updateSql).toContain('"user_connection"."addressee_id" =');
    expect(updateSql).toContain('"user_connection"."status" =');
    expect(query.mock.calls[0]![1]).toContain(userId);
    expect(query.mock.calls[0]![1]).toContain("pending");
  });
});

describe("GET /friends", () => {
  it("returns online only for accepted friends, not pending requests", async () => {
    query.mockResolvedValueOnce({
      rows: [
        [connectionId, userId, "pending", friendId, "friend@example.com", "Friend", true],
        [incomingConnectionId, incomingUserId, "pending", incomingUserId, "incoming@example.com", "Incoming", true],
        [acceptedConnectionId, acceptedUserId, "accepted", acceptedUserId, "accepted@example.com", "Accepted", true],
      ],
    });

    expect(await dispatch(friendsRouter, { url: "/" })).toEqual({
      status: 200,
      body: {
        friends: [
          {
            id: acceptedConnectionId,
            user: { id: acceptedUserId, email: "accepted@example.com", displayName: "Accepted" },
            online: true,
          },
        ],
        incoming: [
          {
            id: incomingConnectionId,
            user: { id: incomingUserId, email: "incoming@example.com", displayName: "Incoming" },
          },
        ],
        outgoing: [{ id: connectionId, user: { id: friendId, email: "friend@example.com", displayName: "Friend" } }],
      },
    });
  });
});
