// Self-check for toMinorUnits (no test framework in the frontend):
//   node --experimental-strip-types lib/validation.check.mjs
import assert from "node:assert/strict";

import { toMinorUnits } from "./validation.ts";

assert.equal(toMinorUnits("100.50", 2), 10050);
assert.equal(toMinorUnits("100.5", 2), 10050);
assert.equal(toMinorUnits("-12.5", 2), -1250);
assert.equal(toMinorUnits("1.005", 2), undefined); // more decimals than EUR has
assert.equal(toMinorUnits("1.005", 3), 1005); // KWD
assert.equal(toMinorUnits("1500", 0), 1500); // JPY
assert.equal(toMinorUnits("1.5", 0), undefined);
assert.equal(toMinorUnits("1e3", 2), undefined);
assert.equal(toMinorUnits("abc", 2), undefined);
assert.equal(toMinorUnits("99999999999999999", 2), undefined); // not a safe integer
console.log("toMinorUnits: ok");
