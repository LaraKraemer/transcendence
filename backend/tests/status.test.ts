import { afterEach, describe, expect, it, vi } from "vitest";

const { query, applicationQuery, access, readFile } = vi.hoisted(() => ({
  query: vi.fn(),
  applicationQuery: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../srcs/db/client.ts", () => ({ statusPool: { query }, pool: { query: applicationQuery } }));
vi.mock("node:fs/promises", () => ({ access, readFile }));
readFile.mockResolvedValue('{"version":"1.0.0"}');
const { getStatus } = await import("../srcs/status.ts");

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("public status", () => {
  it("uses its own pool while an application query is waiting", async () => {
    applicationQuery.mockReturnValue(new Promise(() => {}));
    const pendingApplicationQuery = applicationQuery();
    query.mockResolvedValue({});
    access.mockResolvedValue(undefined);
    readFile.mockResolvedValue(new Date().toISOString());
    expect(await getStatus()).toMatchObject({ components: { database: { status: "ok" } } });
    expect(applicationQuery).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("SELECT 1");
    expect(pendingApplicationQuery).toBeInstanceOf(Promise);
  });

  it.each([
    [0, "ok"],
    [36 * 60 * 60 * 1000, "ok"],
    [36 * 60 * 60 * 1000 + 1, "degraded"],
    [-1, "degraded"],
  ])("handles backup age %s ms", async (ageMs, status) => {
    const nowMs = Date.parse("2026-10-31T12:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
    query.mockResolvedValue({});
    access.mockResolvedValue(undefined);
    readFile.mockResolvedValue(new Date(nowMs - Number(ageMs)).toISOString());
    const result = await getStatus();
    expect(result.status).toBe(status);
    expect(result.components).toEqual({
      database: { status: "ok", latencyMs: expect.any(Number) },
      storage: { status: "ok" },
    });
    expect(result.version).toBe("1.0.0");
  });
  it.each([null, "invalid"])("degrades for missing or invalid marker %s", async (marker) => {
    query.mockResolvedValue({});
    access.mockResolvedValue(undefined);
    if (marker === null) readFile.mockRejectedValue(new Error("missing"));
    else readFile.mockResolvedValue(marker);
    expect(await getStatus()).toMatchObject({ status: "degraded", lastBackupAt: null });
  });
  it("degrades when only avatar storage fails", async () => {
    query.mockResolvedValue({});
    access.mockRejectedValue(new Error("read-only storage"));
    readFile.mockResolvedValue(new Date().toISOString());
    expect(await getStatus()).toMatchObject({ status: "degraded", components: { storage: { status: "down" } } });
  });

  it("reports dependency failures without exposing errors", async () => {
    query.mockRejectedValue(new Error("secret database URL"));
    access.mockRejectedValue(new Error("private path"));
    readFile.mockRejectedValue(new Error("missing"));
    const result = await getStatus();
    expect(result).toMatchObject({
      status: "down",
      components: { database: { status: "down" }, storage: { status: "down" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });
});
