import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { captureMetricsRoutePrefix, createMetricsApp, measureHttpRequests, metricsRegistry } from "../srcs/metrics.ts";

let server: Server;
let base: string;
const pool = { totalCount: 5, idleCount: 2, waitingCount: 1 };

beforeAll(async () => {
  const app = express();
  app.use(measureHttpRequests);
  const router = express.Router();
  router.get("/:transactionId", async (req, res) => {
    if (req.query.fail) throw new Error("Database failure");
    res.json({ id: req.params.transactionId });
  });
  app.use("/transactions", captureMetricsRoutePrefix, router);
  app.use("/internal", createMetricsApp(pool));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.sendStatus(500);
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => metricsRegistry.resetMetrics());
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

it("groups different IDs and queries under the matched route pattern", async () => {
  for (const id of ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"]) {
    expect((await fetch(`${base}/transactions/${id}?q=private`)).status).toBe(200);
  }
  const metrics = await metricsRegistry.metrics();
  expect(metrics).toContain(
    'http_request_duration_seconds_count{method="GET",route="/transactions/:transactionId",status_code="200"} 2',
  );
  expect(metrics).not.toContain("550e8400");
  expect(metrics).not.toContain("private");
});

it("retains the mounted route pattern when an async error reaches the app handler", async () => {
  expect((await fetch(`${base}/transactions/secret-id?fail=1`)).status).toBe(500);
  expect(await metricsRegistry.metrics()).toContain('route="/transactions/:transactionId",status_code="500"');
});

it("uses unmatched for unknown URLs", async () => {
  expect((await fetch(`${base}/unknown/private-id`)).status).toBe(404);
  expect(await metricsRegistry.metrics()).toContain('route="unmatched",status_code="404"');
});

it("serves Node metrics and current pool counts as Prometheus text", async () => {
  const response = await fetch(`${base}/internal/metrics`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  const metrics = await response.text();
  expect(metrics).toContain("process_cpu_user_seconds_total");
  expect(metrics).toContain('pg_pool_connections{state="total"} 5');
  expect(metrics).toContain('pg_pool_connections{state="idle"} 2');
  expect(metrics).toContain("pg_pool_waiting_count 1");
  pool.waitingCount = 0;
  expect(await (await fetch(`${base}/internal/metrics`)).text()).toContain("pg_pool_waiting_count 0");
});

it("returns a failure instead of an incomplete successful scrape", async () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const collect = vi.spyOn(metricsRegistry, "metrics").mockRejectedValueOnce(new Error("collection failed"));
  try {
    expect((await fetch(`${base}/internal/metrics`)).status).toBe(500);
  } finally {
    collect.mockRestore();
    errorLog.mockRestore();
  }
});
