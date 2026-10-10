import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import { listCurrencies } from "../db/currencies.ts";

export const currenciesRouter = Router();

currenciesRouter.use(requireAuthenticatedUser);

/** Returns global currency reference data to authenticated users. */
currenciesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listCurrencies());
  } catch (error) {
    next(error);
  }
});
