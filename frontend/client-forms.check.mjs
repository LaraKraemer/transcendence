import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import ts from "typescript";

import * as validators from "./lib/validation.ts";

const require = createRequire(import.meta.url);
let submissions = [];
let serverCalls = 0;
const noop = () => {};
const serverAction = async () => {
  serverCalls++;
  return { success: false, status: 400, errors: {}, message: "Rejected by test server" };
};
const actionMocks = new Proxy({}, { get: () => serverAction });
const componentMocks = new Proxy({}, { get: () => noop });
const mocks = {
  react: {
    useState: (initial) => [typeof initial === "function" ? initial() : initial, noop],
    useRef: () => ({ current: null }),
    useId: () => "test-field",
    useEffect: noop,
    useTransition: () => [false, noop],
    useActionState: (action, initial) => {
      submissions.push((input) => action(initial, input));
      return [initial, noop, false];
    },
  },
  "next-intl": { useTranslations: () => (key) => key, useLocale: () => "en" },
  "next/navigation": { useRouter: () => ({ push: noop }) },
  "@/lib/validation": validators,
  "@/lib/auth-context": { useAuth: () => ({ login: serverAction, register: serverAction, completeTwoFactor: serverAction }) },
  "@/components/ui/live-status": { useAnnounce: () => noop },
  "@/components/categories/category-icon": { CATEGORY_ICON_KEYS: ["utensils"] },
  "@/components/auth/form-parts": {
    codeInputProps: () => ({}), useAuthErrorText: () => (code) => code,
    formErrorFor: () => "generic", twoFactorErrorFor: () => "generic", googleErrorFor: () => null,
    authNoticeFor: () => null, serverFieldErrors: () => ({}),
  },
};

// Same transpile-and-mock pattern as lib/actions/accounts.check.mjs. Only boundaries are mocked.
function loadForms(path, privateForms = []) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8") + (privateForms.length ? `\nexport { ${privateForms.join(", ")} };` : "");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loadedModule = { exports: {} };
  const load = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/lib/actions/")) return actionMocks;
    if (name.startsWith("@/components/")) return componentMocks;
    if (name.startsWith("@/lib/")) return componentMocks;
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(load, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const currencies = [{ code: "EUR", minorUnit: 2 }];
const account = { id: "source", name: "Main", type: "checking", currencyCode: "EUR", openingBalanceMinor: 0, institution: null, accountRef: null, minorUnit: 2 };
const accountInput = { name: "Main", type: "checking", currencyCode: "EUR", openingBalance: "0", institution: "", accountRef: "" };
const entry = { accountId: "source", type: "expense", toAccountId: "", amount: "1", toAmount: "", description: "", merchant: "", bookedOn: "2026-11-13", categoryId: "", notes: "" };
const authInput = (email) => {
  const data = new FormData();
  data.set("email", email);
  data.set("displayName", "User");
  data.set("password", "correct-horse-battery");
  return data;
};
const cases = [
  [loadForms("./components/auth/login-form.tsx").LoginForm, {}, authInput("not-an-email@"), authInput("user@example.com")],
  [loadForms("./components/auth/register-form.tsx").RegisterForm, {}, authInput("not-an-email@"), authInput("user@example.com")],
  [loadForms("./components/accounts/account-form.tsx").AccountForm, { mode: "create", currencies, onClose: noop }, { ...accountInput, name: " " }, accountInput],
  [loadForms("./components/accounts/account-form.tsx").AccountForm, { mode: "edit", account, minorUnit: 2, onClose: noop }, { ...accountInput, openingBalance: "bad" }, accountInput],
  [loadForms("./components/categories/category-form-dialog.tsx").CategoryForm, { onDone: noop, onPendingChange: noop }, { name: "Food", icon: "utensils", color: "#FFFFFF", types: [] }, { name: "Food", icon: "utensils", color: "#FFFFFF", types: ["expense"] }],
  [loadForms("./components/profile/profile-details.tsx", ["NameForm"]).NameForm, { displayName: "User", onDone: noop, onPendingChange: noop }, " ", "User"],
  [loadForms("./components/profile/two-factor-section.tsx", ["EnableDialog"]).EnableDialog, { setup: { otpauthUri: "test", secret: "ABCDEFGH" }, onDone: noop, onBusyChange: noop }, "12345", "123456"],
  [loadForms("./components/profile/two-factor-section.tsx", ["DisableDialog"]).DisableDialog, { hasPassword: true, onDone: noop, onBusyChange: noop }, { password: "", code: "123456", kind: "code" }, { password: "old", code: "123456", kind: "code" }],
  [loadForms("./components/profile/two-factor-section.tsx", ["DisableDialog"]).DisableDialog, { hasPassword: false, onDone: noop, onBusyChange: noop }, { password: "", code: "bad", kind: "recovery" }, { password: "", code: "abcde-fg234", kind: "recovery" }],
  [loadForms("./components/auth/two-factor-form.tsx").TwoFactorForm, { onExpired: noop, onBack: noop }, "abcdef", "123456"],
  [loadForms("./components/transactions/transaction-form-dialog.tsx", ["TransactionForm"]).TransactionForm, { mode: "create", accounts: [account], allAccounts: [account], categories: [], defaultAccountId: "source", today: "2026-11-13", onDone: noop, onPendingChange: noop }, { ...entry, amount: "0" }, entry],
];
for (const [Form, props, invalid, valid] of cases) {
  submissions = [];
  Form(props);
  assert.equal(submissions.length, 1);
  serverCalls = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await submissions[0](invalid);
    assert.ok(result.error || result.fieldError || Object.keys(result.fieldErrors ?? {}).length, `${Form.name} must show validation errors`);
    assert.equal(serverCalls, 0, `${Form.name} must not send invalid input to a server action`);
  }
  await submissions[0](valid);
  assert.equal(serverCalls, 1, `${Form.name} must allow valid submissions`);
}
console.log("Client submission guards: invalid inputs make no server calls; valid inputs reach the server");
