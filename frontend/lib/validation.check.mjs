// Self-check for the pure helpers in validation.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/validation.check.mjs
import assert from "node:assert/strict";

import { changedCategoryFields, changedFields, contrastRatio, readableOn, toMinorUnits, toPositiveMinorUnits } from "./validation.ts";

assert.equal(toMinorUnits("100.50", 2), 10050);
assert.equal(toMinorUnits("100.5", 2), 10050);
assert.equal(toMinorUnits("-12.5", 2), -1250);
assert.equal(toMinorUnits(".5", 2), 50); // browsers accept a leading dot
assert.equal(toMinorUnits("-.5", 2), -50);
assert.equal(toMinorUnits("12.", 2), 1200); // trailing dot, as typed mid-edit
assert.equal(toMinorUnits("1.005", 3), 1005); // KWD
assert.equal(toMinorUnits("1500", 0), 1500); // JPY
assert.equal(toMinorUnits("1.005", 2), "amountDecimals"); // more decimals than EUR has
assert.equal(toMinorUnits("1.5", 0), "amountDecimals");
assert.equal(toMinorUnits(".", 2), "amountInvalid");
assert.equal(toMinorUnits("-", 2), "amountInvalid");
assert.equal(toMinorUnits("1e3", 2), "amountInvalid");
assert.equal(toMinorUnits("12,50", 2), "amountInvalid");
assert.equal(toMinorUnits("abc", 2), "amountInvalid");
assert.equal(toMinorUnits("99999999999999999", 2), "amountTooLarge"); // not a safe integer
console.log("toMinorUnits: ok");

// toPositiveMinorUnits: the transaction form's amount; the expense/income type adds the sign
assert.equal(toPositiveMinorUnits("32.50", 2), 3250);
assert.equal(toPositiveMinorUnits(" 1500 ", 0), 1500); // JPY
assert.equal(toPositiveMinorUnits("", 2), "amountRequired");
assert.equal(toPositiveMinorUnits("   ", 2), "amountRequired");
assert.equal(toPositiveMinorUnits("0", 2), "amountNotPositive");
assert.equal(toPositiveMinorUnits("0.00", 2), "amountNotPositive");
assert.equal(toPositiveMinorUnits("-5", 2), "amountNotPositive");
assert.equal(toPositiveMinorUnits("-0", 2), "amountNotPositive");
assert.equal(toPositiveMinorUnits("1.005", 2), "amountDecimals");
assert.equal(toPositiveMinorUnits("abc", 2), "amountInvalid");
console.log("toPositiveMinorUnits: ok");

// changedFields: only what differs goes into the PATCH body
const original = { name: "Main", type: "checking", institution: "DKB", accountRef: null };
assert.deepEqual(changedFields(original, { ...original }), {});
assert.deepEqual(changedFields(original, { ...original, name: "Main EUR" }), { name: "Main EUR" });
assert.deepEqual(changedFields(original, { ...original, type: "savings", accountRef: "1234" }), {
  type: "savings",
  accountRef: "1234",
});
assert.deepEqual(changedFields(original, { ...original, institution: null }), { institution: null }); // clearing is a change
assert.deepEqual(changedFields({ ...original, institution: "" }, { ...original, institution: null }), {}); // "" and null both mean unset
const transaction = { description: "Groceries", bookedOn: "2026-10-01", categoryId: null, notes: "Weekly" };
assert.deepEqual(changedFields(transaction, { ...transaction, categoryId: "" }), {}); // the form's "No category"
assert.deepEqual(changedFields(transaction, { ...transaction, bookedOn: "2026-10-02", notes: null }), {
  bookedOn: "2026-10-02",
  notes: null,
});
console.log("changedFields: ok");

// changedCategoryFields: only what differs goes into the PATCH body
const category = { name: "Food", icon: "utensils", color: "#4ADE80", types: ["expense"] };
assert.deepEqual(changedCategoryFields(category, { ...category, color: "#4ade80" }), {}); // same color, other case
assert.deepEqual(changedCategoryFields({ ...category, types: ["expense", "income"] }, { ...category, types: ["income", "expense"] }), {}); // same set
assert.deepEqual(changedCategoryFields(category, { ...category, name: "Groceries", types: ["income"] }), { name: "Groceries", types: ["income"] });
assert.deepEqual(changedCategoryFields(category, { ...category, types: ["expense", "income"] }), { types: ["expense", "income"] });
assert.deepEqual(changedCategoryFields(category, { ...category, icon: "gift", color: "#DC2626" }), { icon: "gift", color: "#DC2626" });
console.log("changedCategoryFields: ok");

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
