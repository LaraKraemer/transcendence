// Run: node lib/actions/accounts.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const require = createRequire(import.meta.url);
const requests = [];
let refreshCount = 0;
let requestError;
const mocks = {
  "next/cache": { refresh: () => refreshCount++ },
  "next-intl/server": {},
  "@/lib/dal": {
    fetchApiServer: async (...request) => {
      requests.push(request);
      if (requestError) throw requestError;
    },
  },
};

// Load the real action and validators, replacing only Next and the backend boundary.
function loadModule(filename) {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  const load = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/lib/")) return loadModule(fileURLToPath(new URL(`../../${name.slice(2)}.ts`, import.meta.url)));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(load, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const { ApiError } = loadModule(fileURLToPath(new URL("../api.ts", import.meta.url)));
mocks["@/lib/api"] = { ApiError };
const { deleteAccount } = loadModule(fileURLToPath(new URL("./accounts.ts", import.meta.url)));
const accountId = "00000000-0000-4000-8000-000000000001";
assert.equal((await deleteAccount("../invalid")).status, 404);
assert.equal(requests.length, 0);
assert.equal(refreshCount, 0);
assert.equal((await deleteAccount(accountId)).success, true);
assert.deepEqual(requests, [[`/accounts/${accountId}`, { method: "DELETE" }]]);
assert.equal(refreshCount, 1);

requestError = new ApiError(500, "Deletion failed");
assert.deepEqual(await deleteAccount(accountId), { success: false, message: "Deletion failed", status: 500 });
assert.equal(refreshCount, 1);

requestError = new Error("offline");
const originalConsoleError = console.error;
console.error = () => {};
try {
  assert.equal((await deleteAccount(accountId)).success, false);
} finally {
  console.error = originalConsoleError;
}
assert.equal(refreshCount, 1, "Failed deletion must not refresh the overview");
console.log("deleteAccount: ok");
