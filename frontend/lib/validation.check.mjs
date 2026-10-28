// Self-check for the pure helpers in validation.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/validation.check.mjs
import assert from "node:assert/strict";

import {
  MAX_ACCOUNT_REF_LENGTH,
  MAX_INSTITUTION_LENGTH,
  MAX_NOTES_LENGTH,
  changedCategoryFields,
  changedFields,
  amountInputValue,
  contrastRatio,
  readableOn,
  hslToHex,
  hueAndLightness,
  filterAmountInput,
  toMinorUnits,
  toPositiveMinorUnits,
} from "./validation.ts";

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
assert.equal(toMinorUnits("12,50", 2, "de"), 1250);
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
assert.deepEqual(
  changedCategoryFields({ ...category, types: ["expense", "income"] }, { ...category, types: ["income", "expense"] }),
  {},
); // same set
assert.deepEqual(changedCategoryFields(category, { ...category, name: "Groceries", types: ["income"] }), {
  name: "Groceries",
  types: ["income"],
});
assert.deepEqual(changedCategoryFields(category, { ...category, types: ["expense", "income"] }), {
  types: ["expense", "income"],
});
assert.deepEqual(changedCategoryFields(category, { ...category, icon: "gift", color: "#DC2626" }), {
  icon: "gift",
  color: "#DC2626",
});
console.log("changedCategoryFields: ok");

// The optional-text limits mirror TEXT_LIMITS in backend/srcs/validation.ts
assert.equal(MAX_NOTES_LENGTH, 2000);
assert.equal(MAX_INSTITUTION_LENGTH, 100);
assert.equal(MAX_ACCOUNT_REF_LENGTH, 50);
console.log("optional text limits: ok");

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

// The custom colour sliders: hue and lightness convert to hex and back.
assert.equal(hslToHex(0, 100, 50), "#FF0000");
assert.equal(hslToHex(120, 100, 25), "#008000");
assert.equal(hslToHex(240, 100, 50), "#0000FF");
assert.equal(hslToHex(0, 0, 100), "#FFFFFF");
assert.deepEqual(hueAndLightness("#FF0000"), { hue: 0, lightness: 50 });
assert.deepEqual(hueAndLightness("#008000"), { hue: 120, lightness: 25 });
assert.deepEqual(hueAndLightness("#FF00FF"), { hue: 300, lightness: 50 });
assert.deepEqual(hueAndLightness("#808080"), { hue: 0, lightness: 50 });
// 8 bits per channel can shift the round trip by 1, which a slider never shows.
for (let hue = 0; hue < 360; hue += 5) {
  for (const lightness of [15, 50, 85]) {
    const back = hueAndLightness(hslToHex(hue, 70, lightness));
    const hueShift = Math.min(Math.abs(back.hue - hue), 360 - Math.abs(back.hue - hue));
    assert.ok(hueShift <= 1 && Math.abs(back.lightness - lightness) <= 1, `hsl(${hue} 70% ${lightness}%)`);
  }
}
console.log("hslToHex/hueAndLightness: ok");

// Keep separators until locale/currency validation; never silently multiply money.
assert.equal(filterAmountInput("abc12,50xyz"), "12,50");
assert.equal(filterAmountInput("12.3,4.5"), "12.345");
assert.equal(toMinorUnits(filterAmountInput("12.50"), 0), "amountDecimals");
assert.equal(toMinorUnits(filterAmountInput("12,50"), 0, "de"), "amountDecimals");
assert.equal(filterAmountInput("-12.50"), "12.50");
assert.equal(filterAmountInput("  -250 ", true), "-250");
assert.equal(filterAmountInput("  −250 ", true), "-250");
assert.equal(toMinorUnits(filterAmountInput("  −250 ", true), 2), -25000);
assert.equal(filterAmountInput("12-50", true), "1250");
assert.equal(filterAmountInput(""), "");
assert.equal(toMinorUnits(filterAmountInput("1,500"), 3, "en"), "amountInvalid");
assert.equal(toMinorUnits("12,50", 2, "uk"), 1250);
assert.equal(toMinorUnits("12,50", 2, "de-DE"), 1250);
assert.equal(toPositiveMinorUnits("12,50", 2, "uk"), 1250);
assert.equal(toPositiveMinorUnits("1,500", 3, "en"), "amountInvalid");

assert.equal(amountInputValue(-1250, 2), "12.50");
assert.equal(amountInputValue(5, 3), "0.005");
assert.equal(amountInputValue(1500, 0), "1500");
assert.equal(amountInputValue(Number.MAX_SAFE_INTEGER, 3), "9007199254740.991");
assert.equal(toPositiveMinorUnits(amountInputValue(-1250, 2), 2), 1250);
// Opening balances round-trip exactly and PATCH comparisons use minor units.
for (const minorUnit of [0, 2, 3]) {
  for (const openingBalanceMinor of [0, 1250, -1250, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
    const input = amountInputValue(openingBalanceMinor, minorUnit, true);
    assert.equal(toMinorUnits(input, minorUnit), openingBalanceMinor);
    const opened = { ...original, openingBalanceMinor };
    assert.deepEqual(changedFields(opened, { ...original, openingBalanceMinor: toMinorUnits(input, minorUnit) }), {});
  }
}
const openedAccount = { ...original, openingBalanceMinor: -1250 };
assert.deepEqual(changedFields(openedAccount, { ...original, openingBalanceMinor: 0 }), { openingBalanceMinor: 0 });
assert.deepEqual(changedFields(openedAccount, { ...original, openingBalanceMinor: 1250 }), {
  openingBalanceMinor: 1250,
});
assert.equal(toMinorUnits("90071992547409.92", 2), "amountTooLarge");
assert.equal(toMinorUnits("-9007199254740.992", 3), "amountTooLarge");
assert.equal(toMinorUnits("", 2), "amountInvalid");
console.log("opening balance editing: ok");
