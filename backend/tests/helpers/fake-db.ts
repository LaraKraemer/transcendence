import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { vi, type Mock } from "vitest";

export const query: Mock = vi.fn();
export const pool = { query, on: vi.fn() };
export const db = drizzle({ query } as unknown as Pool);
