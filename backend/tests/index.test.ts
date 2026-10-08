import { afterEach, expect, it, vi } from "vitest";

const { purgeStaleSessions, runMigrations, listen } = vi.hoisted(() => ({
  purgeStaleSessions: vi.fn(),
  runMigrations: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("../srcs/auth.ts", () => ({ purgeStaleSessions }));
vi.mock("../srcs/db/migrate.ts", () => ({ runMigrations }));
vi.mock("../srcs/app.ts", () => ({ createApp: () => ({ listen }) }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("purges at startup and every six hours, logs failures, and unrefs the timer", async () => {
  vi.useFakeTimers();
  const interval = vi.spyOn(globalThis, "setInterval");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("DB down");
  purgeStaleSessions.mockRejectedValueOnce(error).mockResolvedValue(0);

  await import("../srcs/index.ts");
  await vi.advanceTimersByTimeAsync(0);
  expect(runMigrations).toHaveBeenCalledOnce();
  expect(listen).toHaveBeenCalledWith(3001, expect.any(Function));
  expect(purgeStaleSessions).toHaveBeenCalledTimes(1);
  expect(errorLog).toHaveBeenCalledWith("Session purge failed:", error);
  expect(interval.mock.results[0]!.value.hasRef()).toBe(false);

  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
  expect(purgeStaleSessions).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(purgeStaleSessions).toHaveBeenCalledTimes(2);
});
