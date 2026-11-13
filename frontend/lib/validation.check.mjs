// Self-check for the pure helpers in validation.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/validation.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_ACCOUNT_REF_LENGTH,
  MAX_EMAIL_LENGTH,
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
  isEmail,
  toMinorUnits,
  toPositiveMinorUnits,
  validateChangePassword,
  validateLogin,
  validateRegister,
  validateDisplayName,
  validateAccount,
  validateCategory,
  validateTransaction,
  isTwoFactorCode,
  accountErrorCodes,
  categoryErrorCodes,
  transactionErrorCodes,
  validationErrorCodes,
} from "./validation.ts";

assert.equal(MAX_EMAIL_LENGTH, 254);
assert.equal(isEmail(`${"a".repeat(MAX_EMAIL_LENGTH - "@example.com".length)}@example.com`), true);
assert.equal(isEmail(`${"a".repeat(MAX_EMAIL_LENGTH + 1 - "@example.com".length)}@example.com`), false);
assert.equal(isEmail("user@localhost"), false);
assert.equal(isEmail(" user@example.com"), false);
assert.equal(isEmail("user\0@example.com"), false);
console.log("isEmail: ok");

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

// validateChangePassword: the profile's change-password form and the changePassword action
const strongPassword = "correct-horse-battery";
const passwordFields = { currentPassword: "old", newPassword: strongPassword, confirmPassword: strongPassword };
assert.deepEqual(validateChangePassword(passwordFields), {}); // any current password, the backend checks it
assert.deepEqual(validateChangePassword({ ...passwordFields, currentPassword: "" }), {
  currentPassword: "passwordRequired",
});
assert.deepEqual(validateChangePassword({ ...passwordFields, newPassword: "short", confirmPassword: "short" }), {
  newPassword: "passwordTooShort",
});
const tooManyBytes = "ä".repeat(37); // 37 characters, 74 UTF-8 bytes
assert.deepEqual(
  validateChangePassword({ ...passwordFields, newPassword: tooManyBytes, confirmPassword: tooManyBytes }),
  { newPassword: "passwordTooLong" },
);
assert.deepEqual(validateChangePassword({ ...passwordFields, confirmPassword: `${strongPassword}!` }), {
  confirmPassword: "passwordMismatch",
});
console.log("validateChangePassword: ok");

const registration = { email: "user@example.com", displayName: " User ", password: strongPassword };
assert.deepEqual(validateRegister(registration), {});
assert.deepEqual(validateLogin({ email: " USER@example.com ", password: "old" }), {});
for (const email of ["not-an-email@", "user@@example.com", "user..name@example.com", "user@.example.com", "user@localhost", "user\0@example.com", "a".repeat(255) + "@example.com"]) {
  assert.equal(validateLogin({ email, password: "old" }).email, "emailInvalid");
  assert.equal(validateRegister({ ...registration, email }).email, "emailInvalid");
}
assert.equal(validateDisplayName("   "), "displayNameRequired");
assert.equal(validateDisplayName("x".repeat(101)), "displayNameTooLong");
assert.equal(validateDisplayName("\0"), "textInvalid");
assert.equal(validateDisplayName(" " + "x".repeat(100) + " "), undefined);
assert.equal(validateRegister({ ...registration, displayName: "x".repeat(101) }).displayName, "displayNameTooLong");
for (const code of ["", "12345", "1234567", "abcdef", "１２３４５６"]) assert.equal(isTwoFactorCode(code, "code"), false);
assert.equal(isTwoFactorCode("123456", "code"), true);
assert.equal(isTwoFactorCode("abcde-fg234", "recovery"), true);
assert.equal(isTwoFactorCode("ABCDE FG234", "recovery"), true);
assert.equal(isTwoFactorCode("ABCDEFGHI0", "recovery"), false);
assert.equal(isTwoFactorCode("ABCDE-FG2345", "recovery"), false);

const accountInput = { name: "Main", type: "checking", currencyCode: "EUR", openingBalance: "", institution: "", accountRef: "" };
assert.deepEqual(validateAccount(accountInput, 2, "en", "create", ["EUR"]), {});
assert.equal(validateAccount(accountInput, 2, "en", "edit", []).openingBalance, "amountInvalid");
assert.deepEqual(validateAccount({ ...accountInput, openingBalance: "-12,50" }, 2, "de", "edit", []), {});
assert.equal(validateAccount({ ...accountInput, name: " " }, 2, "en", "create", ["EUR"]).name, "nameRequired");
assert.equal(validateAccount({ ...accountInput, name: "x".repeat(101) }, 2, "en", "create", ["EUR"]).name, "nameTooLong");
assert.equal(validateAccount({ ...accountInput, type: "unknown" }, 2, "en", "create", ["EUR"]).type, "typeInvalid");
assert.equal(validateAccount({ ...accountInput, currencyCode: "USD" }, 2, "en", "create", ["EUR"]).currencyCode, "currencyInvalid");
assert.equal(validateAccount({ ...accountInput, openingBalance: "1.005" }, 2, "en", "create", ["EUR"]).openingBalance, "amountDecimals");
assert.equal(validateAccount({ ...accountInput, openingBalance: "9999999999999999" }, 2, "en", "create", ["EUR"]).openingBalance, "amountTooLarge");
assert.equal(validateAccount({ ...accountInput, institution: "x".repeat(101), openingBalance: "0" }, 2, "en", "edit", []).institution, "institutionTooLong");
assert.equal(validateAccount({ ...accountInput, accountRef: "x".repeat(51), openingBalance: "0" }, 2, "en", "edit", []).accountRef, "accountRefTooLong");
assert.equal(validateAccount({ ...accountInput, accountRef: "\0", openingBalance: "0" }, 2, "en", "edit", []).accountRef, "textInvalid");

assert.deepEqual(validateCategory(category, ["utensils"]), {});
assert.deepEqual(validateCategory({ ...category, name: " ", types: [], icon: "unknown", color: "bad" }, ["utensils"]), {
  name: "nameRequired", icon: "iconInvalid", color: "colorInvalid", types: "typesInvalid",
});
assert.equal(validateCategory({ ...category, types: ["transfer"] }, ["utensils"]).types, "typesInvalid");
assert.equal(validateCategory({ ...category, name: "\0" }, ["utensils"]).name, "textInvalid");
assert.equal(validateCategory({ ...category, name: "x".repeat(81) }, ["utensils"]).name, "nameTooLong");

const entry = { accountId: "source", type: "expense", toAccountId: "", amount: "1.50", toAmount: "", description: "", merchant: "", bookedOn: "2026-11-13", categoryId: "", notes: "" };
const options = [{ id: "source", currencyCode: "EUR", minorUnit: 2 }, { id: "destination", currencyCode: "USD", minorUnit: 2 }];
assert.deepEqual(validateTransaction(entry, options, [], "en"), {});
assert.equal(validateTransaction({ ...entry, amount: "0" }, options, [], "en").amount, "amountNotPositive");
assert.equal(validateTransaction({ ...entry, bookedOn: "2026-02-30" }, options, [], "en").bookedOn, "dateInvalid");
assert.equal(validateTransaction({ ...entry, bookedOn: "0000-01-01" }, options, [], "en").bookedOn, "dateInvalid");
assert.equal(validateTransaction({ ...entry, merchant: "\0" }, options, [], "en").merchant, "textInvalid");
assert.equal(validateTransaction({ ...entry, notes: "x".repeat(2001) }, options, [], "en").notes, "notesTooLong");
assert.equal(validateTransaction({ ...entry, categoryId: "income" }, options, [{ id: "income", types: ["income"] }], "en").categoryId, "categoryInvalid");
assert.deepEqual(validateTransaction({ ...entry, categoryId: "legacy" }, options, [], "en", false), {}, "An unchanged category is allowed after its types were edited");
assert.equal(validateTransaction({ ...entry, type: "transfer", toAccountId: "source" }, options, [], "en").toAccountId, "toAccountInvalid");
assert.equal(validateTransaction({ ...entry, type: "transfer", toAccountId: "destination" }, options, [], "en").toAmount, "amountRequired");
assert.deepEqual(validateTransaction({ ...entry, type: "transfer", toAccountId: "destination", toAmount: "2" }, options, [], "en"), {});
assert.deepEqual(validateTransaction({ ...entry, type: "transfer", toAccountId: "destination" }, options.map((account) => ({ ...account, currencyCode: "EUR" })), [], "en"), {}, "Same-currency transfers reuse the sent amount");
console.log("client form validation: ok");

for (const locale of ["en", "de", "uk", "fa"]) {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  for (const [namespace, codes] of [["auth", validationErrorCodes], ["accounts", accountErrorCodes], ["categories", categoryErrorCodes], ["transactions", transactionErrorCodes]]) {
    for (const code of codes) assert.equal(typeof messages[namespace].errors[code], "string", `${locale}: missing ${namespace}.errors.${code}`);
  }
}
console.log("validation messages: all four locales covered");
