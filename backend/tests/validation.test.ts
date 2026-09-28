import { describe, expect, it } from "vitest";

import {
  isCurrencyCode,
  isDateOnly,
  isHexColor,
  isIsoTimestamp,
  isUuid,
} from "../srcs/validation.ts";

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

  it("accepts uppercase UUIDs", () => {
    expect(isUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it.each([null, undefined, {}, 123])("rejects non-string %j", (value) => {
    expect(isUuid(value)).toBe(false);
  });

  it("rejects a UUID with surrounding whitespace", () => {
    expect(isUuid(" 550e8400-e29b-41d4-a716-446655440000 ")).toBe(false);
  });

  it("rejects a UUID with extra characters appended", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000x")).toBe(false);
  });

  it("rejects a wrong variant nibble (c instead of 8/9/a/b)", () => {
    // 3rd group 4th nibble must be [89ab]; c is invalid
    expect(isUuid("550e8400-e29b-41d4-c716-446655440000")).toBe(false);
  });

  it("rejects the nil UUID (version nibble is 0, not 1-5)", () => {
    // pinned: isUuid only accepts versions 1-5, nil UUID (version 0) is rejected
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("rejects a v7 UUID (version nibble is 7, outside 1-5) — pin this", () => {
    // pinned: v7 UUIDs would break if schema moves to gen_random_uuid() v7
    expect(isUuid("018f1234-5678-7abc-89de-f01234567890")).toBe(false);
  });
});

describe("isIsoTimestamp", () => {
  it.each(["2025-01-15T10:30:00Z", "2025-01-15T10:30:00.000Z", "2025-01-15"])(
    "accepts %s",
    (value) => {
      expect(isIsoTimestamp(value)).toBe(true);
    },
  );

  it.each([null, undefined, 123, "not-a-date", "2025-13-01"])("rejects %j", (value) => {
    expect(isIsoTimestamp(value)).toBe(false);
  });
});

describe("isDateOnly", () => {
  it("accepts a valid YYYY-MM-DD date", () => {
    expect(isDateOnly("2025-01-15")).toBe(true);
  });

  it.each(["2025/01/15", "2025-1-15", "20250115", null, undefined, 20250115])(
    "rejects %j",
    (value) => {
      expect(isDateOnly(value)).toBe(false);
    },
  );

  it("accepts overflow dates like February 30 (Date.parse rolls over) — pin this", () => {
    // Current behaviour: "2025-02-30" parses as March 2; the implementation doesn't
    // validate calendar correctness, only format. Pin so this is deliberate.
    expect(isDateOnly("2025-02-30")).toBe(true);
  });
});

describe("isHexColor", () => {
  it.each(["#2563EB", "#FFFFFF", "#000000", "#abc123"])("accepts %s", (value) => {
    expect(isHexColor(value)).toBe(true);
  });

  it.each(["#abc", "2563EB", "#GGGGGG", "#12345", null, undefined])("rejects %j", (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe("isCurrencyCode", () => {
  it.each(["EUR", "USD", "GBP", "AAA"])("accepts %s", (value) => {
    expect(isCurrencyCode(value)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["too few letters", "US"],
    ["too many letters", "USDD"],
    ["lowercase letters", "usd"],
    ["mixed-case letters", "Usd"],
    ["digits", "US1"],
    ["a number", 123],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_description, value) => {
    expect(isCurrencyCode(value)).toBe(false);
  });
});
