// Self-check for toMinorUnits (no test framework in the frontend):
//   node --experimental-strip-types lib/validation.check.mjs
import assert from "node:assert/strict";

import { changedAccountFields, contrastRatio, readableOn, toMinorUnits } from "./validation.ts";

assert.equal(toMinorUnits("100.50", 2), 10050);
assert.equal(toMinorUnits("100.5", 2), 10050);
assert.equal(toMinorUnits("-12.5", 2), -1250);
assert.equal(toMinorUnits(".5", 2), 50); // browsers accept a leading dot
assert.equal(toMinorUnits("-.5", 2), -50);
assert.equal(toMinorUnits("12.", 2), 1200); // trailing dot, as typed mid-edit
assert.equal(toMinorUnits("1.005", 3), 1005); // KWD
assert.equal(toMinorUnits("1500", 0), 1500); // JPY
assert.equal(toMinorUnits("1.005", 2), "openingBalanceDecimals"); // more decimals than EUR has
assert.equal(toMinorUnits("1.5", 0), "openingBalanceDecimals");
assert.equal(toMinorUnits(".", 2), "openingBalanceInvalid");
assert.equal(toMinorUnits("-", 2), "openingBalanceInvalid");
assert.equal(toMinorUnits("1e3", 2), "openingBalanceInvalid");
assert.equal(toMinorUnits("12,50", 2), "openingBalanceInvalid");
assert.equal(toMinorUnits("abc", 2), "openingBalanceInvalid");
assert.equal(toMinorUnits("99999999999999999", 2), "openingBalanceTooLarge"); // not a safe integer
console.log("toMinorUnits: ok");

// changedAccountFields: only what differs goes into the PATCH body
const original = { name: "Main", type: "checking", institution: "DKB", accountRef: null };
assert.deepEqual(changedAccountFields(original, { ...original }), {});
assert.deepEqual(changedAccountFields(original, { ...original, name: "Main EUR" }), { name: "Main EUR" });
assert.deepEqual(changedAccountFields(original, { ...original, type: "savings", accountRef: "1234" }), {
  type: "savings",
  accountRef: "1234",
});
assert.deepEqual(changedAccountFields(original, { ...original, institution: null }), { institution: null }); // clearing is a change
assert.deepEqual(changedAccountFields({ ...original, institution: "" }, { ...original, institution: null }), {}); // "" and null both mean unset
console.log("changedAccountFields: ok");

// readableOn: the icon colour on a category tile always contrasts enough
assert.equal(readableOn("#1E3352"), "#FFFFFF"); // navy → white
assert.equal(readableOn("#FFFF00"), "#000000"); // yellow → black
assert.equal(readableOn("#FFFFFF"), "#000000");
for (let i = 0; i < 4096; i++) {
  const hex =
    "#" +
    [i >> 8, (i >> 4) & 15, i & 15]
      .map((n) => (n * 17).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  assert.ok(contrastRatio(hex, readableOn(hex)) >= 4.5, `${hex} on ${readableOn(hex)}`);
}
console.log("readableOn: ok");
