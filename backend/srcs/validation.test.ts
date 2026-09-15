import { describe, expect, it } from "vitest";

import { isUuid } from "./validation.ts";

describe("isUuid", () => {
  it("accepts a valid v4 UUID", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects a non-string", () => {
    expect(isUuid(123)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects a malformed UUID", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
