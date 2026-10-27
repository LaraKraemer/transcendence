// Self-check for the pure helpers in transactions.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/transactions.check.mjs
import assert from "node:assert/strict";

import { groupTransferLegs } from "./transactions.ts";

const tx = (id, amountMinor, transferGroupId = null) => ({ id, amountMinor, transferGroupId });

const coffee = tx("coffee", -350);
const sourceLeg = tx("source", -10000, "move");
const destinationLeg = tx("destination", 10000, "move");
const loneLeg = tx("lone", 2500, "deleted-account");
const salary = tx("salary", 400000);

// The pair becomes one row where its first leg was, with the negative (source) leg first.
assert.deepEqual(groupTransferLegs([coffee, destinationLeg, sourceLeg, loneLeg, salary]), [
  { transaction: coffee },
  { transaction: sourceLeg, transferTo: destinationLeg },
  { transaction: loneLeg },
  { transaction: salary },
]);
assert.deepEqual(groupTransferLegs([sourceLeg, coffee, destinationLeg]), [
  { transaction: sourceLeg, transferTo: destinationLeg },
  { transaction: coffee },
]);
// A leg whose other leg is on the next page stays on its own.
assert.deepEqual(groupTransferLegs([coffee, sourceLeg]), [{ transaction: coffee }, { transaction: sourceLeg }]);
assert.deepEqual(groupTransferLegs([]), []);

console.log("groupTransferLegs: ok");
