// Self-check for formatAmount (no test framework in the frontend):
//   node --experimental-strip-types lib/format.check.mjs
import assert from "node:assert/strict";

import { formatAmount } from "./format.ts";

const NBSP = "\u00a0"; // Intl puts a no-break space between a code/symbol and the number

assert.equal(formatAmount(1250, "EUR", 2, "en-US"), "€12.50");
assert.equal(formatAmount(5, "EUR", 2, "en-US"), "€0.05");
assert.equal(formatAmount(-1250, "EUR", 2, "en-US"), "-€12.50");
assert.equal(formatAmount(1500, "JPY", 0, "en-US"), "¥1,500"); // minorUnit 0
assert.equal(formatAmount(1005, "KWD", 3, "en-US"), `KWD${NBSP}1.005`); // minorUnit 3
assert.equal(formatAmount(1250, "JPY", 2, "en-US"), "¥12.50"); // our minorUnit wins over Intl's table
assert.equal(formatAmount(1250, "EUR", 2, "de-DE"), `12,50${NBSP}€`); // locale: separators and symbol position
assert.equal(formatAmount(123456789, "EUR", 2, "de-DE"), `1.234.567,89${NBSP}€`);
assert.equal(formatAmount(1250, "EUR", 2, "en-US", "exceptZero"), "+€12.50");
console.log("formatAmount: ok");
